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

    // Veya no registra lectura en curso: un libro en la lista es un libro leído.
    const isBook = content.type === (ContentType.BOOK as string);
    const status = isBook
      ? ContentStatus.TERMINADO
      : (dto.status ?? ContentStatus.PENDIENTE);
    const data = {
      status,
      rating: dto.rating,
      isFavorite: dto.isFavorite,
      notes: dto.notes,
      ...(isBook ? { finishedAt: new Date() } : {}),
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

    if (
      existing.content.type === (ContentType.BOOK as string) &&
      (dto.status !== undefined ||
        dto.currentSeason !== undefined ||
        dto.currentEpisode !== undefined)
    ) {
      throw new BadRequestException(
        'Un libro solo admite calificación, favorito y notas',
      );
    }

    const finishedAt =
      dto.status === ContentStatus.TERMINADO
        ? new Date()
        : dto.status
          ? null
          : existing.finishedAt;

    return this.prisma.userContent.update({
      where: { id },
      data: { ...dto, finishedAt },
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
