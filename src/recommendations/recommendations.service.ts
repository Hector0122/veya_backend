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

const TOP_GENRES_COUNT = 3;
const RESULT_LIMIT = 20;

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
   * - Géneros frecuentes en la lista del usuario
   * - Calificaciones altas (>= 4) y favoritos
   * - Contenido similar de TMDB/AniList (discover/search por género)
   *
   * Sin señales suficientes -> fallback a trending general.
   */
  async forUser(userId: string) {
    const signalRows = await this.prisma.userContent.findMany({
      where: {
        userId,
        OR: [{ isFavorite: true }, { rating: { gte: 4 } }],
      },
      include: { content: true },
    });

    if (signalRows.length === 0) {
      return this.catalogService.trending();
    }

    const topGenres = this.rankGenres(
      signalRows.map((row) => row.content.genres),
    );
    if (topGenres.length === 0) {
      return this.catalogService.trending();
    }

    const alreadyTrackedContentIds = new Set(
      (
        await this.prisma.userContent.findMany({
          where: { userId },
          select: { contentId: true },
        })
      ).map((row) => row.contentId),
    );

    const [tmdbMovieIds, tmdbTvIds, anilistResults] = await Promise.all([
      this.tmdb.discoverByGenres(
        'movie',
        mapTmdbGenreNamesToIds(topGenres, 'movie'),
      ),
      this.tmdb.discoverByGenres('tv', mapTmdbGenreNamesToIds(topGenres, 'tv')),
      Promise.all(
        topGenres.map((genre) => this.anilist.discoverByGenre(genre)),
      ).then((r) => r.flat()),
    ]);

    const normalized = [
      ...tmdbMovieIds.results.map(normalizeTmdbSearchItem),
      ...tmdbTvIds.results.map(normalizeTmdbSearchItem),
      ...anilistResults.map(normalizeAniListMedia),
    ].filter((item): item is NormalizedContent => item !== null);

    const cached = await this.catalogService.cacheAll(normalized);

    const deduped = new Map(cached.map((item) => [item.id, item]));
    return [...deduped.values()]
      .filter((item) => !alreadyTrackedContentIds.has(item.id))
      .slice(0, RESULT_LIMIT);
  }

  private rankGenres(genreLists: string[][]): string[] {
    const frequency = new Map<string, number>();
    for (const genres of genreLists) {
      for (const genre of genres) {
        frequency.set(genre, (frequency.get(genre) ?? 0) + 1);
      }
    }

    return [...frequency.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_GENRES_COUNT)
      .map(([genre]) => genre);
  }
}
