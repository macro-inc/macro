import { toast } from '@core/component/Toast/Toast';
import { createStaticFile } from '@core/util/create';
import { fireAndForget } from '@core/util/fireAndForget';
import { openFilePicker } from '@core/util/upload';
import {
  useChannelPicture,
  useSetChannelPictureMutation,
} from '@queries/channel/picture';
import type { Accessor } from 'solid-js';

const PICTURE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
];

function isAcceptedPicture(file: File) {
  if (!PICTURE_MIME_TYPES.includes(file.type) || file.size === 0) {
    toast.failure('Choose a PNG, JPG, WebP, or GIF image');
    return false;
  }
  if (file.size > 16 * 1000 * 1000) {
    toast.failure('Choose an image smaller than 16 MB');
    return false;
  }
  return true;
}

/**
 * Open the file picker for an image the server accepts as a channel picture,
 * explaining a rejected one with a toast. Pass the file to
 * `useChannelPictureEditor().upload` once the channel exists.
 */
export function chooseChannelPicture(onChoose: (file: File) => void) {
  openFilePicker(
    {
      acceptedMimeTypes: PICTURE_MIME_TYPES,
      acceptedFileExtensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'],
    },
    (files) => {
      const file = files[0];
      if (file && isAcceptedPicture(file)) onChoose(file);
    }
  );
}

/**
 * Upload and clear channel pictures, for menus that learn their channel when
 * the user acts rather than when the menu is built. Callers own the permission
 * check; `canEditChannelIdentity` is the rule the server enforces.
 */
export function useChannelPictureEditor() {
  const mutation = useSetChannelPictureMutation(createStaticFile);

  const save = async (
    channelId: string,
    file: File | null,
    failure = 'Could not update channel picture. Please try again.'
  ) => {
    try {
      await mutation.mutateAsync({ channelId, file });
      toast.success(
        file ? 'Channel picture updated' : 'Channel picture removed'
      );
    } catch (cause) {
      console.error('Failed to save channel picture', cause);
      toast.failure(failure);
    }
  };

  // Menu actions ignore a second request while one is saving.
  const saveFromMenu = (channelId: string, file: File | null) => {
    if (mutation.isPending) return;
    fireAndForget(save(channelId, file), 'channel-picture');
  };

  return {
    isPending: () => mutation.isPending,
    pickFile: (channelId: string) => {
      if (mutation.isPending) return;
      chooseChannelPicture((file) => saveFromMenu(channelId, file));
    },
    remove: (channelId: string) => saveFromMenu(channelId, null),
    /**
     * Save a picture chosen with `chooseChannelPicture` before the channel
     * existed. Each call saves, so channels created in quick succession all
     * keep their pictures. It runs after the dialog that chose it has closed,
     * so a failure says where to try again.
     */
    upload: (channelId: string, file: File) =>
      save(
        channelId,
        file,
        'Could not save the new channel’s picture. Set it again from the channel menu.'
      ),
  };
}

export function useChannelPictureActions(options: {
  channelId: Accessor<string>;
  canEdit: Accessor<boolean>;
}) {
  const picture = useChannelPicture(options.channelId);
  const editor = useChannelPictureEditor();

  const isAvailable = () =>
    options.canEdit() && !editor.isPending() && !picture.isLoading();

  return {
    hasPicture: () => !!picture.url(),
    isAvailable,
    pickFile: () => {
      if (isAvailable()) editor.pickFile(options.channelId());
    },
    remove: () => {
      if (isAvailable()) editor.remove(options.channelId());
    },
  };
}
