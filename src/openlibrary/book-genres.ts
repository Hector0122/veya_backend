/**
 * Lista controlada de géneros de libros (heredada de Vellum). Las
 * recomendaciones de libros, con IA o sin ella, solo trabajan con estos.
 */
export const BOOK_GENRES = [
  'Ficción',
  'Terror',
  'Suspenso',
  'Romance',
  'Fantasía',
  'Ciencia Ficción',
  'Historia',
  'Filosofía',
  'Biografía',
  'Negocios',
  'Autoayuda',
  'Ciencia',
  'Arte',
  'Humor',
  'Aventura',
] as const;

export type BookGenre = (typeof BOOK_GENRES)[number];

const MAX_GENRES = 3;

// Los subjects de Open Library son texto libre, en inglés o español
// ("Fiction, thrillers, suspense", "magic realism", "nyt:..."). Cada regla
// dice qué subjects cuentan para un género; `unless` evita falsos positivos
// como "science fiction" contando para Ciencia.
const RULES: { genre: BookGenre; match: RegExp; unless?: RegExp }[] = [
  { genre: 'Terror', match: /\b(horror|terror|ghost stor|vampire|zombie)/ },
  {
    genre: 'Suspenso',
    match: /\b(thriller|suspen[sc]|myster|misterio|detective|crime|policiac)/,
  },
  { genre: 'Romance', match: /\b(romance|love stor|romántic)/ },
  { genre: 'Fantasía', match: /\b(fantasy|fantas[ií]a|magic|dragon)/ },
  {
    genre: 'Ciencia Ficción',
    match:
      /\b(science[- ]fiction|sci-fi|ciencia ficci[oó]n|dystopi|time travel)/,
  },
  { genre: 'Historia', match: /\b(histor)/ },
  { genre: 'Filosofía', match: /\b(philosoph|filosof)/ },
  { genre: 'Biografía', match: /\b(biograph|autobiograph|memoir|biograf)/ },
  {
    genre: 'Negocios',
    match: /\b(business|economics|management|entrepreneur|finance|negocios)/,
  },
  {
    genre: 'Autoayuda',
    match: /\b(self-help|self-improvement|personal development|autoayuda)/,
  },
  {
    genre: 'Ciencia',
    match:
      /\b(science|physics|biology|astronomy|mathematics|chemistry|ciencia)/,
    unless: /(science[- ]fiction|ciencia ficci[oó]n)/,
  },
  { genre: 'Arte', match: /\b(art|arte|music|painting|photography)\b/ },
  { genre: 'Humor', match: /\b(humou?r|comedy|wit and humor)/ },
  { genre: 'Aventura', match: /\b(adventure|aventura)/ },
  { genre: 'Ficción', match: /\b(fiction|ficci[oó]n|novel|novela)/ },
];

/**
 * Traduce los subjects de Open Library a hasta 3 géneros de BOOK_GENRES,
 * ordenados por cuántos subjects los mencionan. "Ficción" solo queda si no
 * hay un género más específico; un libro sin coincidencias queda en Ficción.
 */
export function normalizeBookSubjects(subjects: string[]): BookGenre[] {
  const counts = new Map<BookGenre, number>();

  for (const raw of subjects) {
    const subject = raw.toLowerCase();
    // Etiquetas internas de Open Library ("nyt:...=2019-06-30"), no géneros.
    if (subject.includes(':')) continue;

    for (const rule of RULES) {
      if (rule.match.test(subject) && !rule.unless?.test(subject)) {
        counts.set(rule.genre, (counts.get(rule.genre) ?? 0) + 1);
      }
    }
  }

  const ranked = [...counts.entries()]
    .sort(
      (a, b) =>
        b[1] - a[1] || BOOK_GENRES.indexOf(a[0]) - BOOK_GENRES.indexOf(b[0]),
    )
    .map(([genre]) => genre);

  const specific = ranked.filter((genre) => genre !== 'Ficción');
  if (specific.length > 0) return specific.slice(0, MAX_GENRES);
  return ['Ficción'];
}
