import { IsEnum, IsOptional } from 'class-validator';
import {
  ContentStatus,
  ContentType,
} from '../../common/constants/content.constants';

export class ListTrackingQueryDto {
  @IsOptional()
  @IsEnum(ContentStatus)
  status?: ContentStatus;

  @IsOptional()
  favorite?: string; // 'true' | 'false', validado a boolean en el service

  // Sin `type` se devuelve solo lo audiovisual (los libros leídos tienen su
  // propia lista); con `type=book` se devuelven solo libros.
  @IsOptional()
  @IsEnum(ContentType)
  type?: ContentType;
}
