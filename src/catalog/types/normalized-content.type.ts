import {
  ContentSource,
  ContentType,
} from '../../common/constants/content.constants';
import type { Prisma } from '../../../generated/prisma/client';

/** Forma unificada de un contenido, sin importar si viene de TMDB o AniList. */
export interface NormalizedContent {
  source: ContentSource;
  externalId: string;
  type: ContentType;
  title: string;
  originalTitle: string | null;
  posterUrl: string | null;
  backdropUrl: string | null;
  overview: string | null;
  genres: string[];
  releaseDate: Date | null;
  metadata: Prisma.InputJsonValue;
}
