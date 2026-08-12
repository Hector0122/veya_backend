import { RecommendationsService } from './recommendations.service';
import { NormalizedContent } from '../catalog/types/normalized-content.type';
import type { PrismaService } from '../prisma/prisma.service';
import type { TmdbService } from '../tmdb/tmdb.service';
import type { AnilistService } from '../anilist/anilist.service';
import type { CatalogService } from '../catalog/catalog.service';

type TmdbSearchFixture = { id: number; title: string };
type AniListFixture = { id: number; title: { romaji: string } };

function tmdbItems(startId: number, count: number): TmdbSearchFixture[] {
  return Array.from({ length: count }, (_, i) => ({
    id: startId + i,
    title: `TMDB ${startId + i}`,
  }));
}

function anilistItems(startId: number, count: number): AniListFixture[] {
  return Array.from({ length: count }, (_, i) => ({
    id: startId + i,
    title: { romaji: `Anime ${startId + i}` },
  }));
}

/** Fake `recommendationLog` delegate backed by an in-memory array, so
 * rotation behaves realistically across consecutive `forUser()` calls
 * within the same test. */
function makeRecommendationLogStore() {
  const rows: { userId: string; contentId: string; recommendedAt: Date }[] = [];

  return {
    findMany: jest.fn(
      ({
        where,
      }: {
        where: { userId: string; recommendedAt?: { gte: Date } };
      }) =>
        rows.filter(
          (r) =>
            r.userId === where.userId &&
            (!where.recommendedAt ||
              r.recommendedAt >= where.recommendedAt.gte),
        ),
    ),
    upsert: jest.fn(
      ({
        where,
        create,
        update,
      }: {
        where: { uq_recommendation_log: { userId: string; contentId: string } };
        create: { userId: string; contentId: string; recommendedAt: Date };
        update: { recommendedAt: Date };
      }) => {
        const { userId, contentId } = where.uq_recommendation_log;
        const existing = rows.find(
          (r) => r.userId === userId && r.contentId === contentId,
        );
        if (existing) {
          existing.recommendedAt = update.recommendedAt;
          return existing;
        }
        const row = { ...create };
        rows.push(row);
        return row;
      },
    ),
    deleteMany: jest.fn(
      ({
        where,
      }: {
        where: { userId: string; recommendedAt: { lt: Date } };
      }) => {
        const before = rows.length;
        const kept = rows.filter(
          (r) =>
            !(
              r.userId === where.userId &&
              r.recommendedAt < where.recommendedAt.lt
            ),
        );
        rows.length = 0;
        rows.push(...kept);
        return { count: before - rows.length };
      },
    ),
    _rows: rows,
  };
}

function buildTestbed() {
  const prisma = {
    userContent: { findMany: jest.fn() },
    recommendationLog: makeRecommendationLogStore(),
  };
  const tmdb = { discoverByGenres: jest.fn() };
  const anilist = { discoverByGenre: jest.fn() };
  const catalogService = {
    trending: jest.fn(),
    // Stand-in for CatalogService.cacheAll: assigns a stable id per
    // (source, externalId) so repeated appearances (e.g. across pages)
    // resolve to the same Content row, like the real upsert-by-unique-key
    // behavior does.
    cacheAll: jest.fn((items: NormalizedContent[]) =>
      items.map((item) => ({
        id: `${item.source}:${item.externalId}`,
        ...item,
        cachedAt: new Date(),
      })),
    ),
  };

  const service = new RecommendationsService(
    prisma as unknown as PrismaService,
    tmdb as unknown as TmdbService,
    anilist as unknown as AnilistService,
    catalogService as unknown as CatalogService,
  );

  return { service, prisma, tmdb, anilist, catalogService };
}

/** Wires the TMDB/AniList mocks to return a large, page-independent pool
 * (movie + tv + anime) so a single fetch already clears RESULT_LIMIT and no
 * extra pages get requested — used by tests that only care about ranking. */
