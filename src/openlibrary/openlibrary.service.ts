import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import {
  OpenLibrarySearchDoc,
  OpenLibrarySearchResponse,
  OpenLibraryTrendingResponse,
  OpenLibraryWork,
} from './types/openlibrary.types';

export const OPEN_LIBRARY_COVER_BASE = 'https://covers.openlibrary.org/b/id';

const SEARCH_FIELDS =
  'key,title,author_name,subject,cover_i,first_publish_year';

@Injectable()
export class OpenLibraryService {
  private readonly logger = new Logger(OpenLibraryService.name);
  private readonly http: AxiosInstance;

  constructor(private readonly configService: ConfigService) {
    this.http = axios.create({
      baseURL: this.configService.get<string>('openLibrary.baseUrl'),
      // Open Library pide identificar la app en el User-Agent; sin él aplica
      // un límite de requests más bajo.
      headers: {
        'User-Agent': 'Veya (https://github.com/Hector0122/veya_backend)',
      },
      timeout: 8000,
    });
  }

  async search(query: string, limit = 20): Promise<OpenLibrarySearchDoc[]> {
    try {
      const { data } = await this.http.get<OpenLibrarySearchResponse>(
        '/search.json',
        { params: { q: query, limit, fields: SEARCH_FIELDS } },
      );
      return data.docs ?? [];
    } catch (error) {
      this.logger.warn(`search falló: ${(error as Error).message}`);
      return [];
    }
  }

  /** Búsqueda por campos, más precisa que `search` para comprobar que un
   *  libro sugerido por la IA existe. */
  async searchByTitleAuthor(
    title: string,
    author: string,
    limit = 5,
  ): Promise<OpenLibrarySearchDoc[]> {
    try {
      const { data } = await this.http.get<OpenLibrarySearchResponse>(
        '/search.json',
        { params: { title, author, limit, fields: SEARCH_FIELDS } },
      );
      return data.docs ?? [];
    } catch (error) {
      this.logger.warn(
        `searchByTitleAuthor falló: ${(error as Error).message}`,
      );
      return [];
    }
  }

  /** Libros mejor valorados de un subject; usado por el motor de géneros. */
  async searchBySubject(
    subject: string,
    limit = 30,
  ): Promise<OpenLibrarySearchDoc[]> {
    try {
      const { data } = await this.http.get<OpenLibrarySearchResponse>(
        '/search.json',
        { params: { subject, sort: 'rating', limit, fields: SEARCH_FIELDS } },
      );
      return data.docs ?? [];
    } catch (error) {
      this.logger.warn(`searchBySubject falló: ${(error as Error).message}`);
      return [];
    }
  }

  async getTrending(limit = 30): Promise<OpenLibrarySearchDoc[]> {
    try {
      const { data } = await this.http.get<OpenLibraryTrendingResponse>(
        '/trending/weekly.json',
        { params: { limit } },
      );
      return data.works ?? [];
    } catch (error) {
      this.logger.warn(`getTrending falló: ${(error as Error).message}`);
      return [];
    }
  }

  async getWork(workId: string): Promise<OpenLibraryWork | null> {
    try {
      const { data } = await this.http.get<OpenLibraryWork>(
        `/works/${workId}.json`,
      );
      return data;
    } catch (error) {
      this.logger.warn(`getWork(${workId}) falló: ${(error as Error).message}`);
      return null;
    }
  }
}
