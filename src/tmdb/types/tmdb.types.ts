export interface TmdbSearchResultItem {
  id: number;
  media_type?: 'movie' | 'tv' | 'person';
  title?: string; // movie
  name?: string; // tv
  original_title?: string;
  original_name?: string;
  overview?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  genre_ids?: number[];
  release_date?: string; // movie
  first_air_date?: string; // tv
  vote_average?: number;
}

export interface TmdbSearchResponse {
  page: number;
  results: TmdbSearchResultItem[];
  total_pages: number;
  total_results: number;
}

export interface TmdbGenre {
  id: number;
  name: string;
}

export interface TmdbDetails {
  id: number;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  overview?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  genres?: TmdbGenre[];
  release_date?: string;
  first_air_date?: string;
  vote_average?: number;
  status?: string;
}
