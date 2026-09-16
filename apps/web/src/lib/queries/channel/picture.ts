import { staticFileSizedEndpoint } from '@core/constant/servers';
import { throwOnErr } from '@core/util/result';
import { staticFileClient } from '@service-static-files/client';
import { storageServiceClient } from '@service-storage/client';
import { useMutation, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { queryClient } from '../client';
import { previewDataLoader } from '../preview/dataloader';
import { isChannelPreviewItem } from '../preview/types';
import { channelKeys } from './keys';

/** Refresh active pictures after reconnecting, including changes missed offline. */
export function invalidateChannelPictures() {
  void queryClient.invalidateQueries({ queryKey: channelKeys.picture._def });
}

/** Picture events carry only the channel ID; previews still enforce read access. */
export function handleChannelPictureChanged(payload: { channel_id: string }) {
  if (!payload || typeof payload.channel_id !== 'string') return;
  void queryClient.invalidateQueries({
    queryKey: channelKeys.picture(payload.channel_id).queryKey,
  });
}

async function waitForPictureUpload(fileId: string) {
  // S3 completion is recorded asynchronously by the static-file service.
  const maxAttempts = 30;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const metadata = await throwOnErr(() =>
      staticFileClient.getMetadata({ file_id: fileId })
    );
    if (metadata.is_uploaded) return;
    if (attempt < maxAttempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error('Picture upload confirmation timed out');
}

/** Reuse the batched REST preview loader, including when Soup uses GraphQL. */
export function useChannelPicture(channelId: Accessor<string>) {
  const query = useQuery(() => {
    const id = channelId();
    return {
      queryKey: channelKeys.picture(id).queryKey,
      queryFn: async () => {
        const preview = await previewDataLoader.load({
          id,
          type: 'channel',
        });
        return isChannelPreviewItem(preview)
          ? (preview.profilePictureId ?? null)
          : null;
      },
      staleTime: 60_000,
    };
  });

  // The icon keeps its fallback while loading; it must never suspend its row.
  const pictureId = () => (query.isSuccess ? query.data : null);
  return {
    url: () => {
      const id = pictureId();
      return id ? staticFileSizedEndpoint(id, 'small') : undefined;
    },
    isLoading: () => query.isPending,
    revision: () => query.dataUpdatedAt,
  };
}

export function useSetChannelPictureMutation(
  upload: (file: File) => Promise<string>
) {
  return useMutation(() => ({
    mutationFn: async (args: { channelId: string; file: File | null }) => {
      const pictureId = args.file ? await upload(args.file) : null;
      if (pictureId) await waitForPictureUpload(pictureId);
      await throwOnErr(() =>
        storageServiceClient.setChannelPicture({
          channel_id: args.channelId,
          profile_picture_id: pictureId,
        })
      );
      return pictureId;
    },
    onSuccess: async (pictureId, args) => {
      const queryKey = channelKeys.picture(args.channelId).queryKey;
      await queryClient.cancelQueries({ queryKey });
      queryClient.setQueryData(queryKey, pictureId);
    },
  }));
}
