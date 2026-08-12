import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TmdbService } from '../tmdb/tmdb.service';
import { AnilistService } from '../anilist/anilist.service';
import { CatalogService } from '../catalog/catalog.service';
import { mapTmdbGenreNamesToIds } from '../tmdb/tmdb-genres';
import {
  normalizeAniListMedia,
  normalizeTmdbSearchItem,
} from '../catalog/catalog.normalizer';
import { NormalizedContent } from '../catalog/types/normalized-content.type';
import type { Content } from '../../generated/prisma/client';

const TOP_GENRES_COUNT = 3;
const RESULT_LIMIT = 20;

// Pesos de señal por género (ver openspec/changes/improve-recommendations-quality
// - design.md, sección "Weighting scheme"). Números elegidos a mano, no
// calibrados con datos de uso real todavía; centralizados aquí para poder
// ajustarlos en un solo lugar.
const WEIGHT_TRACKED = 1;
const WEIGHT_STRONG = 3;
const WEIGHT_NEGATIVE = -2;

const DAY_MS = 24 * 60 * 60 * 1000;
const RECOMMENDATION_COOLDOWN_DAYS = 14;
const RECOMMENDATION_COOLDOWN_MS = RECOMMENDATION_COOLDOWN_DAYS * DAY_MS;

// Tope de páginas extra que se piden a TMDB/AniList cuando, tras excluir lo
// ya recomendado recientemente, el pool de candidatos queda corto — evita
// pedir páginas sin límite para usuarios de gustos muy nicho.
const MAX_EXTRA_PAGES = 2;

type TrackedRow = {
  status: string;
  isFavorite: boolean;
  rating: number | null;
  content: { genres: string[] };
};

type PersonalizedItem = Content & { recommendationSource: 'personalized' };
type TrendingItem = Content & { recommendationSource: 'trending' };

