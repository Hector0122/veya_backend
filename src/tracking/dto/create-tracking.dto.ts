import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { ContentStatus } from '../../common/constants/content.constants';

export class CreateTrackingDto {
  @IsUUID()
  contentId: string;

  @IsOptional()
  @IsEnum(ContentStatus)
  status?: ContentStatus = ContentStatus.PENDIENTE;

  @IsOptional()
  @IsString()
  notes?: string;
}
