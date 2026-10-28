import { throwOnErr } from '@core/util/result';
import { type Span, Telemetry } from '@macro-inc/observability';
import { queryClient } from '@queries/client';
import {
  emailClient,
  SIGNATURE_IMAGES_UNRESOLVED_CODE,
} from '@service-email/client';
import type {
  ListLinksResponse,
  PatchSettingsResponse,
  Settings,
} from '@service-email/generated/schemas';
import { useMutation } from '@tanstack/solid-query';
import { type MutationCallbacks, withCallbacks } from '../utils';
import { emailKeys } from './keys';
import { useNonPrimaryEmailLinkIdHeader } from './link';
import { refreshMailAccounts } from './mail-accounts';

type UpdateSettingsVars = { linkId: string; settings: Settings; span?: Span };

/** Keep the user action active through mutateAsync's write and success hooks. */
export function traceSignatureMutation(
  operation: 'save' | 'clear' | 'import',
  linkId: string,
  mutate: (
    span: Span
  ) => Promise<PatchSettingsResponse | ImportGmailSignatureResult>
): Promise<void> {
  return Telemetry.span(`email.signature.${operation}`, async (span) => {
    span.setAttr('email.link.id', linkId);
    try {
      const result = await mutate(span);
      const outcome =
        'success' in result && !result.success ? result.reason : 'success';
      span.setAttr('email.signature.outcome', outcome);
      if (outcome === 'error' || outcome === 'unresolved_images')
        span.error(`Signature import failed: ${outcome}`);
    } catch {
      // The mutation hook owns user feedback. Never trace signature content or
      // provider errors, which may contain private addresses or image URLs.
      span.setAttr('email.signature.outcome', 'error');
      span.error('Signature mutation failed');
    }
  });
}

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
    mutationFn: async ({ linkId, settings, span }: UpdateSettingsVars) =>
      throwOnErr(() =>
        emailClient.patchSettings({ settings }, toHeaderLinkId(linkId), span)
      ),

    ...withCallbacks<PatchSettingsResponse, Error, UpdateSettingsVars>(
      {
        onSuccess: async (result, { linkId, settings, span }) => {
          queryClient.setQueryData<ListLinksResponse>(
            emailKeys.links.queryKey,
            (old) =>
              old
                ? {
                    ...old,
                    links: old.links.map((link) => {
                      if (link.id !== linkId) return link;
                      // Apply only the keys this PATCH changed, with the
                      // canonical (sanitized) response values — so a concurrent
                      // partial PATCH to another field isn't clobbered by a
                      // stale full-settings snapshot.
                      const changed = Object.fromEntries(
                        Object.keys(settings).map((key) => [
                          key,
                          result.settings[key as keyof Settings],
                        ])
                      ) as Partial<Settings>;
                      return {
                        ...link,
                        settings: { ...link.settings, ...changed },
                      };
                    }),
                  }
                : old
          );
          // The REST write has committed. A failed catalog refresh must not
          // turn it into a failed settings mutation or prompt another save.
          try {
            await refreshMailAccounts(span);
          } catch (error) {
            Telemetry.error(
              error instanceof Error ? error : new Error(String(error))
            );
          }
        },
      },
      callbacks
    ),
  }));
}

type ImportGmailSignatureVars = { linkId: string; span?: Span };

export type ImportGmailSignatureResult =
  | { success: true; settings: Settings }
  | {
      success: false;
      reason: 'no_signature' | 'unresolved_images' | 'error';
    };

type ImportGmailSignatureCallbacks = MutationCallbacks<
  ImportGmailSignatureResult,
  Error,
  ImportGmailSignatureVars
>;

/**
 * Imports the email signature from Gmail for the specified inbox. The backend
 * fetches the signature from the Gmail Settings API and saves it to the user's
 * settings. The cached settings are updated on success.
 */
export function useImportGmailSignatureMutation(
  callbacks?: ImportGmailSignatureCallbacks
) {
  const toHeaderLinkId = useNonPrimaryEmailLinkIdHeader();
  return useMutation(() => ({
    mutationFn: async ({
      linkId,
      span,
    }: ImportGmailSignatureVars): Promise<ImportGmailSignatureResult> => {
      const result = await emailClient.importGmailSignature(
        toHeaderLinkId(linkId),
        span
      );
      return result.match(
        (response) => ({ success: true, settings: response.settings }),
        (errors) => {
          const has = (code: string) => errors.some((e) => e.code === code);
          if (has('NO_SIGNATURE_FOUND'))
            return { success: false, reason: 'no_signature' };
          if (has(SIGNATURE_IMAGES_UNRESOLVED_CODE))
            return { success: false, reason: 'unresolved_images' };
          return { success: false, reason: 'error' };
        }
      );
    },

    ...withCallbacks<
      ImportGmailSignatureResult,
      Error,
      ImportGmailSignatureVars
    >(
      {
        onSuccess: async (result, { linkId, span }) => {
          if (!result.success) return;
          queryClient.setQueryData<ListLinksResponse>(
            emailKeys.links.queryKey,
            (old) =>
              old
                ? {
                    ...old,
                    links: old.links.map((link) => {
                      if (link.id !== linkId) return link;
                      return {
                        ...link,
                        settings: { ...link.settings, ...result.settings },
                      };
                    }),
                  }
                : old
          );
          try {
            await refreshMailAccounts(span);
          } catch (error) {
            Telemetry.error(
              error instanceof Error ? error : new Error(String(error))
            );
          }
        },
      },
      callbacks
    ),
  }));
}
