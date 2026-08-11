import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTrackingDto } from './dto/create-tracking.dto';
import { UpdateTrackingDto } from './dto/update-tracking.dto';
import { ListTrackingQueryDto } from './dto/list-tracking-query.dto';
import { ContentStatus } from '../common/constants/content.constants';

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

    return this.prisma.userContent.upsert({
      where: { uq_user_content: { userId, contentId: dto.contentId } },
      create: {
        userId,
        contentId: dto.contentId,
        status: dto.status ?? ContentStatus.PENDIENTE,
        notes: dto.notes,
      },
      update: {
        status: dto.status ?? ContentStatus.PENDIENTE,
        notes: dto.notes,
      },
      include: { content: true },
    });
  }

  async update(userId: string, id: string, dto: UpdateTrackingDto) {
    const existing = await this.findOwned(userId, id);

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
    const row = await this.prisma.userContent.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Registro no encontrado');
    if (row.userId !== userId) {
      throw new ForbiddenException('No podés modificar este registro');
    }
    return row;
  }
}
