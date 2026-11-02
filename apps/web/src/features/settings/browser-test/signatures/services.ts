import { fireAndForget } from '@core/util/fireAndForget';
import { sanitizeEmailHtml } from '@macro-inc/email-renderer';
import { authKeys } from '@queries/auth/keys';
import { emailKeys } from '@queries/email/keys';
import type {
  Link,
  ListLinksResponse,
  Settings,
} from '@service-email/generated/schemas';
import { QueryClient, useQuery } from '@tanstack/solid-query';
import { ok } from 'neverthrow';
import { batch, createMemo, createSignal } from 'solid-js';
import { signatureHtml } from './sample';

export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
});
export const queryPersistence = { restoreQuery: async () => {} };
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
queryClient.setQueryData(authKeys.userInfo.queryKey, {
  id: link.macro_id,
  authenticated: true,
});
queryClient.setQueryData(emailKeys.links(link.macro_id).queryKey, {
  links: [link],
});
const [activeViewer, setActiveViewer] = createSignal(link.macro_id);
export const useUserId = () => activeViewer;
let holdSources = false;
const sourceWaiters: Array<() => void> = [];
let heldSources = Promise.withResolvers<void>();
async function holdSourceResponse() {
  if (!holdSources) return;
  const waiting = new Promise<void>((resolve) => sourceWaiters.push(resolve));
  if (sourceWaiters.length === 2) heldSources.resolve();
  await waiting;
}
function waitForHeldSources() {
  return heldSources.promise;
}
export function refreshHeldAccountSources() {
  holdSources = true;
  heldSources = Promise.withResolvers<void>();
  fireAndForget(
    queryClient.refetchQueries({ type: 'active' }),
    'account-fixture'
  );
}
export function switchFixtureAccount() {
  holdSources = false;
  batch(() => {
    queryClient.setQueryData(authKeys.userInfo.queryKey, {
      id: 'macro|other@example.com',
      authenticated: true,
    });
    setActiveViewer('macro|other@example.com');
  });
}
export function releaseAccountSources() {
  for (const resolve of sourceWaiters.splice(0)) resolve();
}
export const storageServiceClient = {
  async getChannels() {
    const name =
      activeViewer() === link.macro_id ? 'First channel' : 'Second channel';
    await holdSourceResponse();
    return ok({ items: [{ id: 'shared-channel', name }], next_cursor: null });
  },
};
export const useIsAuthenticated = () => () => true;
export const useNonPrimaryEmailLinkIdHeader = () => (id: string) => id;
export function useEmailLinksQuery() {
  return useQuery(() => ({
    queryKey: emailKeys.links(link.macro_id).queryKey,
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
  async getLinks() {
    const email =
      activeViewer() === link.macro_id
        ? 'first@example.com'
        : 'second@example.com';
    await holdSourceResponse();
    return ok({ links: [{ ...link, email_address: email }] });
  },
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
    pendingSourceReads: sourceWaiters.length,
    savedSignature: settings.signature,
    patches: structuredClone(patches),
  };
}

declare global {
  interface Window {
    signatureFixture: {
      readState: typeof readState;
      waitForHeldSources: typeof waitForHeldSources;
      holdAccountRefresh: typeof holdAccountRefresh;
      releaseAccountRefresh: typeof releaseAccountRefresh;
    };
  }
}
window.signatureFixture = {
  readState,
  waitForHeldSources,
  holdAccountRefresh,
  releaseAccountRefresh,
};
