import { STATIC_IMAGE } from '@core/store/cacheChannelInput';

const STATIC_FILE_ID = /\/file\/([0-9a-fA-F-]{36})/;
const MARKDOWN_IMAGE = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*"\s*)?\)/g;
const CONSTRAINED_IMAGE = /<m-image>([\s\S]*?)<\/m-image>/g;

export type LiftedChannelImage = {
  entity_id: string;
  entity_type: typeof STATIC_IMAGE;
  width: number | null;
  height: number | null;
};

export type LiftedChannelImages = {
  content: string;
  images: LiftedChannelImage[];
};

function staticFileId(url: string): string | undefined {
  const match = STATIC_FILE_ID.exec(url);
  return match?.[1];
}

function positiveInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function isFence(line: string): boolean {
  const trimmed = line.trimStart();
  return trimmed.startsWith('```') || trimmed.startsWith('~~~');
}

function liftLine(
  line: string,
  images: LiftedChannelImage[],
  seen: Set<string>
): string {
  const collect = (id: string, width: number | null, height: number | null) => {
    if (seen.has(id)) return;
    seen.add(id);
    images.push({
      entity_id: id,
      entity_type: STATIC_IMAGE,
      width,
      height,
    });
  };

  const withoutConstrained = line.replace(CONSTRAINED_IMAGE, (_, payload) => {
    try {
      const data = JSON.parse(payload) as {
        url?: string;
        width?: number;
        height?: number;
      };
      const id = data.url ? staticFileId(data.url) : undefined;
      if (id) collect(id, positiveInt(data.width), positiveInt(data.height));
    } catch {
      // Invalid <m-image> payloads are dropped from the body.
    }
    return '';
  });

  const withoutMarkdown = withoutConstrained.replace(
    MARKDOWN_IMAGE,
    (_, _alt, url: string) => {
      const id = staticFileId(url);
      if (id) collect(id, null, null);
      return '';
    }
  );

  const cleaned = withoutMarkdown.replace(/[ \t]{2,}/g, ' ').trimEnd();
  return cleaned.trim() === '' ? '' : cleaned;
}

/** Lift Markdown images out of channel content onto the attachment path. */
export function liftChannelMarkdownImages(
  content: string
): LiftedChannelImages {
  const images: LiftedChannelImage[] = [];
  const seen = new Set<string>();
  const lines = content.split('\n');
  const next: string[] = [];
  let inFence = false;

  for (const line of lines) {
    if (isFence(line)) {
      inFence = !inFence;
      next.push(line);
      continue;
    }
    if (inFence) {
      next.push(line);
      continue;
    }
    next.push(liftLine(line, images, seen));
  }

  const collapsed = next
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+|\n+$/g, '');

  return { content: collapsed, images };
}
