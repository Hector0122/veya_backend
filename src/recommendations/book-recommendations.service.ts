import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { OpenLibraryService } from '../openlibrary/openlibrary.service';
import { CatalogService } from '../catalog/catalog.service';
import { normalizeOpenLibrarySearchDoc } from '../catalog/catalog.normalizer';
import {
  ContentStatus,
  ContentType,
} from '../common/constants/content.constants';
import {
  BOOK_GENRE_SUBJECTS,
  BOOK_GENRES,
  BookGenre,
  mapAudiovisualGenres,
  normalizeBookSubjects,
} from '../openlibrary/book-genres';
import type { OpenLibrarySearchDoc } from '../openlibrary/types/openlibrary.types';
import type { Prisma } from '../../generated/prisma/client';
import { genreWeight } from './recommendations.service';
import {
  AiBookSuggestion,
  buildBookPrompt,
  hasPositiveSignal,
  parseAiSuggestions,
  pickMatchingDoc,
  TasteSignal,
} from './book-ai';

const DAY_MS = 24 * 60 * 60 * 1000;
const SUGGESTION_TTL_MS = DAY_MS;
// Igual que el enfriamiento de las recomendaciones audiovisuales.
const COOLDOWN_MS = 14 * DAY_MS;
// Siempre se intenta mostrar esta cantidad: lo que la IA no alcanza a dar
// (libros inventados, ya leídos) se completa con géneros y populares.
export const SUGGESTIONS_SHOWN = 6;

// Límites del prompt, para que no crezca sin fin con mucho historial.
const MAX_READ_BOOKS = 20;
const MAX_AUDIOVISUAL_POSITIVE = 10;
const MAX_AUDIOVISUAL_NEGATIVE = 5;
const MAX_EXCLUDED_IN_PROMPT = 40;

// Motor de géneros: lo que se ve pesa la mitad que lo que se lee (número
// elegido a mano, igual que los pesos de recommendations.service.ts).
const AUDIOVISUAL_BOOK_FACTOR = 0.5;
const TOP_BOOK_GENRES = 3;
const MAX_BASED_ON = 2;

// Límite de lotes nuevos por usuario y hora, para no quemar la cuota gratuita
// de Groq/Gemini. Se cuenta en la base y no con @Throttle porque el throttler
// rastrea por IP.
const MAX_GENERATIONS_PER_HOUR = 5;
const HOUR_MS = 60 * 60 * 1000;

export const SuggestionStatus = {
  SUGGESTED: 'suggested',
  SAVED: 'saved',
  DISMISSED: 'dismissed',
} as const;

export type SuggestionSource = 'ai' | 'genre' | 'trending';

type TrackedRow = Prisma.UserContentGetPayload<{ include: { content: true } }>;

interface UserData {
  books: TrackedRow[];
  audiovisual: TrackedRow[];
  pastSuggestions: Prisma.BookSuggestionGetPayload<{
    include: { content: true };
  }>[];
  /** Libros leídos, guardados, descartados o sugeridos hace poco. */
  excludedExternalIds: Set<string>;
}

interface SuggestionToStore {
  doc: OpenLibrarySearchDoc;
  source: SuggestionSource;
  genres?: BookGenre[];
  synopsis: string | null;
  reason: string | null;
  basedOn: string[];
}

function authorsOf(metadata: unknown): string[] {
  const authors = (metadata as { authors?: unknown } | null)?.authors;
  return Array.isArray(authors)
    ? authors.filter((a): a is string => typeof a === 'string')
    : [];
}

function workId(doc: OpenLibrarySearchDoc): string {
  return normalizeOpenLibrarySearchDoc(doc).externalId;
}

@Injectable()
export class BookRecommendationsService {
  private readonly logger = new Logger(BookRecommendationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly openLibrary: OpenLibraryService,
    private readonly catalogService: CatalogService,
  ) {}

