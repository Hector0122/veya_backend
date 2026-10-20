import { forwardRef, Module } from '@nestjs/common';
import { TmdbModule } from '../tmdb/tmdb.module';
import { AnilistModule } from '../anilist/anilist.module';
import { CatalogModule } from '../catalog/catalog.module';
import { AiModule } from '../ai/ai.module';
import { OpenLibraryModule } from '../openlibrary/openlibrary.module';
import { RecommendationsService } from './recommendations.service';
import { BookRecommendationsService } from './book-recommendations.service';

@Module({
  imports: [
    TmdbModule,
    AnilistModule,
    AiModule,
    OpenLibraryModule,
    forwardRef(() => CatalogModule),
  ],
  providers: [RecommendationsService, BookRecommendationsService],
  exports: [RecommendationsService, BookRecommendationsService],
})
export class RecommendationsModule {}
