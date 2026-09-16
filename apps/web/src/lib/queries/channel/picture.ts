import { staticFileSizedEndpoint } from '@core/constant/servers';
import { throwOnErr } from '@core/util/result';
import { storageServiceClient } from '@service-storage/client';
import { useMutation, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { queryClient } from '../client';
import { previewDataLoader } from '../preview/dataloader';
import { isChannelPreviewItem } from '../preview/types';
import { channelKeys } from './keys';

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
  };
}

export function useSetChannelPictureMutation(
  upload: (file: File) => Promise<string>
) {
  return useMutation(() => ({
    mutationFn: async (args: { channelId: string; file: File | null }) => {
      const pictureId = args.file ? await upload(args.file) : null;
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
