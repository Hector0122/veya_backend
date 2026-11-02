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

  // Sin estado: pendiente para lo audiovisual y leído para libros (así lo
  // mandan las versiones de la app anteriores a los estados de lectura).
  @IsOptional()
  @IsEnum(ContentStatus)
  status?: ContentStatus;

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

  @IsOptional()
  @IsInt()
  @Min(1)
  totalPages?: number;
}