@Injectable()
export class RecommendationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tmdb: TmdbService,
    private readonly anilist: AnilistService,
    private readonly catalogService: CatalogService,
  ) {}

  /**
   * Recomendaciones sin IA, basadas en:
   * - Toda la lista del usuario como señal de género, ponderada (tracked
   *   simple, favorito/calificación alta, calificación baja/abandonado)
   * - Contenido similar de TMDB/AniList (discover/search por género)
   * - Rotación: lo ya recomendado recientemente se evita en el próximo
   *   request en vez de repetirse siempre
   *
   * Sin señales suficientes -> fallback a trending general, marcado como tal
   * en la respuesta (`recommendationSource`) para que no se confunda con una
   * recomendación real.
   */
  async forUser(
    userId: string,
  ): Promise<Array<PersonalizedItem | TrendingItem>> {
    const trackedRows = await this.prisma.userContent.findMany({
      where: { userId },
      include: { content: true },
    });

    if (trackedRows.length === 0) {
      return this.trendingFallback();
    }

    const topGenres = this.rankGenres(trackedRows);
    if (topGenres.length === 0) {
      return this.trendingFallback();
    }

    const trackedContentIds = new Set(trackedRows.map((row) => row.contentId));
    return this.buildPersonalized(userId, topGenres, trackedContentIds);
  }

  private async trendingFallback(): Promise<TrendingItem[]> {
    const trending = await this.catalogService.trending();
    return trending.map((item) => ({
      ...item,
      recommendationSource: 'trending' as const,
    }));
  }

  private async buildPersonalized(
    userId: string,
    topGenres: string[],
    trackedContentIds: Set<string>,
  ): Promise<PersonalizedItem[]> {
    const cooldownCutoff = new Date(Date.now() - RECOMMENDATION_COOLDOWN_MS);
    const recentlyRecommended = await this.prisma.recommendationLog.findMany({
      where: { userId, recommendedAt: { gte: cooldownCutoff } },
    });
    const recentlyRecommendedAt = new Map(
      recentlyRecommended.map((row) => [row.contentId, row.recommendedAt]),
    );

    const candidatesById = new Map<string, Content>();
    let eligible: Content[] = [];
    let page = 1;
    let extraPagesFetched = 0;

    // Siempre trae la página 1; solo pide páginas extra si, tras excluir lo
    // recién recomendado, el pool sigue corto (y hasta MAX_EXTRA_PAGES).
    for (;;) {
      const normalized = await this.collectCandidates(topGenres, page);
      const cached = await this.catalogService.cacheAll(normalized);
      for (const item of cached) {
        if (!trackedContentIds.has(item.id)) {
          candidatesById.set(item.id, item);
        }
      }

      eligible = [...candidatesById.values()].filter(
        (item) => !recentlyRecommendedAt.has(item.id),
      );

      if (
        eligible.length >= RESULT_LIMIT ||
        extraPagesFetched >= MAX_EXTRA_PAGES
      ) {
        break;
      }
      extraPagesFetched += 1;
      page += 1;
    }

    let results = eligible.slice(0, RESULT_LIMIT);

    if (results.length < RESULT_LIMIT) {
      // Pool agotado: en vez de devolver menos de lo pedido, se rellena
      // reapareciendo lo ya recomendado, empezando por lo más antiguo.
      const resurfaceCandidates = [...candidatesById.values()]
        .filter((item) => recentlyRecommendedAt.has(item.id))
        .sort((a, b) => {
          const aTime = recentlyRecommendedAt.get(a.id)?.getTime() ?? 0;
          const bTime = recentlyRecommendedAt.get(b.id)?.getTime() ?? 0;
          return aTime - bTime;
        });

      const needed = RESULT_LIMIT - results.length;
      results = [...results, ...resurfaceCandidates.slice(0, needed)];
    }

    await this.logRecommendations(
      userId,
      results.map((item) => item.id),
    );

    return results.map((item) => ({
      ...item,
      recommendationSource: 'personalized' as const,
    }));
  }

  private async collectCandidates(
    topGenres: string[],
    page: number,
  ): Promise<NormalizedContent[]> {
    const [tmdbMovies, tmdbTv, anilistResults] = await Promise.all([
      this.tmdb.discoverByGenres(
        'movie',
        mapTmdbGenreNamesToIds(topGenres, 'movie'),
        page,
      ),
      this.tmdb.discoverByGenres(
        'tv',
        mapTmdbGenreNamesToIds(topGenres, 'tv'),
        page,
      ),
      Promise.all(
        topGenres.map((genre) => this.anilist.discoverByGenre(genre, 20, page)),
      ).then((r) => r.flat()),
    ]);

    return [
      ...tmdbMovies.results.map(normalizeTmdbSearchItem),
      ...tmdbTv.results.map(normalizeTmdbSearchItem),
      ...anilistResults.map(normalizeAniListMedia),
    ].filter((item): item is NormalizedContent => item !== null);
  }

  /** Registra lo servido como recomendación y purga entradas fuera del
   *  período de enfriamiento, para que la rotación no crezca sin límite. */
  private async logRecommendations(
    userId: string,
    contentIds: string[],
  ): Promise<void> {
    const now = new Date();
    await Promise.all(
      contentIds.map((contentId) =>
        this.prisma.recommendationLog.upsert({
          where: {
            uq_recommendation_log: { userId, contentId },
          },
          create: { userId, contentId, recommendedAt: now },
          update: { recommendedAt: now },
        }),
      ),
    );

    const cooldownCutoff = new Date(Date.now() - RECOMMENDATION_COOLDOWN_MS);
    await this.prisma.recommendationLog.deleteMany({
      where: { userId, recommendedAt: { lt: cooldownCutoff } },
    });
  }

  private rankGenres(rows: TrackedRow[]): string[] {
    const scores = new Map<string, number>();

    for (const row of rows) {
      const weight = this.weightFor(row);
      for (const genre of row.content.genres) {
        scores.set(genre, (scores.get(genre) ?? 0) + weight);
      }
    }

    return [...scores.entries()]
      .filter(([, score]) => score > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_GENRES_COUNT)
      .map(([genre]) => genre);
  }

  private weightFor(row: {
    status: string;
    isFavorite: boolean;
    rating: number | null;
  }): number {
    if (row.isFavorite || (row.rating !== null && row.rating >= 4)) {
      return WEIGHT_STRONG;
    }
    if (
      (row.rating !== null && row.rating <= 2) ||
      row.status === 'abandonado'
    ) {
      return WEIGHT_NEGATIVE;
    }
    return WEIGHT_TRACKED;
  }
}
