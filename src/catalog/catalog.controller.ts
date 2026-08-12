import { Controller, Get, Param, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CatalogService } from './catalog.service';
import { SearchQueryDto } from './dto/search-query.dto';
import { RecommendationsService } from '../recommendations/recommendations.service';
import { SkipAuth } from '../auth/decorators/skip-auth.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';

// Rutas públicas que hacen proxy a TMDB/AniList — límite más bajo que el
// global para que nadie queme la cuota de las APIs externas.
@Throttle({ default: { limit: 30, ttl: 60000 } })
@Controller('catalog')
export class CatalogController {
  constructor(
    private readonly catalogService: CatalogService,
    private readonly recommendationsService: RecommendationsService,
  ) {}

  // Rutas estáticas primero: si no, ":id" las capturaría como si fueran un id.
  @SkipAuth()
  @Get('search')
  search(@Query() query: SearchQueryDto) {
    return this.catalogService.search(query.q);
  }

  @SkipAuth()
  @Get('trending')
  trending() {
    return this.catalogService.trending();
  }

  @Get('recommendations')
  recommendations(@CurrentUser() user: AuthenticatedUser) {
    return this.recommendationsService.forUser(user.userId);
  }

  @SkipAuth()
  @Get(':id')
  getById(@Param('id') id: string) {
    return this.catalogService.getById(id);
  }
}
