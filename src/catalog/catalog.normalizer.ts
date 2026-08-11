import {
  ContentSource,
  ContentType,
} from '../common/constants/content.constants';
import { TMDB_BACKDROP_BASE, TMDB_POSTER_BASE } from '../tmdb/tmdb.service';
import { mapTmdbGenreIds } from '../tmdb/tmdb-genres';
import { TmdbDetails, TmdbSearchResultItem } from '../tmdb/types/tmdb.types';
import { AniListMedia } from '../anilist/types/anilist.types';
import { NormalizedContent } from './types/normalized-content.type';

function stripHtml(html?: string | null): string | null {
  if (!html) return null;
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function safeDate(value?: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function normalizeTmdbSearchItem(
  item: TmdbSearchResultItem,
): NormalizedContent | null {
  const mediaType = item.media_type === 'tv' ? 'tv' : 'movie';
  if (item.media_type && !['movie', 'tv'].includes(item.media_type)) {
    return null; // ignora resultados de tipo "person"
  }

  return {
    source: ContentSource.TMDB,
    externalId: String(item.id),
    type: mediaType === 'tv' ? ContentType.SERIES : ContentType.MOVIE,
    title: item.title ?? item.name ?? 'Sin título',
    originalTitle: item.original_title ?? item.original_name ?? null,
    posterUrl: item.poster_path
      ? `${TMDB_POSTER_BASE}${item.poster_path}`
      : null,
    backdropUrl: item.backdrop_path
      ? `${TMDB_BACKDROP_BASE}${item.backdrop_path}`
      : null,
    overview: item.overview ?? null,
    genres: mapTmdbGenreIds(item.genre_ids, mediaType),
    releaseDate: safeDate(item.release_date ?? item.first_air_date),
    metadata: { voteAverage: item.vote_average ?? null },
  };
}

export function normalizeTmdbDetails(
  details: TmdbDetails,
  mediaType: 'movie' | 'tv',
): NormalizedContent {
  return {
    source: ContentSource.TMDB,
    externalId: String(details.id),
    type: mediaType === 'tv' ? ContentType.SERIES : ContentType.MOVIE,
    title: details.title ?? details.name ?? 'Sin título',
    originalTitle: details.original_title ?? details.original_name ?? null,
    posterUrl: details.poster_path
      ? `${TMDB_POSTER_BASE}${details.poster_path}`
      : null,
    backdropUrl: details.backdrop_path
      ? `${TMDB_BACKDROP_BASE}${details.backdrop_path}`
      : null,
    overview: details.overview ?? null,
    genres: (details.genres ?? []).map((g) => g.name),
    releaseDate: safeDate(details.release_date ?? details.first_air_date),
    metadata: {
      voteAverage: details.vote_average ?? null,
      status: details.status ?? null,
    },
  };
}

export function normalizeAniListMedia(media: AniListMedia): NormalizedContent {
  const { year, month, day } = media.startDate ?? {};
  const releaseDate =
    year != null ? new Date(Date.UTC(year, (month ?? 1) - 1, day ?? 1)) : null;

  return {
    source: ContentSource.ANILIST,
    externalId: String(media.id),
    type: ContentType.ANIME,
    title:
      media.title.english ??
      media.title.romaji ??
      media.title.native ??
      'Sin título',
    originalTitle: media.title.native ?? null,
    posterUrl: media.coverImage?.extraLarge ?? media.coverImage?.large ?? null,
    backdropUrl: media.bannerImage ?? null,
    overview: stripHtml(media.description),
    genres: media.genres ?? [],
    releaseDate,
    metadata: {
      averageScore: media.averageScore ?? null,
      status: media.status ?? null,
      episodes: media.episodes ?? null,
    },
  };
}
