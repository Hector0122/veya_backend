import {
  buildBookPrompt,
  hasPositiveSignal,
  parseAiSuggestions,
  pickMatchingDoc,
  TasteSignal,
} from './book-ai';

const emptySignal: TasteSignal = {
  readBooks: [],
  liked: [],
  seen: [],
  disliked: [],
  exclude: [],
};

describe('parseAiSuggestions', () => {
  const known = ['Dark', 'Recursion'];

  it('keeps valid items and cleans genres and basedOn', () => {
    const text = JSON.stringify({
      recommendations: [
        {
          title: ' Dark Matter ',
          author: 'Blake Crouch',
          synopsis: 'Un físico...',
          genres: ['Ciencia Ficción', 'Thriller', 'Ciencia Ficción'],
          reason: 'Porque te gustó Dark.',
          basedOn: ['dark', 'Breaking Bad'],
        },
      ],
    });

    expect(parseAiSuggestions(text, known)).toEqual([
      {
        title: 'Dark Matter',
        author: 'Blake Crouch',
        synopsis: 'Un físico...',
        genres: ['Ciencia Ficción'],
        reason: 'Porque te gustó Dark.',
        basedOn: ['Dark'],
      },
    ]);
  });

  it('drops items without title or author', () => {
    const text = JSON.stringify({
      recommendations: [{ title: 'Solo título' }, { author: 'Solo autor' }, 7],
    });
    expect(parseAiSuggestions(text, known)).toEqual([]);
  });

  it('returns nothing for broken JSON', () => {
    expect(parseAiSuggestions('no es json {', known)).toEqual([]);
    expect(parseAiSuggestions('{"recommendations": "x"}', known)).toEqual([]);
  });

  it('extracts JSON wrapped in text', () => {
    const text =
      'Aquí van: {"recommendations":[{"title":"Dune","author":"Frank Herbert"}]}';
    expect(parseAiSuggestions(text, known)).toHaveLength(1);
  });
});

describe('pickMatchingDoc', () => {
  const doc = (title: string, author: string) => ({
    key: `/works/${title}`,
    title,
    author_name: [author],
  });

  it('prefers an exact title over a prefix match', () => {
    const docs = [
      doc('Dune Messiah', 'Frank Herbert'),
      doc('Dune', 'Frank Herbert'),
    ];
    expect(
      pickMatchingDoc({ title: 'Dune', author: 'Frank Herbert' }, docs)?.title,
    ).toBe('Dune');
  });

  it('ignores accents and case', () => {
    const docs = [doc('Cien años de soledad', 'Gabriel García Márquez')];
    expect(
      pickMatchingDoc(
        { title: 'CIEN ANOS DE SOLEDAD', author: 'Gabriel Garcia Marquez' },
        docs,
      ),
    ).not.toBeNull();
  });

  it('rejects a matching title by another author', () => {
    const docs = [doc('Dune', 'SuperSummary')];
    expect(
      pickMatchingDoc({ title: 'Dune', author: 'Frank Herbert' }, docs),
    ).toBeNull();
  });

  it('treats a book not in the results as invented', () => {
    expect(
      pickMatchingDoc({ title: 'El libro inventado', author: 'Nadie' }, []),
    ).toBeNull();
  });
});

describe('buildBookPrompt', () => {
  it('labels dislikes and only sends taste data', () => {
    const prompt = buildBookPrompt({
      ...emptySignal,
      readBooks: [
        {
          title: 'Twilight',
          authors: ['Stephenie Meyer'],
          genres: ['Romance'],
          rating: 1,
          isFavorite: false,
        },
      ],
      liked: [{ title: 'Dark', type: 'series', genres: ['Misterio'] }],
    });

    expect(prompt).toContain('"titulo": "Twilight"');
    expect(prompt).toContain('"valoracion": "no le gustó"');
    expect(prompt).toContain('"tipo": "serie"');
    expect(prompt).not.toMatch(/@|userId|email/i);
  });
});

describe('hasPositiveSignal', () => {
  it('is false when the only signal is a disliked book', () => {
    expect(
      hasPositiveSignal({
        ...emptySignal,
        readBooks: [
          {
            title: 'X',
            authors: [],
            genres: [],
            rating: 1,
            isFavorite: false,
          },
        ],
      }),
    ).toBe(false);
  });

  it('is true with audiovisual content the user only watched', () => {
    expect(
      hasPositiveSignal({
        ...emptySignal,
        seen: [{ title: 'Dark', type: 'series', genres: [] }],
      }),
    ).toBe(true);
  });
});
