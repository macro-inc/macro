import { toast } from '@core/component/Toast/Toast';
import { ENABLE_PROFILE_PICTURES } from '@core/constant/featureFlags';
import { staticFileIdEndpoint } from '@core/constant/servers';
import { useProfilePictureUrl } from '@core/signal/profilePicture';
import { idToEmail } from '@core/user';
import { createStaticFile } from '@core/util/create';
import { createMemo, Show } from 'solid-js';
import { authServiceClient } from '../../service-auth/client';
import type { SizeClass } from './UserIcon';

type ProfilePictureProps = {
  id?: string;
  sizeClass: SizeClass;
  email?: string;
  // TODO: remove. Not being used.
  imageUrl?: string;
  fetchUrl?: boolean;
};

// 16 megabytes
const MAX_FILE_SIZE = 16 * 1000 * 1000;

export async function uploadProfilePicture(
  file: File
): Promise<{ id: string; url: string } | void> {
  if (file.size > MAX_FILE_SIZE) {
    return toast.failure('Image size too large');
  }

  try {
    const id = await createStaticFile(file);
    const url = staticFileIdEndpoint(id);
    await authServiceClient.putProfilePicture({ url });
    return { id, url };
  } catch (_error) {
    return toast.failure('Failed to upload profile picture');
  }
}

export function ProfilePicture(props: ProfilePictureProps) {
  const email = createMemo(() => {
    const id = props.id;
    if (!id) {
      return props.email || 'User';
    }

    return idToEmail(id);
  });

  if (!ENABLE_PROFILE_PICTURES) {
    return (
      <div class={`flex-shrink-0 ${props.sizeClass.text}`}>
        {email().substring(0, 1).toUpperCase()}
      </div>
    );
  }

  const [profilePicUrl] = useProfilePictureUrl(props.id);
  return (
    <Show
      when={profilePicUrl()}
      fallback={
        <div
          class={`shrink-0 ${props.sizeClass.container} flex items-center justify-center`}
          style={{
            'line-height': 0,
          }}
        >
          <span class={props.sizeClass.text}>
            {email().substring(0, 1).toUpperCase()}
          </span>
        </div>
      }
      keyed
    >
      {(url) => (
        <div
          class={`${props.sizeClass.container} flex-shrink-0 overflow-hidden rounded-full`}
        >
          <img
            src={url}
            class="object-cover rounded-full w-full h-full origin-[50%_20%]"
          />
        </div>
      )}
    </Show>
  );
}
