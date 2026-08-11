import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TmdbService } from '../tmdb/tmdb.service';
import { AnilistService } from '../anilist/anilist.service';
import { NormalizedContent } from './types/normalized-content.type';
import {
  normalizeAniListMedia,
  normalizeTmdbDetails,
  normalizeTmdbSearchItem,
} from './catalog.normalizer';

@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tmdb: TmdbService,
    private readonly anilist: AnilistService,
  ) {}

  /** Búsqueda unificada: TMDB (películas/series) + AniList (anime) en paralelo. */
  async search(query: string) {
    const [tmdbResults, anilistResults] = await Promise.all([
      this.tmdb.searchMulti(query),
      this.anilist.search(query),
    ]);

    const normalized = [
      ...tmdbResults.results
        .map(normalizeTmdbSearchItem)
        .filter((item): item is NormalizedContent => item !== null),
      ...anilistResults.map(normalizeAniListMedia),
    ];

    return this.cacheAll(normalized);
  }

  async trending() {
    const [tmdbMovies, tmdbTv, anilistTrending] = await Promise.all([
      this.tmdb.getTrending('movie'),
      this.tmdb.getTrending('tv'),
      this.anilist.getTrending(),
    ]);

    const normalized = [
      ...tmdbMovies.results.map(normalizeTmdbSearchItem),
      ...tmdbTv.results.map(normalizeTmdbSearchItem),
      ...anilistTrending.map(normalizeAniListMedia),
    ].filter((item): item is NormalizedContent => item !== null);

    return this.cacheAll(normalized);
  }

  /** Trae el detalle desde la caché local (contents), refrescando desde la fuente. */
  async getById(id: string) {
    const cached = await this.prisma.content.findUnique({ where: { id } });
    if (!cached) {
      throw new NotFoundException('Contenido no encontrado');
    }

    const fresh = await this.refreshFromSource(
      cached.source,
      cached.externalId,
      cached.type,
    );
    if (!fresh) return cached;

    return this.prisma.content.update({
      where: { id },
      data: { ...fresh, cachedAt: new Date() },
    });
  }

  private async refreshFromSource(
    source: string,
    externalId: string,
    type: string,
  ): Promise<NormalizedContent | null> {
    if (source === 'tmdb') {
      const mediaType = type === 'series' ? 'tv' : 'movie';
      const details =
        mediaType === 'tv'
          ? await this.tmdb.getTvDetails(externalId)
          : await this.tmdb.getMovieDetails(externalId);
      return details ? normalizeTmdbDetails(details, mediaType) : null;
    }

    if (source === 'anilist') {
      const media = await this.anilist.getById(Number(externalId));
      return media ? normalizeAniListMedia(media) : null;
    }

    return null;
  }

  /** Upsert en batch por (source, externalId); devuelve las filas ya con id interno.
   *  Público: lo reutiliza RecommendationsService para cachear sus resultados. */
  async cacheAll(items: NormalizedContent[]) {
    return Promise.all(
      items.map((item) =>
        this.prisma.content.upsert({
          where: {
            idx_contents_external: {
              source: item.source,
              externalId: item.externalId,
            },
          },
          create: item,
          update: { ...item, cachedAt: new Date() },
        }),
      ),
    );
  }
}
