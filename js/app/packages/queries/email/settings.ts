import { throwOnErr } from '@core/util/result';
import { queryClient } from '@queries/client';
import { emailClient } from '@service-email/client';
import type {
  ListLinksResponse,
  PatchSettingsResponse,
  Settings,
} from '@service-email/generated/schemas';
import { useMutation } from '@tanstack/solid-query';
import { type MutationCallbacks, withCallbacks } from '../utils';
import { emailKeys } from './keys';
import { useNonPrimaryEmailLinkIdHeader } from './link';

type UpdateSettingsVars = { linkId: string; settings: Settings };

type UpdateSettingsCallbacks = MutationCallbacks<
  PatchSettingsResponse,
  Error,
  UpdateSettingsVars
>;

/**
 * Patches one inbox's email settings (e.g. the signature). Scopes the request
 * to `linkId` via the `X-Email-Link-Id` header, then writes the server's
 * canonical (sanitized) settings back onto that link in the cached links list —
 * so `useEmailSignature` and the editor reflect exactly what was stored, with no
 * refetch. `settings` is a partial patch: omitted fields are left unchanged.
 */
export function useUpdateEmailSettingsMutation(
  callbacks?: UpdateSettingsCallbacks
) {
  const toHeaderLinkId = useNonPrimaryEmailLinkIdHeader();
  return useMutation(() => ({
    mutationFn: async ({ linkId, settings }: UpdateSettingsVars) =>
      throwOnErr(() =>
        emailClient.patchSettings({ settings }, toHeaderLinkId(linkId))
      ),

    ...withCallbacks<PatchSettingsResponse, Error, UpdateSettingsVars>(
      {
        onSuccess: (result, { linkId }) => {
          queryClient.setQueryData<ListLinksResponse>(
            emailKeys.links.queryKey,
            (old) =>
              old
                ? {
                    ...old,
                    links: old.links.map((link) =>
                      link.id === linkId
                        ? { ...link, settings: result.settings }
                        : link
                    ),
                  }
                : old
          );
        },
      },
      callbacks
    ),
  }));
}
