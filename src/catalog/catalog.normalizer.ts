import {
  ContentSource,
  ContentType,
} from '../common/constants/content.constants';
import { TMDB_BACKDROP_BASE, TMDB_POSTER_BASE } from '../tmdb/tmdb.service';
import { mapTmdbGenreIds } from '../tmdb/tmdb-genres';
import { TmdbDetails, TmdbSearchResultItem } from '../tmdb/types/tmdb.types';
import { AniListMedia } from '../anilist/types/anilist.types';
import { OPEN_LIBRARY_COVER_BASE } from '../openlibrary/openlibrary.service';
import { normalizeBookSubjects } from '../openlibrary/book-genres';
import {
  OpenLibrarySearchDoc,
  OpenLibraryWork,
} from '../openlibrary/types/openlibrary.types';
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

function openLibraryCover(coverId?: number | null): string | null {
  return coverId && coverId > 0
    ? `${OPEN_LIBRARY_COVER_BASE}/${coverId}-L.jpg`
    : null;
}

function yearToDate(year?: number | null): Date | null {
  return year != null ? new Date(Date.UTC(year, 0, 1)) : null;
}

/** "/works/OL20073906W" -> "OL20073906W" */
function openLibraryWorkId(key: string): string {
  return key.replace(/^\/works\//, '');
}

export function normalizeOpenLibrarySearchDoc(
  doc: OpenLibrarySearchDoc,
): NormalizedContent {
  return {
    source: ContentSource.OPEN_LIBRARY,
    externalId: openLibraryWorkId(doc.key),
    type: ContentType.BOOK,
    title: doc.title || 'Sin título',
    originalTitle: null,
    posterUrl: openLibraryCover(doc.cover_i),
    backdropUrl: null,
    // La búsqueda no trae sinopsis; se completa al abrir el detalle.
    overview: null,
    // Sin subjects (p. ej. /trending) no se sabe el género: mejor ninguno
    // que un "Ficción" equivocado.
    genres: doc.subject?.length ? normalizeBookSubjects(doc.subject) : [],
    releaseDate: yearToDate(doc.first_publish_year),
    metadata: {
      authors: doc.author_name ?? [],
      firstPublishYear: doc.first_publish_year ?? null,
    },
  };
}

/** El work de Open Library no trae nombres de autor, así que se conservan
 *  los que ya estaban en el cache (vienen de la búsqueda). */
export function normalizeOpenLibraryWork(
  work: OpenLibraryWork,
  cached: { metadata: unknown; releaseDate: Date | null },
): NormalizedContent {
  const description =
    typeof work.description === 'string'
      ? work.description
      : (work.description?.value ?? null);

  return {
    source: ContentSource.OPEN_LIBRARY,
    externalId: openLibraryWorkId(work.key),
    type: ContentType.BOOK,
    title: work.title || 'Sin título',
    originalTitle: null,
    posterUrl: openLibraryCover(work.covers?.[0]),
    backdropUrl: null,
    overview: description?.trim() || null,
    genres: normalizeBookSubjects(work.subjects ?? []),
    releaseDate: cached.releaseDate,
    metadata: cached.metadata ?? {},
  };
}
