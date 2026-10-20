import { BookRecommendationsService } from './book-recommendations.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { AiService } from '../ai/ai.service';
import type { OpenLibraryService } from '../openlibrary/openlibrary.service';
import type { CatalogService } from '../catalog/catalog.service';
import type { NormalizedContent } from '../catalog/types/normalized-content.type';
import type { OpenLibrarySearchDoc } from '../openlibrary/types/openlibrary.types';

const USER = 'user-1';

// Catálogo falso: lo que "existe" en Open Library.
const CATALOG: Record<string, OpenLibrarySearchDoc> = {
  'dark matter': {
    key: '/works/OL1W',
    title: 'Dark Matter',
    author_name: ['Blake Crouch'],
    subject: ['Science fiction'],
  },
  'the martian': {
    key: '/works/OL2W',
    title: 'The Martian',
    author_name: ['Andy Weir'],
    subject: ['Fiction'],
  },
  'gone girl': {
    key: '/works/OL3W',
    title: 'Gone Girl',
    author_name: ['Gillian Flynn'],
    subject: ['Thrillers'],
  },
  recursion: {
    key: '/works/OL9W',
    title: 'Recursion',
    author_name: ['Blake Crouch'],
    subject: ['Thrillers'],
  },
};

function aiResponse(titles: [string, string][]) {
  return JSON.stringify({
    recommendations: titles.map(([title, author]) => ({
      title,
      author,
      synopsis: `Sinopsis de ${title}`,
      genres: ['Suspenso'],
      reason: 'Porque te gustó Dark.',
      basedOn: ['Dark'],
    })),
  });
}

function setup({
  rows = [] as unknown[],
  current = [] as unknown[],
  aiText = null as string | null,
  configured = true,
} = {}) {
  const stored: { contentId: string; create: Record<string, unknown> }[] = [];

  const prisma = {
    userContent: { findMany: jest.fn().mockResolvedValue(rows) },
    bookSuggestion: {
      findMany: jest.fn(({ where }: { where: { status?: string } }) =>
        // findCurrent filtra por status "suggested"; buildSignal, por OR.
        Promise.resolve(
          where.status === 'suggested'
            ? [...current, ...stored.map((s) => s.create)]
            : [],
        ),
      ),
      updateMany: jest.fn(),
      upsert: jest.fn(
        ({
          where,
          create,
        }: {
          where: { uq_book_suggestion: { contentId: string } };
          create: Record<string, unknown>;
        }) => {
          stored.push({
            contentId: where.uq_book_suggestion.contentId,
            create,
          });
          return create;
        },
      ),
    },
  };
  const ai = {
    isConfigured: jest.fn(() => configured),
    generateJson: jest.fn(() =>
      Promise.resolve(aiText ? { text: aiText, provider: 'groq' } : null),
    ),
  };
  const lookup = (title: string) => {
    const doc = CATALOG[title.toLowerCase()];
    return Promise.resolve(doc ? [doc] : []);
  };
  const openLibrary = {
    searchByTitleAuthor: jest.fn((title: string) => lookup(title)),
    search: jest.fn(() => Promise.resolve([])),
  };
  const catalogService = {
    cacheAll: jest.fn((items: NormalizedContent[]) =>
      Promise.resolve(
        items.map((item) => ({ ...item, id: `content-${item.externalId}` })),
      ),
    ),
  };

  const service = new BookRecommendationsService(
    prisma as unknown as PrismaService,
    ai as unknown as AiService,
    openLibrary as unknown as OpenLibraryService,
    catalogService as unknown as CatalogService,
  );
  return { service, prisma, ai, stored, catalogService };
}

const darkRow = {
  status: 'terminado',
  rating: 5,
  isFavorite: false,
  content: {
    type: 'series',
    title: 'Dark',
    genres: ['Misterio'],
    externalId: '70523',
    metadata: {},
  },
};
const recursionRow = {
  status: 'terminado',
  rating: 5,
  isFavorite: false,
  content: {
    type: 'book',
    title: 'Recursion',
    genres: ['Suspenso'],
    externalId: 'OL9W',
    metadata: { authors: ['Blake Crouch'] },
  },
};

describe('BookRecommendationsService', () => {
  it('stores up to 3 verified AI suggestions with their reason', async () => {
    const { service, stored } = setup({
      rows: [darkRow],
      aiText: aiResponse([
        ['Dark Matter', 'Blake Crouch'],
        ['The Martian', 'Andy Weir'],
        ['Gone Girl', 'Gillian Flynn'],
        ['Dark Matter', 'Blake Crouch'],
      ]),
    });

    const result = await service.forUser(USER);

    expect(stored.map((s) => s.contentId)).toEqual([
      'content-OL1W',
      'content-OL2W',
      'content-OL3W',
    ]);
    expect(result).toHaveLength(3);
    expect(stored[0].create).toMatchObject({
      status: 'suggested',
      source: 'ai',
      reason: 'Porque te gustó Dark.',
      basedOn: ['Dark'],
    });
  });

  it('drops invented books and books the user already read', async () => {
    const { service, stored } = setup({
      rows: [darkRow, recursionRow],
      aiText: aiResponse([
        ['Recursion', 'Blake Crouch'],
        ['El libro inventado', 'Nadie'],
        ['Gone Girl', 'Gillian Flynn'],
      ]),
    });

    await service.forUser(USER);

    expect(stored.map((s) => s.contentId)).toEqual(['content-OL3W']);
  });

  it('uses AI genres when Open Library only says Fiction', async () => {
    const { service, catalogService } = setup({
      rows: [darkRow],
      aiText: aiResponse([['The Martian', 'Andy Weir']]),
    });

    await service.forUser(USER);

    const [items] = catalogService.cacheAll.mock.calls[0];
    expect(items[0].genres).toEqual(['Suspenso']);
  });

  it('stores nothing when the AI returns broken JSON', async () => {
    const { service, prisma } = setup({
      rows: [darkRow],
      aiText: 'no es json',
    });

    await expect(service.forUser(USER)).resolves.toEqual([]);
    expect(prisma.bookSuggestion.upsert).not.toHaveBeenCalled();
  });

  it('keeps current suggestions when both providers fail on refresh', async () => {
    const current = [{ id: 's-1', status: 'suggested' }];
    const { service, prisma } = setup({ rows: [darkRow], current });

    await expect(service.forUser(USER, { refresh: true })).resolves.toEqual(
      current,
    );
    expect(prisma.bookSuggestion.updateMany).not.toHaveBeenCalled();
  });

  it('reuses current suggestions without calling the AI', async () => {
    const current = [{ id: 's-1', status: 'suggested' }];
    const { service, ai } = setup({ rows: [darkRow], current });

    await expect(service.forUser(USER)).resolves.toEqual(current);
    expect(ai.generateJson).not.toHaveBeenCalled();
  });

  it('does not call the AI without positive signal', async () => {
    const { service, ai } = setup({ rows: [] });

    await service.forUser(USER);

    expect(ai.generateJson).not.toHaveBeenCalled();
  });

  it('does not call the AI when it is not configured', async () => {
    const { service, ai } = setup({ rows: [darkRow], configured: false });

    await service.forUser(USER);

    expect(ai.generateJson).not.toHaveBeenCalled();
  });
});
