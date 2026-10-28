import { throwOnErr } from '@core/util/result';
import { staticFileClient } from '@service-static-files/client';
import { useMutation } from '@tanstack/solid-query';

export function usePrepareSharedMediaMutation() {
  return useMutation(() => ({
    gcTime: 0,
    mutationFn: (file: { name: string; mimeType: string }) =>
      throwOnErr(() =>
        staticFileClient.makePresignedUrl({
          file_name: file.name,
          content_type: file.mimeType,
        })
      ),
  }));
}