  /**
   * Sugerencias de libros vigentes del usuario, siempre `SUGGESTIONS_SHOWN`
   * si se puede. Un lote se reutiliza durante 24 h; con `refresh` (o sin
   * vigentes) se genera uno nuevo: primero con IA y lo que falte con el motor
   * de géneros y luego con populares. Si al guardar o descartar quedan menos,
   * se completan los huecos sin IA (para no gastar cuota en cada clic). Si
   * todo falla, se devuelven las que hubiera.
   */
  async forUser(userId: string, { refresh = false } = {}) {
    const now = new Date();
    const current = await this.findCurrent(userId, now);
    if (!refresh && current.length >= SUGGESTIONS_SHOWN) return current;

    const topUp = !refresh && current.length > 0;
    const needed = SUGGESTIONS_SHOWN - (topUp ? current.length : 0);

    const data = await this.loadUserData(userId, now);
    const seen = new Set([
      ...data.excludedExternalIds,
      ...current.map((s) => s.content.externalId),
    ]);

    const items: SuggestionToStore[] = [];
    if (!topUp) {
      items.push(...(await this.generateWithAi(data, needed, seen)));
    }
    if (items.length < needed) {
      items.push(
        ...(await this.generateByGenres(data, needed - items.length, seen)),
      );
    }
    if (items.length < needed) {
      items.push(...(await this.generateTrending(needed - items.length, seen)));
    }

    this.logger.log(
      `Libros (${topUp ? 'completar' : 'lote nuevo'}): ${items.length}/${needed} ` +
        `[${items.map((i) => i.source).join(', ')}]`,
    );
    if (items.length === 0) return current;
    return this.store(userId, items, now, { replace: !topUp });
  }

