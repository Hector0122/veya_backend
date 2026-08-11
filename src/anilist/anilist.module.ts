import { Module } from '@nestjs/common';
import { AnilistService } from './anilist.service';

@Module({
  providers: [AnilistService],
  exports: [AnilistService],
})
export class AnilistModule {}
