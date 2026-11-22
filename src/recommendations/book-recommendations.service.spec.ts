import { BookRecommendationsService } from './book-recommendations.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { AiService } from '../ai/ai.service';
import type { OpenLibraryService } from '../openlibrary/openlibrary.service';
import type { CatalogService } from '../catalog/catalog.service';
import type { NormalizedContent } from '../catalog/types/normalized-content.type';
import type { OpenLibrarySearchDoc } from '../openlibrary/types/openlibrary.types';

const USER = 'user-1';

function work(
  id: string,
  title: string,
  author: string,
  subject: string[] = [],
): OpenLibrarySearchDoc {
  return { key: `/works/${id}`, title, author_name: [author], subject };
}

// Catálogo falso: lo que "existe" en Open Library.
const CATALOG: Record<string, OpenLibrarySearchDoc> = {
  'dark matter': work('OL1W', 'Dark Matter', 'Blake Crouch', [
    'Science fiction',
  ]),
  'the martian': work('OL2W', 'The Martian', 'Andy Weir', ['Fiction']),
  'gone girl': work('OL3W', 'Gone Girl', 'Gillian Flynn', ['Thrillers']),
  recursion: work('OL9W', 'Recursion', 'Blake Crouch', ['Thrillers']),
};

// Resultados por subject, con el ruido real de Open Library: "The Hobbit"
// aparece etiquetado como horror.
const SUBJECTS: Record<string, OpenLibrarySearchDoc[]> = {
  thriller: [
    work('OL3W', 'Gone Girl', 'Gillian Flynn', ['Thrillers']),
    work('OL4W', 'The Silent Patient', 'Alex Michaelides', ['Suspense']),
    work('OL5W', 'Big Little Lies', 'Liane Moriarty', ['Mystery fiction']),
  ],
  horror: [
    work('OL6W', 'The Hobbit', 'J. R. R. Tolkien', ['Fantasy', 'Dragons']),
    work('OL7W', 'It', 'Stephen King', ['Horror fiction']),
  ],
  science_fiction: [
    work('OL1W', 'Dark Matter', 'Blake Crouch', ['Science fiction']),
  ],
};

const TRENDING = [
  work('OL8W', 'Atomic Habits', 'James Clear'),
  work('OL9W', 'Recursion', 'Blake Crouch'),
];

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

function row(
  type: string,
  title: string,
  genres: string[],
  extra: {
    rating?: number | null;
    isFavorite?: boolean;
    status?: string;
    externalId?: string;
  } = {},
) {
  return {
    status: extra.status ?? 'terminado',
    rating: extra.rating ?? null,
    isFavorite: extra.isFavorite ?? false,
    content: {
      type,
      title,
      genres,
      externalId: extra.externalId ?? title,
      metadata: {},
    },
  };
}

const darkRow = row('series', 'Dark', ['Misterio'], { rating: 5 });
const recursionRow = row('book', 'Recursion', ['Suspenso'], {
  rating: 5,
  externalId: 'OL9W',
});

function suggestion(externalId: string) {
  return {
    id: `s-${externalId}`,
    status: 'suggested',
    content: { externalId },
  };
}

