/** Estados posibles de un contenido en la lista de un usuario. */
export enum ContentStatus {
  PENDIENTE = 'pendiente',
  VIENDO = 'viendo',
  TERMINADO = 'terminado',
  ABANDONADO = 'abandonado',
}

/** Tipo de contenido del catálogo. */
export enum ContentType {
  MOVIE = 'movie',
  SERIES = 'series',
  ANIME = 'anime',
}

/** Origen/catálogo externo del contenido. */
export enum ContentSource {
  TMDB = 'tmdb',
  ANILIST = 'anilist',
}
