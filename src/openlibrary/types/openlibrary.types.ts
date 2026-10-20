/** Documento de `/search.json` (solo los campos pedidos en `fields`). */
export interface OpenLibrarySearchDoc {
  key: string; // "/works/OL20073906W"
  title: string;
  author_name?: string[];
  subject?: string[];
  cover_i?: number;
  first_publish_year?: number;
}

export interface OpenLibrarySearchResponse {
  numFound: number;
  docs: OpenLibrarySearchDoc[];
}

/** Respuesta de `/works/{id}.json`. Los autores vienen solo como keys, sin
 *  nombre, por eso el normalizador conserva los del cache. */
export interface OpenLibraryWork {
  key: string;
  title: string;
  description?: string | { type: string; value: string };
  subjects?: string[];
  covers?: number[];
  first_publish_date?: string;
}