  /** Fuerza un lote nuevo, con un límite por usuario. */
  async refresh(userId: string) {
    const since = new Date(Date.now() - HOUR_MS);
    // Cada lote se guarda con un mismo `createdAt`, así que los lotes de la
    // última hora son los `createdAt` distintos.
    const batches = await this.prisma.bookSuggestion.groupBy({
      by: ['createdAt'],
      // Solo los lotes con IA gastan cuota; completar huecos no cuenta.
      where: { userId, source: 'ai', createdAt: { gte: since } },
    });
    if (batches.length >= MAX_GENERATIONS_PER_HOUR) {
      throw new HttpException(
        'Ya pediste muchas recomendaciones nuevas. Intenta de nuevo en un rato.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return this.forUser(userId, { refresh: true });
  }

  /** Guardar para después o descartar. Descartar excluye el libro para
   *  siempre; guardar no lo marca como leído. */
  async updateStatus(
    userId: string,
    id: string,
    status: typeof SuggestionStatus.SAVED | typeof SuggestionStatus.DISMISSED,
  ) {
    const suggestion = await this.prisma.bookSuggestion.findUnique({
      where: { id },
    });
    if (!suggestion) throw new NotFoundException('Sugerencia no encontrada');
    if (suggestion.userId !== userId) {
      throw new ForbiddenException('No podés modificar esta sugerencia');
    }

    const updated = await this.prisma.bookSuggestion.update({
      where: { id },
      data: { status },
      include: { content: true },
    });

    // Guardar una sugerencia la agrega como "quiero leer"; si el libro ya
    // estaba en la lista se respeta su estado.
    if (status === SuggestionStatus.SAVED) {
      await this.prisma.userContent.upsert({
        where: {
          uq_user_content: { userId, contentId: suggestion.contentId },
        },
        create: {
          userId,
          contentId: suggestion.contentId,
          status: ContentStatus.PENDIENTE,
        },
        update: {},
      });
    }

    return updated;
  }

  /** Guardados que siguen en "quiero leer". Lo usan las versiones de la app
   *  anteriores a los estados de lectura; las nuevas leen /tracking. */
  saved(userId: string) {
    return this.prisma.bookSuggestion.findMany({
      where: {
        userId,
        status: SuggestionStatus.SAVED,
        content: {
          userContents: {
            none: { userId, status: { not: ContentStatus.PENDIENTE } },
          },
        },
      },
      include: { content: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  private findCurrent(userId: string, now: Date) {
    return this.prisma.bookSuggestion.findMany({
      where: {
        userId,
        status: SuggestionStatus.SUGGESTED,
        expiresAt: { gt: now },
      },
      include: { content: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  private async loadUserData(userId: string, now: Date): Promise<UserData> {
    const [rows, pastSuggestions] = await Promise.all([
      this.prisma.userContent.findMany({
        where: { userId },
        include: { content: true },
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.bookSuggestion.findMany({
        where: {
          userId,
          OR: [
            {
              status: {
                in: [SuggestionStatus.SAVED, SuggestionStatus.DISMISSED],
              },
            },
            { createdAt: { gte: new Date(now.getTime() - COOLDOWN_MS) } },
          ],
        },
        include: { content: true },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const book: string = ContentType.BOOK;
    const books = rows.filter((row) => row.content.type === book);
    const audiovisual = rows.filter((row) => row.content.type !== book);

    return {
      books,
      audiovisual,
      pastSuggestions,
      excludedExternalIds: new Set(
        [...books, ...pastSuggestions].map((row) => row.content.externalId),
      ),
    };
  }

  // ---- IA ----------------------------------------------------------------

  private async generateWithAi(
    data: UserData,
    limit: number,
    seen: Set<string>,
  ): Promise<SuggestionToStore[]> {
    if (!this.ai.isConfigured()) return [];

    const { taste, knownTitles } = this.buildTaste(data);
    if (!hasPositiveSignal(taste)) return [];

    const result = await this.ai.generateJson(buildBookPrompt(taste));
    if (!result) return [];

    const parsed = parseAiSuggestions(result.text, knownTitles);
    const verified = await this.verify(parsed, seen, limit);
    this.logger.log(
      `IA (${result.provider}): ${parsed.length} sugeridos, ${verified.length} verificados`,
    );

    return verified.map(({ suggestion, doc }) => ({
      doc,
      source: 'ai' as const,
      genres: suggestion.genres,
      synopsis: suggestion.synopsis,
      reason: suggestion.reason,
      basedOn: suggestion.basedOn,
    }));
  }

  private buildTaste({ books, audiovisual, pastSuggestions }: UserData) {
    const isLiked = (row: TrackedRow) =>
      row.isFavorite || (row.rating !== null && row.rating >= 4);
    const isDisliked = (row: TrackedRow) =>
      (row.rating !== null && row.rating <= 2) ||
      row.status === (ContentStatus.ABANDONADO as string);
    const toItem = (row: TrackedRow) => ({
      title: row.content.title,
      type: row.content.type,
      genres: row.content.genres,
    });

    const liked = audiovisual
      .filter(isLiked)
      .slice(0, MAX_AUDIOVISUAL_POSITIVE);
    // Quien registra pero no califica también tiene gusto: se completa con
    // lo último que vio.
    const seen = audiovisual
      .filter((row) => !isLiked(row) && !isDisliked(row))
      .slice(0, MAX_AUDIOVISUAL_POSITIVE - liked.length);
    const disliked = [...audiovisual, ...books]
      .filter(isDisliked)
      .slice(0, MAX_AUDIOVISUAL_NEGATIVE);

    // Solo cuenta como gusto lo que se leyó o se está leyendo; "quiero leer"
    // no dice nada todavía y lo abandonado es señal negativa.
    const abandoned = (row: TrackedRow) =>
      row.status === (ContentStatus.ABANDONADO as string);
    const pending = (row: TrackedRow) =>
      row.status === (ContentStatus.PENDIENTE as string);
    // Calificados primero: son la señal más clara.
    const readBooks = books
      .filter((row) => !abandoned(row) && !pending(row))
      .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))
      .slice(0, MAX_READ_BOOKS);

    const taste: TasteSignal = {
      readBooks: readBooks.map((row) => ({
        title: row.content.title,
        authors: authorsOf(row.content.metadata),
        genres: row.content.genres,
        rating: row.rating,
        isFavorite: row.isFavorite,
      })),
      liked: liked.map(toItem),
      seen: seen.map(toItem),
      disliked: disliked.map(toItem),
      exclude: pastSuggestions
        .slice(0, MAX_EXCLUDED_IN_PROMPT)
        .map((s) =>
          [s.content.title, authorsOf(s.content.metadata).join(', ')]
            .filter(Boolean)
            .join(' — '),
        ),
    };

    const knownTitles = [
      ...taste.readBooks,
      ...taste.liked,
      ...taste.seen,
      ...taste.disliked,
    ].map((item) => item.title);

    return { taste, knownTitles };
  }

  /** Se queda solo con libros que existen en Open Library y que no están
   *  en `seen` (que se actualiza con los elegidos), hasta `limit`. */
  private async verify(
    suggestions: AiBookSuggestion[],
    seen: Set<string>,
    limit: number,
  ) {
    const matches = await Promise.all(
      suggestions.map(async (suggestion) => {
        let doc = pickMatchingDoc(
          suggestion,
          await this.openLibrary.searchByTitleAuthor(
            suggestion.title,
            suggestion.author,
          ),
        );
        // La búsqueda por campos falla con algunos títulos traducidos; la
        // general es más tolerante.
        doc ??= pickMatchingDoc(
          suggestion,
          await this.openLibrary.search(
            `${suggestion.title} ${suggestion.author}`,
            5,
          ),
        );
        return doc ? { suggestion, doc } : null;
      }),
    );

    const picked: {
      suggestion: AiBookSuggestion;
      doc: OpenLibrarySearchDoc;
    }[] = [];
    for (const match of matches) {
      if (!match || picked.length >= limit) continue;
      const id = workId(match.doc);
      if (seen.has(id)) continue;
      seen.add(id);
      picked.push(match);
    }
    return picked;
  }

  // ---- Motor de géneros (respaldo) ---------------------------------------

  /**
   * Puntúa géneros de libros con los pesos del motor audiovisual: los libros
   * leídos aportan sus géneros completos y lo audiovisual, mapeado y a la
   * mitad. Guarda además qué títulos del usuario empujaron cada género, para
   * mostrar "basado en" sin IA.
   */
  rankBookGenres({
    books,
    audiovisual,
  }: Pick<UserData, 'books' | 'audiovisual'>) {
    const scores = new Map<BookGenre, number>();
    const contributors = new Map<
      BookGenre,
      { title: string; weight: number }[]
    >();
    const known = new Set<string>(BOOK_GENRES);

    const add = (row: TrackedRow, genres: BookGenre[], factor: number) => {
      const weight = genreWeight(row) * factor;
      for (const genre of genres) {
        scores.set(genre, (scores.get(genre) ?? 0) + weight);
        if (weight > 0) {
          contributors
            .set(genre, contributors.get(genre) ?? [])
            .get(genre)!
            .push({ title: row.content.title, weight });
        }
      }
    };

    for (const row of books) {
      add(
        row,
        row.content.genres.filter((g): g is BookGenre => known.has(g)),
        1,
      );
    }
    for (const row of audiovisual) {
      add(
        row,
        mapAudiovisualGenres(row.content.genres),
        AUDIOVISUAL_BOOK_FACTOR,
      );
    }

    return [...scores.entries()]
      .filter(([, score]) => score > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_BOOK_GENRES)
      .map(([genre]) => ({
        genre,
        basedOn: (contributors.get(genre) ?? [])
          .sort((a, b) => b.weight - a.weight)
          .slice(0, MAX_BASED_ON)
          .map((c) => c.title),
      }));
  }

  private async generateByGenres(
    data: UserData,
    limit: number,
    seen: Set<string>,
  ): Promise<SuggestionToStore[]> {
    const topGenres = this.rankBookGenres(data);
    if (topGenres.length === 0) return [];

    const perGenre = await Promise.all(
      topGenres.map(async ({ genre, basedOn }) => {
        const docs = await this.openLibrary.searchBySubject(
          BOOK_GENRE_SUBJECTS[genre],
        );
        // Las etiquetas de Open Library son ruidosas: solo cuentan los
        // libros que, reclasificados, sí caen en el género buscado.
        return docs
          .filter(
            (doc) =>
              genre === 'Ficción' ||
              normalizeBookSubjects(doc.subject ?? []).includes(genre),
          )
          .map((doc) => ({ doc, basedOn }));
      }),
    );

    // Se alternan los géneros para que no salgan seguidos los del mismo.
    const picked: SuggestionToStore[] = [];
    for (let i = 0; picked.length < limit; i++) {
      const round = perGenre.map((list) => list[i]).filter(Boolean);
      if (round.length === 0) break;
      for (const { doc, basedOn } of round) {
        const id = workId(doc);
        if (seen.has(id) || picked.length >= limit) continue;
        seen.add(id);
        picked.push({
          doc,
          source: 'genre',
          synopsis: null,
          reason: null,
          basedOn,
        });
      }
    }

    this.logger.log(
      `Géneros (${topGenres.map((g) => g.genre).join(', ')}): ${picked.length} sugeridos`,
    );
    return picked;
  }

  /** Populares, para usuarios sin señal o para completar lo que falte. */
  private async generateTrending(
    limit: number,
    seen: Set<string>,
  ): Promise<SuggestionToStore[]> {
    const picked: SuggestionToStore[] = [];
    for (const doc of await this.openLibrary.getTrending()) {
      if (picked.length >= limit) break;
      const id = workId(doc);
      if (seen.has(id)) continue;
      seen.add(id);
      picked.push({
        doc,
        source: 'trending',
        synopsis: null,
        reason: null,
        basedOn: [],
      });
    }
    return picked;
  }

  // ---- Guardado ------------------------------------------------------------

  private async store(
    userId: string,
    items: SuggestionToStore[],
    now: Date,
    { replace }: { replace: boolean },
  ) {
    const contents = await this.catalogService.cacheAll(
      items.map(({ doc, genres }) => {
        const normalized = normalizeOpenLibrarySearchDoc(doc);
        // Open Library a veces no da géneros o no dice más que "Fiction";
        // ahí los de la IA son mejores.
        const weak =
          normalized.genres.length === 0 ||
          (normalized.genres.length === 1 &&
            normalized.genres[0] === 'Ficción');
        return weak && genres?.length ? { ...normalized, genres } : normalized;
      }),
    );

    // En un lote nuevo las sugerencias anteriores dejan de mostrarse, pero se
    // conservan para el enfriamiento. Al completar huecos se quedan y las
    // nuevas vencen junto con ellas.
    let expiresAt = new Date(now.getTime() + SUGGESTION_TTL_MS);
    if (replace) {
      await this.prisma.bookSuggestion.updateMany({
        where: {
          userId,
          status: SuggestionStatus.SUGGESTED,
          expiresAt: { gt: now },
        },
        data: { expiresAt: now },
      });
    } else {
      const current = await this.prisma.bookSuggestion.findFirst({
        where: {
          userId,
          status: SuggestionStatus.SUGGESTED,
          expiresAt: { gt: now },
        },
        orderBy: { expiresAt: 'asc' },
      });
      if (current) expiresAt = current.expiresAt;
    }

    await Promise.all(
      contents.map((content, i) => {
        const { source, synopsis, reason, basedOn } = items[i];
        const data = {
          status: SuggestionStatus.SUGGESTED,
          source,
          synopsis,
          reason,
          basedOn,
          createdAt: now,
          expiresAt,
        };
        return this.prisma.bookSuggestion.upsert({
          where: { uq_book_suggestion: { userId, contentId: content.id } },
          create: { userId, contentId: content.id, ...data },
          update: data,
        });
      }),
    );

    return this.findCurrent(userId, now);
  }
}
