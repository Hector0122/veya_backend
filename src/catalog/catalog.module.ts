import { forwardRef, Module } from '@nestjs/common';
import { TmdbModule } from '../tmdb/tmdb.module';
import { AnilistModule } from '../anilist/anilist.module';
import { RecommendationsModule } from '../recommendations/recommendations.module';
import { CatalogService } from './catalog.service';
import { CatalogController } from './catalog.controller';

@Module({
  imports: [TmdbModule, AnilistModule, forwardRef(() => RecommendationsModule)],
  controllers: [CatalogController],
  providers: [CatalogService],
  exports: [CatalogService],
})
export class CatalogModule {}
