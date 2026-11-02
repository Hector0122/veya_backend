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

function ownedRow(
  type: ContentType,
  userId = USER,
  extra: { currentPage?: number | null; totalPages?: number | null } = {},
) {
  return {
    id: 'row-1',
    userId,
    finishedAt: null,
    currentPage: null,
    totalPages: null,
    ...extra,
    content: { type },
  };
}

function upsertCreate(prisma: ReturnType<typeof makePrisma>) {
  return (
    prisma.userContent.upsert.mock.calls[0][0] as {
      create: Record<string, unknown>;
    }
  ).create;
}

function updateData(prisma: ReturnType<typeof makePrisma>) {
  return (
    prisma.userContent.update.mock.calls[0][0] as {
      data: Record<string, unknown>;
    }
  ).data;
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
    it('stores a book without status as read (older app versions)', async () => {
      prisma.content.findUnique.mockResolvedValue({
        id: BOOK_ID,
        type: ContentType.BOOK,
        metadata: { pages: 320 },
      });

      await service.create(USER, {
        contentId: BOOK_ID,
        rating: 4,
        isFavorite: true,
      });

      const create = upsertCreate(prisma);
      expect(create).toMatchObject({
        status: ContentStatus.TERMINADO,
        rating: 4,
        isFavorite: true,
        totalPages: 320,
        currentPage: 320,
      });
      expect(create.finishedAt).toBeInstanceOf(Date);
    });

    it('stores a book as "want to read" with the pages from Open Library', async () => {
      prisma.content.findUnique.mockResolvedValue({
        id: BOOK_ID,
        type: ContentType.BOOK,
        metadata: { pages: 210 },
      });

      await service.create(USER, {
        contentId: BOOK_ID,
        status: ContentStatus.PENDIENTE,
      });

      const create = upsertCreate(prisma);
      expect(create).toMatchObject({
        status: ContentStatus.PENDIENTE,
        totalPages: 210,
      });
      expect(create.currentPage).toBeUndefined();
      expect(create.finishedAt).toBeUndefined();
    });

    it('rejects pages on audiovisual content', async () => {
      prisma.content.findUnique.mockResolvedValue({
        id: MOVIE_ID,
        type: ContentType.MOVIE,
      });
      await expect(
        service.create(USER, { contentId: MOVIE_ID, totalPages: 100 }),
      ).rejects.toBeInstanceOf(BadRequestException);
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

    it('lets a book move between reading states', async () => {
      prisma.userContent.findUnique.mockResolvedValue(
        ownedRow(ContentType.BOOK),
      );
      await service.update(USER, 'row-1', { status: ContentStatus.VIENDO });
      expect(updateData(prisma)).toMatchObject({
        status: ContentStatus.VIENDO,
        finishedAt: null,
      });
    });

    it('records the current page of a book', async () => {
      prisma.userContent.findUnique.mockResolvedValue(
        ownedRow(ContentType.BOOK, USER, { totalPages: 300 }),
      );
      await service.update(USER, 'row-1', { currentPage: 120 });
      expect(updateData(prisma)).toMatchObject({ currentPage: 120 });
    });

    it('rejects a current page beyond the total', async () => {
      prisma.userContent.findUnique.mockResolvedValue(
        ownedRow(ContentType.BOOK, USER, { totalPages: 300 }),
      );
      await expect(
        service.update(USER, 'row-1', { currentPage: 301 }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('moves a finished book to its last page', async () => {
      prisma.userContent.findUnique.mockResolvedValue(
        ownedRow(ContentType.BOOK, USER, { currentPage: 80, totalPages: 300 }),
      );
      await service.update(USER, 'row-1', { status: ContentStatus.TERMINADO });
      const data = updateData(prisma);
      expect(data.currentPage).toBe(300);
      expect(data.finishedAt).toBeInstanceOf(Date);
    });

    it('clamps the current page when the total shrinks', async () => {
      prisma.userContent.findUnique.mockResolvedValue(
        ownedRow(ContentType.BOOK, USER, { currentPage: 280, totalPages: 300 }),
      );
      await service.update(USER, 'row-1', { totalPages: 250 });
      expect(updateData(prisma)).toMatchObject({
        totalPages: 250,
        currentPage: 250,
      });
    });

    it.each([{ currentSeason: 1 }, { currentEpisode: 3 }])(
      'rejects audiovisual-only fields on a book: %o',
      async (dto) => {
        prisma.userContent.findUnique.mockResolvedValue(
          ownedRow(ContentType.BOOK),
        );
        await expect(service.update(USER, 'row-1', dto)).rejects.toBeInstanceOf(
          BadRequestException,
        );
        expect(prisma.userContent.update).not.toHaveBeenCalled();
      },
    );

    it.each([{ currentPage: 10 }, { totalPages: 100 }])(
      'rejects book-only fields on a movie: %o',
      async (dto) => {
        prisma.userContent.findUnique.mockResolvedValue(
          ownedRow(ContentType.MOVIE),
        );
        await expect(service.update(USER, 'row-1', dto)).rejects.toBeInstanceOf(
          BadRequestException,
        );
      },
    );

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
