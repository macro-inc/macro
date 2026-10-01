import { staticFileIdEndpoint } from '@core/constant/servers';
import {
  createStaticUploadFile,
  createUploadFile,
} from '@core/util/uploadFile';
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
      const id = await createStaticUploadFile(createUploadFile(file));
      return staticFileIdEndpoint(id);
    },
  }));
}
