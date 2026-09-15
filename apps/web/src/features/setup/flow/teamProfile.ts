import { toast } from '@core/component/Toast/Toast';
import { staticFileIdEndpoint } from '@core/constant/servers';
import { openFilePicker, uploadFile } from '@core/util/upload';
import { StartupType } from '@service-auth/generated/schemas/startupType';
import { createSignal } from 'solid-js';

export type StartupTypeOption = { value: StartupType; label: string };

/** The startup kinds offered on the onboarding team step, in display order.
 * Mirrors the `StartupType` enum in the teams crate — the server rejects
 * anything else, so keep the two in step. */
export const STARTUP_TYPE_OPTIONS: readonly StartupTypeOption[] = [
  { value: StartupType.ai, label: 'AI' },
  { value: StartupType.b2b_saas, label: 'B2B SaaS' },
  { value: StartupType.developer_tools, label: 'Developer tools' },
  { value: StartupType.fintech, label: 'Fintech' },
  { value: StartupType.healthcare_biotech, label: 'Healthcare & biotech' },
  { value: StartupType.consumer, label: 'Consumer' },
  {
    value: StartupType.marketplace_ecommerce,
    label: 'Marketplace & e-commerce',
  },
  { value: StartupType.hardware_deeptech, label: 'Hardware & deep tech' },
  { value: StartupType.climate_energy, label: 'Climate & energy' },
  { value: StartupType.other, label: 'Other' },
];

/** Picks an image, uploads it to the static file service, and hands back its
 * public URL — the team only stores the URL. Same path the bot avatar uses. */
export function createTeamLogoUpload(onUploaded: (url: string) => void) {
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
            toast.failure('Failed to upload logo');
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
