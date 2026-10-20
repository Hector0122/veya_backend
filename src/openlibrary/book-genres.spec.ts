import { normalizeBookSubjects } from './book-genres';

describe('normalizeBookSubjects', () => {
  it('maps Open Library thriller subjects to Suspenso and drops Ficción', () => {
    expect(
      normalizeBookSubjects([
        'Fiction, suspense',
        'Fiction, thrillers',
        'Fiction, thrillers, general',
        'nyt:combined-print-and-e-book-fiction=2019-06-30',
        'New York Times bestseller',
        'Epidemics',
      ]),
    ).toEqual(['Suspenso']);
  });

  it('does not count science fiction as Ciencia', () => {
    expect(
      normalizeBookSubjects([
        'Science fiction',
        'Science-fiction',
        'Fiction, science fiction',
      ]),
    ).toEqual(['Ciencia Ficción']);
  });

  it('keeps Ciencia for real science subjects', () => {
    expect(normalizeBookSubjects(['Popular science', 'Physics'])).toEqual([
      'Ciencia',
    ]);
  });

  it('does not match "art" inside other words', () => {
    expect(normalizeBookSubjects(['Heart disease', 'Party planning'])).toEqual([
      'Ficción',
    ]);
  });

  it('understands Spanish subjects', () => {
    expect(
      normalizeBookSubjects(['Novela de terror', 'Ciencia ficción']),
    ).toEqual(['Terror', 'Ciencia Ficción']);
  });

  it('returns at most 3 genres, most mentioned first', () => {
    expect(
      normalizeBookSubjects([
        'Fantasy',
        'Fantasy fiction',
        'Magic',
        'Adventure stories',
        'Romance',
        'Horror',
        'Humor',
      ]),
    ).toEqual(['Fantasía', 'Terror', 'Romance']);
  });

  it('falls back to Ficción when nothing matches', () => {
    expect(normalizeBookSubjects([])).toEqual(['Ficción']);
    expect(normalizeBookSubjects(['Spanish language books'])).toEqual([
      'Ficción',
    ]);
  });
});
