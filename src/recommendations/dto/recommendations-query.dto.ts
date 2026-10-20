import { IsIn, IsOptional } from 'class-validator';
import { ContentType } from '../../common/constants/content.constants';

export class RecommendationsQueryDto {
  // Sin `type` se devuelven las recomendaciones audiovisuales de siempre;
  // los libros se piden explícitamente para no mezclarlos.
  @IsOptional()
  @IsIn([ContentType.BOOK])
  type?: ContentType.BOOK;
}
