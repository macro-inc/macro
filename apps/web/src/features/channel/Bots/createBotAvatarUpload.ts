import { toast } from '@core/component/Toast/Toast';
import { staticFileIdEndpoint } from '@core/constant/servers';
import { openFilePicker, uploadFile } from '@core/util/upload';
import { createSignal } from 'solid-js';

export function createBotAvatarUpload(onUploaded: (url: string) => void) {
  const [uploading, setUploading] = createSignal(false);

  const open = () => {
    openFilePicker(
      { acceptedMimeTypes: ['image/*'], multiple: false },
      async ([file]) => {
        if (!file) return;
        setUploading(true);
        try {
          const result = await uploadFile(file, 'static');
          if (result.failed || result.destination !== 'static') {
            toast.failure('Failed to upload avatar');
            return;
          }
          onUploaded(staticFileIdEndpoint(result.id));
        } finally {
          setUploading(false);
        }
      }
    );
  };

  return { open, uploading };
}
