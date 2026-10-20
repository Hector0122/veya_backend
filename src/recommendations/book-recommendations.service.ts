import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { OpenLibraryService } from '../openlibrary/openlibrary.service';
import { CatalogService } from '../catalog/catalog.service';
import { normalizeOpenLibrarySearchDoc } from '../catalog/catalog.normalizer';
import {
  ContentStatus,
  ContentType,
} from '../common/constants/content.constants';
import type { OpenLibrarySearchDoc } from '../openlibrary/types/openlibrary.types';
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
const SUGGESTIONS_SHOWN = 3;

// Límites del prompt, para que no crezca sin fin con mucho historial.
const MAX_READ_BOOKS = 20;
const MAX_AUDIOVISUAL_POSITIVE = 10;
const MAX_AUDIOVISUAL_NEGATIVE = 5;
const MAX_EXCLUDED_IN_PROMPT = 40;

export const SuggestionStatus = {
  SUGGESTED: 'suggested',
  SAVED: 'saved',
  DISMISSED: 'dismissed',
} as const;

type VerifiedSuggestion = {
  suggestion: AiBookSuggestion;
  doc: OpenLibrarySearchDoc;
};

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
   * Sugerencias de libros vigentes del usuario. Se reutilizan durante 24 h;
   * con `refresh` (o si no hay vigentes) se piden nuevas a la IA. Si la
   * generación falla, se devuelven las que hubiera.
   */
  async forUser(userId: string, { refresh = false } = {}) {
    const now = new Date();
    if (!refresh) {
      const current = await this.findCurrent(userId, now);
      if (current.length > 0) return current;
    }

    const generated = await this.generateWithAi(userId, now);
    return generated ?? this.findCurrent(userId, now);
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

  private async generateWithAi(userId: string, now: Date) {
    if (!this.ai.isConfigured()) return null;

    const { taste, excludedExternalIds, knownTitles } = await this.buildSignal(
      userId,
      now,
    );
    if (!hasPositiveSignal(taste)) return null;

    const result = await this.ai.generateJson(buildBookPrompt(taste));
    if (!result) return null;

    const parsed = parseAiSuggestions(result.text, knownTitles);
    const verified = await this.verify(parsed, excludedExternalIds);
    this.logger.log(
      `IA (${result.provider}): ${parsed.length} sugeridos, ${verified.length} verificados`,
    );
    if (verified.length === 0) return null;

    return this.store(userId, verified.slice(0, SUGGESTIONS_SHOWN), now);
  }

  private async buildSignal(userId: string, now: Date) {
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

    const isLiked = (row: (typeof rows)[number]) =>
      row.isFavorite || (row.rating !== null && row.rating >= 4);
    const isDisliked = (row: (typeof rows)[number]) =>
      (row.rating !== null && row.rating <= 2) ||
      row.status === (ContentStatus.ABANDONADO as string);
    const toItem = (row: (typeof rows)[number]) => ({
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
    const disliked = audiovisual
      .filter(isDisliked)
      .slice(0, MAX_AUDIOVISUAL_NEGATIVE);

    // Calificados primero: son la señal más clara.
    const readBooks = [...books]
      .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))
      .slice(0, MAX_READ_BOOKS);

    const authorsOf = (metadata: unknown): string[] => {
      const authors = (metadata as { authors?: unknown } | null)?.authors;
      return Array.isArray(authors)
        ? authors.filter((a): a is string => typeof a === 'string')
        : [];
    };

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

    const excludedExternalIds = new Set(
      [...books, ...pastSuggestions].map((row) => row.content.externalId),
    );
    const knownTitles = [
      ...taste.readBooks,
      ...taste.liked,
      ...taste.seen,
      ...taste.disliked,
    ].map((item) => item.title);

    return { taste, excludedExternalIds, knownTitles };
  }

  /** Se queda solo con libros que existen en Open Library y que el usuario
   *  no leyó, guardó ni descartó. */
  private async verify(
    suggestions: AiBookSuggestion[],
    excludedExternalIds: Set<string>,
  ): Promise<VerifiedSuggestion[]> {
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

    const seen = new Set<string>();
    return matches.filter((match): match is VerifiedSuggestion => {
      if (!match) return false;
      const externalId = normalizeOpenLibrarySearchDoc(match.doc).externalId;
      if (excludedExternalIds.has(externalId) || seen.has(externalId)) {
        return false;
      }
      seen.add(externalId);
      return true;
    });
  }

  private async store(
    userId: string,
    verified: VerifiedSuggestion[],
    now: Date,
  ) {
    const contents = await this.catalogService.cacheAll(
      verified.map(({ suggestion, doc }) => {
        const normalized = normalizeOpenLibrarySearchDoc(doc);
        // Los subjects de Open Library a veces no dicen más que "Fiction";
        // ahí los géneros de la IA son mejores.
        const onlyFiction =
          normalized.genres.length === 1 && normalized.genres[0] === 'Ficción';
        return onlyFiction && suggestion.genres.length > 0
          ? { ...normalized, genres: suggestion.genres }
          : normalized;
      }),
    );

    // Las sugerencias anteriores dejan de mostrarse, pero se conservan para
    // el enfriamiento.
    await this.prisma.bookSuggestion.updateMany({
      where: {
        userId,
        status: SuggestionStatus.SUGGESTED,
        expiresAt: { gt: now },
      },
      data: { expiresAt: now },
    });

    const expiresAt = new Date(now.getTime() + SUGGESTION_TTL_MS);
    await Promise.all(
      contents.map((content, i) => {
        const { synopsis, reason, basedOn } = verified[i].suggestion;
        const data = {
          status: SuggestionStatus.SUGGESTED,
          source: 'ai',
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
