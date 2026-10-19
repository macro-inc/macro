import { staticFileIdEndpoint } from '@core/constant/servers';
import type { MediaSource } from '@macro-inc/graphics';
import { useBinaryDocumentQuery } from '@queries/storage/binary-document';
import type { Accessor } from 'solid-js';

export function useCanvasMediaSource(
  source: Accessor<MediaSource | undefined>
) {
  const query = useBinaryDocumentQuery(() => {
    const value = source();
    return value?.type === 'document' ? value.id : '';
  });
  return {
    url: () => {
      const value = source();
      if (!value) return undefined;
      if (value.type === 'url') return value.url;
      if (value.type === 'static') return staticFileIdEndpoint(value.id);
      return query.isSuccess ? query.data : undefined;
    },
    unavailable: () => source()?.type === 'document' && query.isError,
  };
}