function setup({
  rows = [] as unknown[],
  current = [] as unknown[],
  aiText = null as string | null,
  configured = true,
  subjects = SUBJECTS,
  trending = TRENDING,
} = {}) {
  const stored: { contentId: string; create: Record<string, unknown> }[] = [];

  const prisma = {
    userContent: {
      findMany: jest.fn().mockResolvedValue(rows),
      upsert: jest.fn(),
    },
    bookSuggestion: {
      findMany: jest.fn(({ where }: { where: { status?: string } }) =>
        // findCurrent filtra por status "suggested"; loadUserData, por OR.
        Promise.resolve(
          where.status === 'suggested'
            ? [...current, ...stored.map((s) => s.create)]
            : [],
        ),
      ),
      updateMany: jest.fn(),
      findFirst: jest.fn().mockResolvedValue(null),
      groupBy: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      update: jest.fn((args: unknown) => args),
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
  const openLibrary = {
    searchByTitleAuthor: jest.fn((title: string) => {
      const doc = CATALOG[title.toLowerCase()];
      return Promise.resolve(doc ? [doc] : []);
    }),
    search: jest.fn(() => Promise.resolve([])),
    searchBySubject: jest.fn((subject: string) =>
      Promise.resolve(subjects[subject] ?? []),
    ),
    getTrending: jest.fn(() => Promise.resolve(trending)),
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
  return { service, prisma, ai, openLibrary, stored, catalogService };
}

describe('BookRecommendationsService', () => {
  describe('with AI', () => {
    it('always fills 6 suggestions: AI first, then genres and trending', async () => {
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
        'content-OL4W',
        'content-OL5W',
        'content-OL8W',
      ]);
      expect(stored.map((s) => s.create.source)).toEqual([
        'ai',
        'ai',
        'ai',
        'genre',
        'genre',
        'trending',
      ]);
      expect(result).toHaveLength(6);
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

      const fromAi = stored.filter((s) => s.create.source === 'ai');
      expect(fromAi.map((s) => s.contentId)).toEqual(['content-OL3W']);
      expect(stored.map((s) => s.contentId)).not.toContain('content-OL9W');
    });

    it('only treats read books as taste; abandoned ones as dislikes', async () => {
      const { service, ai } = setup({
        rows: [
          darkRow,
          row('book', 'Quiero Leerlo', ['Fantasía'], { status: 'pendiente' }),
          row('book', 'Lo Dejé', ['Romance'], { status: 'abandonado' }),
          recursionRow,
        ],
        aiText: aiResponse([['Gone Girl', 'Gillian Flynn']]),
      });

      await service.forUser(USER);

      const prompt = (ai.generateJson.mock.calls[0] as unknown[])[0] as string;
      const [, block] = /\n<datos>\n([\s\S]*?)\n<\/datos>/.exec(prompt)!;
      const json = JSON.parse(block) as {
        noLeGusto: { titulo: string }[];
      };
      expect(block).toContain('Recursion');
      expect(block).not.toContain('Quiero Leerlo');
      expect(json.noLeGusto.map((item) => item.titulo)).toContain('Lo Dejé');
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

    it('reuses a full set of current suggestions without generating', async () => {
      const current = ['A', 'B', 'C', 'D', 'E', 'F'].map(suggestion);
      const { service, ai, openLibrary } = setup({ rows: [darkRow], current });

      await expect(service.forUser(USER)).resolves.toEqual(current);
      expect(ai.generateJson).not.toHaveBeenCalled();
      expect(openLibrary.searchBySubject).not.toHaveBeenCalled();
    });

    it('tops up missing suggestions without AI and keeps the current ones', async () => {
      const current = ['OL1W', 'OL2W', 'OL3W'].map(suggestion);
      const { service, ai, prisma, stored } = setup({
        rows: [darkRow],
        current,
      });

      const result = await service.forUser(USER);

      expect(ai.generateJson).not.toHaveBeenCalled();
      expect(prisma.bookSuggestion.updateMany).not.toHaveBeenCalled();
      expect(stored.map((s) => s.contentId)).toEqual([
        'content-OL4W',
        'content-OL5W',
        'content-OL8W',
      ]);
      expect(result).toHaveLength(6);
    });
  });

  describe('genre fallback', () => {
    it.each([
      ['the AI fails', { aiText: null }],
      ['the AI returns broken JSON', { aiText: 'no es json' }],
      ['the AI is not configured', { configured: false }],
    ])('recommends by genre when %s', async (_, options) => {
      const { service, stored } = setup({ rows: [darkRow], ...options });

      await service.forUser(USER);

      expect(stored.map((s) => s.contentId)).toEqual([
        'content-OL3W',
        'content-OL4W',
        'content-OL5W',
        'content-OL8W',
        'content-OL9W',
      ]);
      expect(stored[0].create).toMatchObject({
        source: 'genre',
        reason: null,
        basedOn: ['Dark'],
      });
    });

    it('drops books Open Library mislabels for the genre', async () => {
      const { service, stored } = setup({
        rows: [row('anime', 'Another', ['Horror'], { isFavorite: true })],
        configured: false,
      });

      await service.forUser(USER);

      const fromGenres = stored.filter((s) => s.create.source === 'genre');
      expect(fromGenres.map((s) => s.contentId)).toEqual(['content-OL7W']);
    });

    it('skips books the user already read', async () => {
      const { service, stored } = setup({
        rows: [
          darkRow,
          row('book', 'Gone Girl', ['Suspenso'], {
            rating: 5,
            externalId: 'OL3W',
          }),
        ],
        configured: false,
      });

      await service.forUser(USER);

      expect(stored.map((s) => s.contentId)).not.toContain('content-OL3W');
    });

    it('falls back to trending when there is no positive signal', async () => {
      const { service, stored, ai } = setup({
        rows: [recursionRow].map((r) => ({ ...r, rating: 1 })),
      });

      await service.forUser(USER);

      expect(ai.generateJson).not.toHaveBeenCalled();
      // Recursion está excluido por ser un libro leído.
      expect(stored.map((s) => s.contentId)).toEqual(['content-OL8W']);
      expect(stored[0].create).toMatchObject({
        source: 'trending',
        basedOn: [],
      });
    });

    it('does not label trending books as Ficción without subjects', async () => {
      const { service, catalogService } = setup();

      await service.forUser(USER);

      const [items] = catalogService.cacheAll.mock.calls[0];
      expect(items[0].genres).toEqual([]);
    });

    it('keeps current suggestions when everything fails on refresh', async () => {
      const current = [suggestion('OL1W')];
      const { service, prisma } = setup({
        rows: [darkRow],
        current,
        subjects: {},
        trending: [],
      });

      await expect(service.forUser(USER, { refresh: true })).resolves.toEqual(
        current,
      );
      expect(prisma.bookSuggestion.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('rankBookGenres', () => {
    const { service } = setup();

    it('weighs read books more than audiovisual taste', () => {
      const ranked = service.rankBookGenres({
        books: [row('book', 'Dune', ['Ciencia Ficción'], { rating: 5 })],
        audiovisual: [
          row('series', 'Dark', ['Misterio'], { rating: 5 }),
        ] as never[],
      } as never);

      expect(ranked.map((g) => g.genre)).toEqual([
        'Ciencia Ficción',
        'Suspenso',
      ]);
    });

    it('suppresses genres of books rated 1 or 2', () => {
      const ranked = service.rankBookGenres({
        books: [row('book', 'Twilight', ['Romance'], { rating: 1 })],
        audiovisual: [row('anime', 'Toradora', ['Romance'])],
      } as never);

      expect(ranked).toEqual([]);
    });

    it('maps AniList and TMDB genres and ignores unmapped ones', () => {
      const ranked = service.rankBookGenres({
        books: [],
        audiovisual: [
          row('anime', 'Steins;Gate', ['Sci-Fi', 'Sports']),
          row('movie', 'Coco', ['Animación', 'Familiar']),
        ],
      } as never);

      expect(ranked).toEqual([
        { genre: 'Ciencia Ficción', basedOn: ['Steins;Gate'] },
      ]);
    });
  });

  describe('refresh', () => {
    it('rejects a sixth batch within the hour', async () => {
      const { service, prisma, ai } = setup({ rows: [darkRow] });
      prisma.bookSuggestion.groupBy.mockResolvedValue(
        Array.from({ length: 5 }, (_, i) => ({ createdAt: new Date(i) })),
      );

      await expect(service.refresh(USER)).rejects.toMatchObject({
        status: 429,
      });
      expect(ai.generateJson).not.toHaveBeenCalled();
    });

    it('generates a new batch under the limit', async () => {
      const current = [suggestion('OL1W')];
      const { service, ai } = setup({ rows: [darkRow], current });

      await service.refresh(USER);

      // Con sugerencias vigentes, refresh igual genera.
      expect(ai.generateJson).toHaveBeenCalled();
    });
  });

  describe('updateStatus', () => {
    it('saves a suggestion owned by the user', async () => {
      const { service, prisma } = setup();
      prisma.bookSuggestion.findUnique.mockResolvedValue({
        id: 's-1',
        userId: USER,
        contentId: 'c-1',
      });

      await service.updateStatus(USER, 's-1', 'saved');

      expect(prisma.bookSuggestion.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'saved' } }),
      );
      // Queda en la lista como "quiero leer" sin pisar un estado previo.
      expect(prisma.userContent.upsert).toHaveBeenCalledWith({
        where: { uq_user_content: { userId: USER, contentId: 'c-1' } },
        create: { userId: USER, contentId: 'c-1', status: 'pendiente' },
        update: {},
      });
    });

    it('does not add a dismissed suggestion to the list', async () => {
      const { service, prisma } = setup();
      prisma.bookSuggestion.findUnique.mockResolvedValue({
        id: 's-1',
        userId: USER,
        contentId: 'c-1',
      });

      await service.updateStatus(USER, 's-1', 'dismissed');

      expect(prisma.userContent.upsert).not.toHaveBeenCalled();
    });

    it("rejects another user's suggestion", async () => {
      const { service, prisma } = setup();
      prisma.bookSuggestion.findUnique.mockResolvedValue({
        id: 's-1',
        userId: 'someone-else',
      });

      await expect(
        service.updateStatus(USER, 's-1', 'dismissed'),
      ).rejects.toMatchObject({ status: 403 });
      expect(prisma.bookSuggestion.update).not.toHaveBeenCalled();
    });

    it('returns 404 for an unknown suggestion', async () => {
      const { service, prisma } = setup();
      prisma.bookSuggestion.findUnique.mockResolvedValue(null);

      await expect(
        service.updateStatus(USER, 'nope', 'saved'),
      ).rejects.toMatchObject({ status: 404 });
    });
  });

  it('lists saved books still marked as "want to read"', async () => {
    const { service, prisma } = setup();

    await service.saved(USER);

    expect(prisma.bookSuggestion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: USER,
          status: 'saved',
          content: {
            userContents: {
              none: { userId: USER, status: { not: 'pendiente' } },
            },
          },
        },
      }),
    );
  });
});
