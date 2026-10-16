import { staticFileIdEndpoint } from '@core/constant/servers';
import { uploadFile } from '@core/util/upload';
import { Telemetry } from '@macro-inc/observability';
import { useMutation } from '@tanstack/solid-query';

const MAX_AVATAR_SIZE = 16 * 1000 * 1000;

/** Store image bytes separately so agent saves contain only a durable URL. */
export function useUploadAgentAvatarMutation() {
  return useMutation(() => ({
    gcTime: 0,
    mutationFn: async (file: File) => {
      if (file.size > MAX_AVATAR_SIZE) {
        throw new Error('Image size too large (maximum 16 MB)');
      }
      // The shared pipeline converts HEIC photos and holds automatic reloads
      // while the image is being uploaded.
      return Telemetry.span('agent.avatar.upload', async (span) => {
        span.setAttr('file.size', file.size);
        const result = await uploadFile(file, 'static');
        if (result.failed) {
          span.error(result.error);
          throw result.error;
        }
        span.setAttr('file.id', result.id);
        return staticFileIdEndpoint(result.id);
      });
    },
  }));
}
