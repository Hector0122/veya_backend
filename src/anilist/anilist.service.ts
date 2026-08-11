import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import {
  AniListMedia,
  AniListMediaResponse,
  AniListPageResponse,
} from './types/anilist.types';

const MEDIA_FIELDS = `
  id
  title { romaji english native }
  description(asHtml: false)
  coverImage { large extraLarge }
  bannerImage
  genres
  startDate { year month day }
  averageScore
  status
  episodes
`;

const SEARCH_QUERY = `
  query ($search: String, $perPage: Int) {
    Page(page: 1, perPage: $perPage) {
      media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
        ${MEDIA_FIELDS}
      }
    }
  }
`;

const BY_GENRE_QUERY = `
  query ($genre: String, $perPage: Int) {
    Page(page: 1, perPage: $perPage) {
      media(genre: $genre, type: ANIME, sort: POPULARITY_DESC) {
        ${MEDIA_FIELDS}
      }
    }
  }
`;

const BY_ID_QUERY = `
  query ($id: Int) {
    Media(id: $id, type: ANIME) {
      ${MEDIA_FIELDS}
    }
  }
`;

const TRENDING_QUERY = `
  query ($perPage: Int) {
    Page(page: 1, perPage: $perPage) {
      media(type: ANIME, sort: TRENDING_DESC) {
        ${MEDIA_FIELDS}
      }
    }
  }
`;

@Injectable()
export class AnilistService {
  private readonly logger = new Logger(AnilistService.name);
  private readonly http: AxiosInstance;

  constructor(private readonly configService: ConfigService) {
    this.http = axios.create({
      baseURL: this.configService.get<string>('anilist.baseUrl'),
      timeout: 8000,
    });
  }

  async search(query: string, perPage = 20): Promise<AniListMedia[]> {
    return this.query<AniListPageResponse>(SEARCH_QUERY, {
      search: query,
      perPage,
    }).then((res) => res?.data.Page.media ?? []);
  }

  async getById(id: number): Promise<AniListMedia | null> {
    const res = await this.query<AniListMediaResponse>(BY_ID_QUERY, { id });
    return res?.data.Media ?? null;
  }

  async getTrending(perPage = 20): Promise<AniListMedia[]> {
    const res = await this.query<AniListPageResponse>(TRENDING_QUERY, {
      perPage,
    });
    return res?.data.Page.media ?? [];
  }

  async discoverByGenre(genre: string, perPage = 20): Promise<AniListMedia[]> {
    const res = await this.query<AniListPageResponse>(BY_GENRE_QUERY, {
      genre,
      perPage,
    });
    return res?.data.Page.media ?? [];
  }

  private async query<T>(
    query: string,
    variables: Record<string, unknown>,
  ): Promise<T | null> {
    try {
      const { data } = await this.http.post<T>('', { query, variables });
      return data;
    } catch (error) {
      this.logger.warn(`AniList query falló: ${(error as Error).message}`);
      return null;
    }
  }
}
