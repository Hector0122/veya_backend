import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { ContentStatus } from '../../common/constants/content.constants';

export class CreateTrackingDto {
  @IsUUID()
  contentId: string;

  // Ignorado para libros: un libro registrado siempre es un libro leído.
  @IsOptional()
  @IsEnum(ContentStatus)
  status?: ContentStatus = ContentStatus.PENDIENTE;

  // Opcionales al crear para poder marcar un libro leído y calificarlo en un
  // solo request.
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;

  @IsOptional()
  @IsBoolean()
  isFavorite?: boolean;

  @IsOptional()
  @IsString()
  notes?: string;
}
