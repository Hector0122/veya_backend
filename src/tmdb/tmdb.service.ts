import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import { TmdbDetails, TmdbSearchResponse } from './types/tmdb.types';

export const TMDB_POSTER_BASE = 'https://image.tmdb.org/t/p/w500';
export const TMDB_BACKDROP_BASE = 'https://image.tmdb.org/t/p/w1280';

@Injectable()
export class TmdbService {
  private readonly logger = new Logger(TmdbService.name);
  private readonly http: AxiosInstance;

  constructor(private readonly configService: ConfigService) {
    this.http = axios.create({
      baseURL: this.configService.get<string>('tmdb.baseUrl'),
      params: { api_key: this.configService.get<string>('tmdb.apiKey') },
      timeout: 8000,
    });
  }

  /** Busca películas y series en un solo llamado (endpoint multi de TMDB). */
  async searchMulti(query: string): Promise<TmdbSearchResponse> {
    try {
      const { data } = await this.http.get<TmdbSearchResponse>(
        '/search/multi',
        { params: { query, include_adult: false } },
      );
      return data;
    } catch (error) {
      this.logger.warn(`searchMulti falló: ${(error as Error).message}`);
      return { page: 1, results: [], total_pages: 0, total_results: 0 };
    }
  }

  async getMovieDetails(id: string | number): Promise<TmdbDetails | null> {
    return this.getDetails('movie', id);
  }

  async getTvDetails(id: string | number): Promise<TmdbDetails | null> {
    return this.getDetails('tv', id);
  }

  async getTrending(
    mediaType: 'movie' | 'tv' | 'all' = 'all',
    window: 'day' | 'week' = 'week',
  ): Promise<TmdbSearchResponse> {
    try {
      const { data } = await this.http.get<TmdbSearchResponse>(
        `/trending/${mediaType}/${window}`,
      );
      return data;
    } catch (error) {
      this.logger.warn(`getTrending falló: ${(error as Error).message}`);
      return { page: 1, results: [], total_pages: 0, total_results: 0 };
    }
  }

  /**
   * Búsqueda por género, usada por el motor de recomendaciones.
   * `page` permite paginar más allá del top-más-popular cuando el motor de
   * recomendaciones necesita ampliar el pool de candidatos (rotación).
   */
  async discoverByGenres(
    mediaType: 'movie' | 'tv',
    genreIds: number[],
    page = 1,
  ): Promise<TmdbSearchResponse> {
    try {
      const { data } = await this.http.get<TmdbSearchResponse>(
        `/discover/${mediaType}`,
        {
          params: {
            with_genres: genreIds.join(','),
            sort_by: 'popularity.desc',
            page,
          },
        },
      );
      return data;
    } catch (error) {
      this.logger.warn(`discoverByGenres falló: ${(error as Error).message}`);
      return { page: 1, results: [], total_pages: 0, total_results: 0 };
    }
  }

  private async getDetails(
    mediaType: 'movie' | 'tv',
    id: string | number,
  ): Promise<TmdbDetails | null> {
    try {
      const { data } = await this.http.get<TmdbDetails>(`/${mediaType}/${id}`);
      return data;
    } catch (error) {
      this.logger.warn(
        `getDetails(${mediaType}/${id}) falló: ${(error as Error).message}`,
      );
      return null;
    }
  }
}
