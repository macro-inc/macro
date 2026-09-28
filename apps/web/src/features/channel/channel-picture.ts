import { toast } from '@core/component/Toast/Toast';
import { createStaticFile } from '@core/util/create';
import { openFilePicker } from '@core/util/upload';
import {
  useChannelPicture,
  useSetChannelPictureMutation,
} from '@queries/channel/picture';
import type { Accessor } from 'solid-js';

export function useChannelPictureActions(options: {
  channelId: Accessor<string>;
  canEdit: Accessor<boolean>;
}) {
  const picture = useChannelPicture(options.channelId);
  const mutation = useSetChannelPictureMutation(createStaticFile);

  const save = async (file: File | null) => {
    if (!options.canEdit() || mutation.isPending) return;
    if (
      file &&
      (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(
        file.type
      ) ||
        file.size === 0)
    ) {
      toast.failure('Choose a PNG, JPG, WebP, or GIF image');
      return;
    }
    if (file && file.size > 16 * 1000 * 1000) {
      toast.failure('Choose an image smaller than 16 MB');
      return;
    }
    try {
      await mutation.mutateAsync({ channelId: options.channelId(), file });
      toast.success(
        file ? 'Channel picture updated' : 'Channel picture removed'
      );
    } catch {
      toast.failure('Could not update channel picture. Please try again.');
    }
  };

  const pickFile = () => {
    if (!options.canEdit() || mutation.isPending) return;
    openFilePicker(
      {
        acceptedMimeTypes: [
          'image/jpeg',
          'image/png',
          'image/webp',
          'image/gif',
        ],
        acceptedFileExtensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'],
      },
      async (files) => {
        if (files[0]) await save(files[0]);
      }
    );
  };

  return {
    hasPicture: () => !!picture.url(),
    isAvailable: () =>
      options.canEdit() && !mutation.isPending && !picture.isLoading(),
    pickFile,
    remove: () => void save(null),
  };
}
