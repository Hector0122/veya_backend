export interface AniListMedia {
  id: number;
  title: {
    romaji?: string;
    english?: string;
    native?: string;
  };
  description?: string | null;
  coverImage?: {
    large?: string;
    extraLarge?: string;
  };
  bannerImage?: string | null;
  genres?: string[];
  startDate?: { year?: number; month?: number; day?: number };
  averageScore?: number | null;
  status?: string;
  episodes?: number | null;
}

export interface AniListPageResponse {
  data: {
    Page: {
      media: AniListMedia[];
    };
  };
}

export interface AniListMediaResponse {
  data: {
    Media: AniListMedia | null;
  };
}
