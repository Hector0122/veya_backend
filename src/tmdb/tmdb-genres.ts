/**
 * Diccionario estático de géneros de TMDB (IDs estables en su API pública).
 * https://developer.themoviedb.org/reference/genre-movie-list
 * https://developer.themoviedb.org/reference/genre-tv-list
 */
export const TMDB_MOVIE_GENRES: Record<number, string> = {
  28: 'Acción',
  12: 'Aventura',
  16: 'Animación',
  35: 'Comedia',
  80: 'Crimen',
  99: 'Documental',
  18: 'Drama',
  10751: 'Familiar',
  14: 'Fantasía',
  36: 'Historia',
  27: 'Terror',
  10402: 'Música',
  9648: 'Misterio',
  10749: 'Romance',
  878: 'Ciencia ficción',
  10770: 'Película de TV',
  53: 'Suspenso',
  10752: 'Bélica',
  37: 'Western',
};

export const TMDB_TV_GENRES: Record<number, string> = {
  10759: 'Acción y aventura',
  16: 'Animación',
  35: 'Comedia',
  80: 'Crimen',
  99: 'Documental',
  18: 'Drama',
  10751: 'Familiar',
  10762: 'Infantil',
  9648: 'Misterio',
  10763: 'Noticias',
  10764: 'Reality',
  10765: 'Ciencia ficción y fantasía',
  10766: 'Telenovela',
  10767: 'Talk show',
  10768: 'Guerra y política',
  37: 'Western',
};

function reverseMap(
  dictionary: Record<number, string>,
): Record<string, number> {
  return Object.fromEntries(
    Object.entries(dictionary).map(([id, name]) => [name, Number(id)]),
  );
}

const MOVIE_GENRE_NAME_TO_ID = reverseMap(TMDB_MOVIE_GENRES);
const TV_GENRE_NAME_TO_ID = reverseMap(TMDB_TV_GENRES);

export function mapTmdbGenreNamesToIds(
  names: string[],
  mediaType: 'movie' | 'tv',
): number[] {
  const dictionary =
    mediaType === 'movie' ? MOVIE_GENRE_NAME_TO_ID : TV_GENRE_NAME_TO_ID;
  return names
    .map((name) => dictionary[name])
    .filter((id): id is number => Boolean(id));
}

export function mapTmdbGenreIds(
  ids: number[] | undefined,
  mediaType: 'movie' | 'tv',
): string[] {
  if (!ids?.length) return [];
  const dictionary = mediaType === 'movie' ? TMDB_MOVIE_GENRES : TMDB_TV_GENRES;
  return ids
    .map((id) => dictionary[id])
    .filter((name): name is string => Boolean(name));
}
