import { IsEnum, IsOptional } from 'class-validator';
import { ContentStatus } from '../../common/constants/content.constants';

export class ListTrackingQueryDto {
  @IsOptional()
  @IsEnum(ContentStatus)
  status?: ContentStatus;

  @IsOptional()
  favorite?: string; // 'true' | 'false', validado a boolean en el service
}
