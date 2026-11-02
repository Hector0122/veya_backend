import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTrackingDto } from './dto/create-tracking.dto';
import { UpdateTrackingDto } from './dto/update-tracking.dto';
import { ListTrackingQueryDto } from './dto/list-tracking-query.dto';
import {
  ContentStatus,
  ContentType,
} from '../common/constants/content.constants';

@Injectable()
export class TrackingService {
  constructor(private readonly prisma: PrismaService) {}

  list(userId: string, filters: ListTrackingQueryDto) {
    return this.prisma.userContent.findMany({
      where: {
        userId,
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.favorite !== undefined
          ? { isFavorite: filters.favorite === 'true' }
          : {}),
        content: filters.type
          ? { type: filters.type }
          : { type: { not: ContentType.BOOK } },
      },
      include: { content: true },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async create(userId: string, dto: CreateTrackingDto) {
    const content = await this.prisma.content.findUnique({
      where: { id: dto.contentId },
    });
    if (!content) throw new NotFoundException('Contenido no encontrado');

    const isBook = content.type === (ContentType.BOOK as string);
    if (!isBook && dto.totalPages !== undefined) {
      throw new BadRequestException('Solo los libros tienen páginas');
    }

    // Sin estado, un libro se registra como leído: es lo que mandan las
    // versiones de la app anteriores a los estados de lectura.
    const status =
      dto.status ??
      (isBook ? ContentStatus.TERMINADO : ContentStatus.PENDIENTE);
    const totalPages =
      dto.totalPages ?? (isBook ? pagesOf(content) : undefined);
    const finished = status === ContentStatus.TERMINADO;
    const data = {
      status,
      rating: dto.rating,
      isFavorite: dto.isFavorite,
      notes: dto.notes,
      ...(totalPages ? { totalPages } : {}),
      ...(finished ? { finishedAt: new Date() } : {}),
      ...(finished && isBook && totalPages ? { currentPage: totalPages } : {}),
    };

    return this.prisma.userContent.upsert({
      where: { uq_user_content: { userId, contentId: dto.contentId } },
      create: { userId, contentId: dto.contentId, ...data },
      update: data,
      include: { content: true },
    });
  }

  async update(userId: string, id: string, dto: UpdateTrackingDto) {
    const existing = await this.findOwned(userId, id);
    const isBook = existing.content.type === (ContentType.BOOK as string);

    if (
      isBook &&
      (dto.currentSeason !== undefined || dto.currentEpisode !== undefined)
    ) {
      throw new BadRequestException(
        'Un libro no tiene temporadas ni episodios',
      );
    }
    if (
      !isBook &&
      (dto.currentPage !== undefined || dto.totalPages !== undefined)
    ) {
      throw new BadRequestException('Solo los libros tienen páginas');
    }

    const totalPages = dto.totalPages ?? existing.totalPages;
    if (
      dto.currentPage !== undefined &&
      totalPages !== null &&
      dto.currentPage > totalPages
    ) {
      throw new BadRequestException(
        `La página actual no puede pasar de ${totalPages}`,
      );
    }

    const finishedAt =
      dto.status === ContentStatus.TERMINADO
        ? new Date()
        : dto.status
          ? null
          : existing.finishedAt;

    // Terminar un libro lo deja en la última página; achicar el total no
    // puede dejar la página actual por encima.
    let currentPage = dto.currentPage;
    if (isBook && currentPage === undefined) {
      if (dto.status === ContentStatus.TERMINADO && totalPages !== null) {
        currentPage = totalPages;
      } else if (
        dto.totalPages !== undefined &&
        existing.currentPage !== null
      ) {
        currentPage = Math.min(existing.currentPage, dto.totalPages);
      }
    }

    return this.prisma.userContent.update({
      where: { id },
      data: {
        ...dto,
        ...(currentPage !== undefined ? { currentPage } : {}),
        finishedAt,
      },
      include: { content: true },
    });
  }

  async remove(userId: string, id: string) {
    await this.findOwned(userId, id);
    await this.prisma.userContent.delete({ where: { id } });
    return { success: true };
  }

  private async findOwned(userId: string, id: string) {
    const row = await this.prisma.userContent.findUnique({
      where: { id },
      include: { content: true },
    });
    if (!row) throw new NotFoundException('Registro no encontrado');
    if (row.userId !== userId) {
      throw new ForbiddenException('No podés modificar este registro');
    }
    return row;
  }
}

/** Páginas que Open Library estima para el libro (`metadata.pages`). */
function pagesOf(content: { metadata: unknown }): number | undefined {
  const pages = (content.metadata as { pages?: unknown } | null)?.pages;
  return typeof pages === 'number' && pages > 0 ? pages : undefined;
}
