import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { ContentStatus } from '../../common/constants/content.constants';

export class UpdateTrackingDto {
  @IsOptional()
  @IsEnum(ContentStatus)
  status?: ContentStatus;

  @IsOptional()
  @IsBoolean()
  isFavorite?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  currentSeason?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  currentEpisode?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
