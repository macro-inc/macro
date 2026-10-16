const TENOR_API_KEY = 'AIzaSyAyimkuYQYF_FXVALexPuGQctUWRURdCYQ';
const TENOR_CLIENT_KEY = 'macro_app';

export interface TenorGif {
  id: string;
  title: string;
  previewUrl: string;
  url: string;
  width: number;
  height: number;
}

interface TenorMediaFormat {
  url: string;
  dims: [number, number];
  duration?: number;
  size?: number;
}

interface TenorResult {
  id: string;
  title: string;
  media_formats: {
    gif?: TenorMediaFormat;
    tinygif?: TenorMediaFormat;
    nanogif?: TenorMediaFormat;
    mediumgif?: TenorMediaFormat;
  };
}

interface TenorSearchResponse {
  results: TenorResult[];
  next?: string;
}

function mapTenorResult(result: TenorResult): TenorGif | null {
  const gif = result.media_formats.gif ?? result.media_formats.mediumgif;
  const preview = result.media_formats.tinygif ?? result.media_formats.nanogif;

  if (!gif || !preview) return null;

  return {
    id: result.id,
    title: result.title,
    previewUrl: preview.url,
    url: gif.url,
    width: gif.dims[0],
    height: gif.dims[1],
  };
}

export async function searchTenorGifs(
  query: string,
  limit = 20
): Promise<TenorGif[]> {
  if (!query.trim()) {
    return fetchTrendingGifs(limit);
  }

  const params = new URLSearchParams({
    key: TENOR_API_KEY,
    client_key: TENOR_CLIENT_KEY,
    q: query,
    limit: String(limit),
    media_filter: 'gif,tinygif,nanogif,mediumgif',
  });

  const response = await fetch(
    `https://tenor.googleapis.com/v2/search?${params}`
  );

  if (!response.ok) {
    throw new Error(`Tenor API error: ${response.status}`);
  }

  const data: TenorSearchResponse = await response.json();
  return data.results
    .map(mapTenorResult)
    .filter((g): g is TenorGif => g !== null);
}

export async function fetchTrendingGifs(limit = 20): Promise<TenorGif[]> {
  const params = new URLSearchParams({
    key: TENOR_API_KEY,
    client_key: TENOR_CLIENT_KEY,
    limit: String(limit),
    media_filter: 'gif,tinygif,nanogif,mediumgif',
  });

  const response = await fetch(
    `https://tenor.googleapis.com/v2/featured?${params}`
  );

  if (!response.ok) {
    throw new Error(`Tenor API error: ${response.status}`);
  }

  const data: TenorSearchResponse = await response.json();
  return data.results
    .map(mapTenorResult)
    .filter((g): g is TenorGif => g !== null);
}
