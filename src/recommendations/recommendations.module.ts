import { forwardRef, Module } from '@nestjs/common';
import { TmdbModule } from '../tmdb/tmdb.module';
import { AnilistModule } from '../anilist/anilist.module';
import { CatalogModule } from '../catalog/catalog.module';
import { RecommendationsService } from './recommendations.service';

@Module({
  imports: [TmdbModule, AnilistModule, forwardRef(() => CatalogModule)],
  providers: [RecommendationsService],
  exports: [RecommendationsService],
})
export class RecommendationsModule {}
