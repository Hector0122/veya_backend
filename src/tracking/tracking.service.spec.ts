import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { TrackingService } from './tracking.service';
import { CreateTrackingDto } from './dto/create-tracking.dto';
import { UpdateTrackingDto } from './dto/update-tracking.dto';
import {
  ContentStatus,
  ContentType,
} from '../common/constants/content.constants';
import type { PrismaService } from '../prisma/prisma.service';

const USER = 'user-1';
const BOOK_ID = '11111111-1111-4111-8111-111111111111';
const MOVIE_ID = '22222222-2222-4222-8222-222222222222';

function makePrisma() {
  return {
    content: { findUnique: jest.fn() },
    userContent: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      upsert: jest.fn((args: unknown) => args),
      update: jest.fn((args: unknown) => args),
      delete: jest.fn(),
    },
  };
}

function ownedRow(type: ContentType, userId = USER) {
  return {
    id: 'row-1',
    userId,
    finishedAt: null,
    content: { type },
  };
}

describe('TrackingService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let service: TrackingService;

  beforeEach(() => {
    prisma = makePrisma();
    service = new TrackingService(prisma as unknown as PrismaService);
  });

  describe('list', () => {
    it('excludes books when no type is given, so the audiovisual list is unchanged', async () => {
      await service.list(USER, {});
      expect(prisma.userContent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: USER,
            content: { type: { not: ContentType.BOOK } },
          }) as unknown,
        }),
      );
    });

    it('returns only books with type=book', async () => {
      await service.list(USER, { type: ContentType.BOOK });
      expect(prisma.userContent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            content: { type: ContentType.BOOK },
          }) as unknown,
        }),
      );
    });
  });

  describe('create', () => {
    it('stores a book as read with its rating, ignoring the requested status', async () => {
      prisma.content.findUnique.mockResolvedValue({
        id: BOOK_ID,
        type: ContentType.BOOK,
      });

      await service.create(USER, {
        contentId: BOOK_ID,
        status: ContentStatus.VIENDO,
        rating: 4,
        isFavorite: true,
      });

      const { create } = prisma.userContent.upsert.mock.calls[0][0] as {
        create: Record<string, unknown>;
      };
      expect(create).toMatchObject({
        status: ContentStatus.TERMINADO,
        rating: 4,
        isFavorite: true,
      });
      expect(create.finishedAt).toBeInstanceOf(Date);
    });

    it('keeps the requested status for audiovisual content', async () => {
      prisma.content.findUnique.mockResolvedValue({
        id: MOVIE_ID,
        type: ContentType.MOVIE,
      });

      await service.create(USER, {
        contentId: MOVIE_ID,
        status: ContentStatus.VIENDO,
      });

      const { create } = prisma.userContent.upsert.mock.calls[0][0] as {
        create: Record<string, unknown>;
      };
      expect(create.status).toBe(ContentStatus.VIENDO);
      expect(create.finishedAt).toBeUndefined();
    });
  });

  describe('update', () => {
    it('lets a book change its rating', async () => {
      prisma.userContent.findUnique.mockResolvedValue(
        ownedRow(ContentType.BOOK),
      );
      await service.update(USER, 'row-1', { rating: 2 });
      expect(prisma.userContent.update).toHaveBeenCalled();
    });

    it.each([
      { status: ContentStatus.ABANDONADO },
      { currentSeason: 1 },
      { currentEpisode: 3 },
    ])('rejects audiovisual-only fields on a book: %o', async (dto) => {
      prisma.userContent.findUnique.mockResolvedValue(
        ownedRow(ContentType.BOOK),
      );
      await expect(service.update(USER, 'row-1', dto)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.userContent.update).not.toHaveBeenCalled();
    });

    it("rejects updating another user's book", async () => {
      prisma.userContent.findUnique.mockResolvedValue(
        ownedRow(ContentType.BOOK, 'someone-else'),
      );
      await expect(
        service.update(USER, 'row-1', { rating: 5 }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('remove', () => {
    it("rejects removing another user's book", async () => {
      prisma.userContent.findUnique.mockResolvedValue(
        ownedRow(ContentType.BOOK, 'someone-else'),
      );
      await expect(service.remove(USER, 'row-1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.userContent.delete).not.toHaveBeenCalled();
    });
  });
});

describe('rating validation', () => {
  it.each([0, 6, 3.5])(
    'rejects rating %p on create and update',
    async (rating) => {
      const create = plainToInstance(CreateTrackingDto, {
        contentId: BOOK_ID,
        rating,
      });
      const update = plainToInstance(UpdateTrackingDto, { rating });
      expect(await validate(create)).not.toHaveLength(0);
      expect(await validate(update)).not.toHaveLength(0);
    },
  );

  it('accepts ratings from 1 to 5', async () => {
    for (const rating of [1, 5]) {
      const dto = plainToInstance(CreateTrackingDto, {
        contentId: BOOK_ID,
        rating,
      });
      expect(await validate(dto)).toHaveLength(0);
    }
  });
});
