import { sanitizeEmailHtml } from '@macro-inc/email-renderer';
import { emailKeys } from '@queries/email/keys';
import type {
  Link,
  ListLinksResponse,
  Settings,
} from '@service-email/generated/schemas';
import { QueryClient, useQuery } from '@tanstack/solid-query';
import { ok } from 'neverthrow';
import { createMemo, createSignal } from 'solid-js';
import { signatureHtml } from './sample';

export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
});
export const link: Link = {
  id: 'signature-fixture-inbox',
  email_address: 'alex@example.com',
  macro_id: 'macro|alex@example.com',
  fusionauth_user_id: 'fixture-user',
  calendar_disabled: false,
  has_calendar_data: false,
  is_primary: true,
  is_sync_active: false,
  needs_calendar_permission: false,
  needs_reauth: false,
  provider: 'GMAIL',
  sync_status: 'UP_TO_DATE',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  settings: { signature: signatureHtml, signature_on_replies_forwards: true },
};
let settings = { ...link.settings };
const patches: Settings[] = [];
queryClient.setQueryData(emailKeys.links.queryKey, { links: [link] });
export const useNonPrimaryEmailLinkIdHeader = () => (id: string) => id;
export function useEmailLinksQuery() {
  return useQuery(() => ({
    queryKey: emailKeys.links.queryKey,
    queryFn: async (): Promise<ListLinksResponse> => ({
      links: [{ ...link, settings }],
    }),
    enabled: false,
  }));
}
export function useEmailSignature(linkId: () => string | undefined) {
  const query = useEmailLinksQuery();
  return createMemo(() =>
    query.isSuccess
      ? query.data.links.find((item) => item.id === linkId())?.settings
          .signature
      : undefined
  );
}
let refresh: Promise<void> | undefined;
let finishRefresh: (() => void) | undefined;
export async function refreshMailAccounts() {
  await refresh;
}
function holdAccountRefresh() {
  const pending = Promise.withResolvers<void>();
  refresh = pending.promise;
  finishRefresh = pending.resolve;
}
function releaseAccountRefresh() {
  finishRefresh?.();
  refresh = undefined;
  finishRefresh = undefined;
}
export const emailClient = {
  async patchSettings(input: { settings: Settings }) {
    patches.push(structuredClone(input.settings));
    const next = { ...input.settings };
    if (typeof next.signature === 'string' && next.signature) {
      const document = new DOMParser().parseFromString(
        sanitizeEmailHtml(next.signature),
        'text/html'
      );
      next.signature = document.head.innerHTML + document.body.innerHTML;
    }
    settings = { ...settings, ...next };
    return ok({ settings: { ...settings } });
  },
  async importGmailSignature() {
    settings = { ...settings, signature: signatureHtml };
    return ok({ settings: { ...settings } });
  },
};
export const SIGNATURE_IMAGES_UNRESOLVED_CODE = 'SIGNATURE_IMAGES_UNRESOLVED';
export const [status, setStatus] = createSignal('');
export const toast = { success: setStatus, failure: setStatus };
export function createUploadFile() {
  throw new Error('Uploads are not part of this fixture');
}
export async function createStaticUploadFile() {
  throw new Error('Uploads are not part of this fixture');
}
export function readState() {
  return {
    savedSignature: settings.signature,
    patches: structuredClone(patches),
  };
}

declare global {
  interface Window {
    signatureFixture: {
      readState: typeof readState;
      holdAccountRefresh: typeof holdAccountRefresh;
      releaseAccountRefresh: typeof releaseAccountRefresh;
    };
  }
}
window.signatureFixture = {
  readState,
  holdAccountRefresh,
  releaseAccountRefresh,
};