function mockAbundantCandidatePool(
  tmdb: { discoverByGenres: jest.Mock },
  anilist: { discoverByGenre: jest.Mock },
) {
  tmdb.discoverByGenres.mockResolvedValue({
    results: tmdbItems(1, 15),
    page: 1,
    total_pages: 1,
    total_results: 15,
  });
  anilist.discoverByGenre.mockResolvedValue(anilistItems(5000, 15));
}

describe('RecommendationsService', () => {
  describe('weighted taste signal (rankGenres via forUser)', () => {
    it('lets plain-tracked content (no rating, not favorited) make a genre eligible', async () => {
      const { service, prisma, tmdb, anilist } = buildTestbed();
      mockAbundantCandidatePool(tmdb, anilist);

      prisma.userContent.findMany.mockResolvedValue([
        {
          contentId: 'tracked-1',
          status: 'pendiente',
          isFavorite: false,
          rating: null,
          content: { genres: ['Terror'] },
        },
        {
          contentId: 'tracked-2',
          status: 'viendo',
          isFavorite: false,
          rating: null,
          content: { genres: ['Terror'] },
        },
      ]);

      const result = await service.forUser('user-1');

      // A positive genre score routes through the personalized path (and
      // 'Terror' should have been requested from TMDB), not the trending
      // fallback — this is the exact gap the change closes: no rating or
      // favorite was needed for the genre to count.
      expect(result[0].recommendationSource).toBe('personalized');
      expect(tmdb.discoverByGenres).toHaveBeenCalledWith(
        'movie',
        expect.arrayContaining([27]), // 27 = Terror in TMDB's movie genre table
        1,
      );
    });

    it('lets a single favorite/high-rating outweigh many plain-tracked items in another genre', async () => {
      const { service, prisma, tmdb, anilist } = buildTestbed();
      mockAbundantCandidatePool(tmdb, anilist);

      const plainTrackedInDrama = Array.from({ length: 10 }, (_, i) => ({
        contentId: `drama-${i}`,
        status: 'pendiente',
        isFavorite: false,
        rating: null,
        content: { genres: ['Drama'] },
      }));

      prisma.userContent.findMany.mockResolvedValue([
        ...plainTrackedInDrama,
        {
          contentId: 'horror-favorite',
          status: 'terminado',
          isFavorite: true,
          rating: null,
          content: { genres: ['Terror'] },
        },
      ]);

      await service.forUser('user-1');

      // Drama score: 10 * WEIGHT_TRACKED (1) = 10. Terror score: 1 *
      // WEIGHT_STRONG (3) = 3. Drama still outranks Terror here (spec only
      // requires that a single strong signal isn't drowned out by an
      // "implausibly large" number of plain-tracked items) — assert both
      // genres were requested, i.e. Terror wasn't excluded despite Drama's
      // higher raw count.
      expect(tmdb.discoverByGenres).toHaveBeenCalledWith(
        'movie',
        expect.arrayContaining([18, 27]), // Drama=18, Terror=27
        1,
      );
    });

    it('suppresses a genre when signal is only low ratings / dropped items', async () => {
      const { service, prisma, catalogService } = buildTestbed();
      catalogService.trending.mockResolvedValue([]);

      prisma.userContent.findMany.mockResolvedValue([
        {
          contentId: 'c1',
          status: 'terminado',
          isFavorite: false,
          rating: 1,
          content: { genres: ['Terror'] },
        },
        {
          contentId: 'c2',
          status: 'abandonado',
          isFavorite: false,
          rating: null,
          content: { genres: ['Terror'] },
        },
      ]);

      const result = await service.forUser('user-1');

      // No genre has a positive score -> falls back to trending rather
      // than recommending more Terror.
      expect(catalogService.trending).toHaveBeenCalled();
      expect(
        result.every((item) => item.recommendationSource === 'trending'),
      ).toBe(true);
    });
  });

  describe('rotation across requests', () => {
    it('returns different content on a second request with an unchanged tracked list', async () => {
      const { service, prisma, tmdb, anilist } = buildTestbed();
      mockAbundantCandidatePool(tmdb, anilist);

      prisma.userContent.findMany.mockResolvedValue([
        {
          contentId: 'tracked-1',
          status: 'pendiente',
          isFavorite: false,
          rating: null,
          content: { genres: ['Terror'] },
        },
      ]);

      const first = await service.forUser('user-1');
      const second = await service.forUser('user-1');

      const firstIds = new Set(first.map((item) => item.id));
      const secondIds = new Set(second.map((item) => item.id));
      const overlap = [...secondIds].filter((id) => firstIds.has(id));

      expect(second.length).toBeGreaterThan(0);
      expect(overlap.length).toBeLessThan(second.length);
    });

    it('resurfaces previously-served items instead of returning a short result set once the pool is exhausted', async () => {
      const { service, prisma, tmdb, anilist } = buildTestbed();

      // Fixed, page-independent pool of exactly RESULT_LIMIT (20) items —
      // nothing new left once they've all been served once.
      tmdb.discoverByGenres.mockResolvedValue({
        results: tmdbItems(1, 20),
        page: 1,
        total_pages: 1,
        total_results: 20,
      });
      anilist.discoverByGenre.mockResolvedValue([]);

      prisma.userContent.findMany.mockResolvedValue([
        {
          contentId: 'tracked-1',
          status: 'pendiente',
          isFavorite: false,
          rating: null,
          content: { genres: ['Terror'] },
        },
      ]);

      const first = await service.forUser('user-1');
      expect(first).toHaveLength(20);

      const second = await service.forUser('user-1');

      // Pool is exhausted (all 20 were just served) — the service should
      // resurface them rather than return fewer than RESULT_LIMIT.
      expect(second).toHaveLength(20);
      expect(
        second.every((item) => item.recommendationSource === 'personalized'),
      ).toBe(true);
    });
  });

  describe('trending fallback indicator', () => {
    it('marks results as trending when the user has no tracked content', async () => {
      const { service, prisma, catalogService } = buildTestbed();
      prisma.userContent.findMany.mockResolvedValue([]);
      catalogService.trending.mockResolvedValue([
        { id: 'trend-1', title: 'Trending Movie' },
      ]);

      const result = await service.forUser('user-1');

      expect(catalogService.trending).toHaveBeenCalled();
      expect(result).toEqual([
        {
          id: 'trend-1',
          title: 'Trending Movie',
          recommendationSource: 'trending',
        },
      ]);
    });

    it('marks results as trending when signal is only negative/neutral', async () => {
      const { service, prisma, catalogService } = buildTestbed();
      catalogService.trending.mockResolvedValue([
        { id: 'trend-1', title: 'Trending Movie' },
      ]);

      prisma.userContent.findMany.mockResolvedValue([
        {
          contentId: 'c1',
          status: 'abandonado',
          isFavorite: false,
          rating: null,
          content: { genres: ['Comedia'] },
        },
      ]);

      const result = await service.forUser('user-1');

      expect(
        result.every((item) => item.recommendationSource === 'trending'),
      ).toBe(true);
    });

    it('marks results as personalized when the user has positive signal', async () => {
      const { service, prisma, tmdb, anilist } = buildTestbed();
      mockAbundantCandidatePool(tmdb, anilist);

      prisma.userContent.findMany.mockResolvedValue([
        {
          contentId: 'tracked-1',
          status: 'terminado',
          isFavorite: true,
          rating: null,
          content: { genres: ['Comedia'] },
        },
      ]);

      const result = await service.forUser('user-1');

      expect(result.length).toBeGreaterThan(0);
      expect(
        result.every((item) => item.recommendationSource === 'personalized'),
      ).toBe(true);
    });
  });
});
