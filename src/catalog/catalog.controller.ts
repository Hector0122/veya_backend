import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { SearchQueryDto } from './dto/search-query.dto';
import { RecommendationsService } from '../recommendations/recommendations.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';

@Controller('catalog')
export class CatalogController {
  constructor(
    private readonly catalogService: CatalogService,
    private readonly recommendationsService: RecommendationsService,
  ) {}

  // Rutas estáticas primero: si no, ":id" las capturaría como si fueran un id.
  @Get('search')
  search(@Query() query: SearchQueryDto) {
    return this.catalogService.search(query.q);
  }

  @Get('trending')
  trending() {
    return this.catalogService.trending();
  }

  @UseGuards(JwtAuthGuard)
  @Get('recommendations')
  recommendations(@CurrentUser() user: AuthenticatedUser) {
    return this.recommendationsService.forUser(user.userId);
  }

  @Get(':id')
  getById(@Param('id') id: string) {
    return this.catalogService.getById(id);
  }
}
