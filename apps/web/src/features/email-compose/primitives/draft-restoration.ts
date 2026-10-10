import { createEffect, createSignal, on, onCleanup } from 'solid-js';
import type { EmailMessage } from '../../email-message/core/email-message';
import type {
  EmailDraftRestoration,
  EmailDraftStorage,
} from '../context/compose-capabilities';
import type { LocalDraft } from '../core/local-draft';
import type { DraftFormAttachment } from './email-form-state';

/** Explicit recovery reseeds the matching editor; normal cache echoes never do. */
type RestorationOptions = {
  storage: EmailDraftStorage;
  accepts(change: EmailDraftRestoration): boolean;
  ready?(): boolean;
  version(): string;
  cancelPendingSave(): void;
  setPending(pending: boolean): void;
  restore(
    draft: EmailMessage,
    change: EmailDraftRestoration,
    persistence: 'committed' | 'queued',
    local?: LocalDraft,
    attachments?: DraftFormAttachment[]
  ): void;
  reportError(error: unknown): void;
};

export function observeDraftRestoration(options: RestorationOptions) {
  createEffect(
    on(
      () =>
        [options.storage.readDraft, options.storage.watchRestorations] as const,
      ([read, watch]) => {
        if (read && watch) observeAvailableRestorations(options, read, watch);
      }
    )
  );
}

function observeAvailableRestorations(
  options: RestorationOptions,
  read: NonNullable<EmailDraftStorage['readDraft']>,
  watch: NonNullable<EmailDraftStorage['watchRestorations']>
) {
  let disposed = false;
  type PendingRestoration = {
    change: EmailDraftRestoration;
    version: string;
    reading: boolean;
  };
  const [pending, setPending] = createSignal<PendingRestoration>();
  const current = (request: PendingRestoration) =>
    !disposed && pending() === request;
  const valid = (request: PendingRestoration) =>
    request.version === options.version() && options.accepts(request.change);
  const finish = (request: PendingRestoration) => {
    if (!current(request)) return;
    setPending(undefined);
    options.setPending(false);
  };
  const restore = async (request: PendingRestoration) => {
    if (request.reading) return;
    if (!valid(request)) {
      finish(request);
      return;
    }
    request.reading = true;
    let awaitingUnlock = false;
    try {
      const result = await read(request.change.draftId);
      if (!current(request) || !valid(request)) return;
      if (options.ready?.() === false) {
        awaitingUnlock = true;
        return;
      }
      if (!result?.draft)
        throw new Error('The restored draft is unavailable on this device');
      options.restore(
        result.draft,
        request.change,
        result.persistence,
        result.local,
        result.attachments
      );
    } catch (error) {
      if (current(request) && valid(request)) options.reportError(error);
    } finally {
      request.reading = false;
      if (!awaitingUnlock) finish(request);
    }
  };
  createEffect(
    on(
      () => [pending(), options.ready?.() ?? true] as const,
      ([request, ready]) => {
        if (request && ready) void restore(request);
      }
    )
  );
  const unsubscribe = watch((change) => {
    if (!options.accepts(change)) return;
    // Cross-tab notifications can precede the journal observer's unlock. Pause
    // stale autosaves immediately and retain the event until that observer agrees.
    options.cancelPendingSave();
    options.setPending(true);
    setPending({ change, version: options.version(), reading: false });
  });
  onCleanup(() => {
    disposed = true;
    unsubscribe();
    options.setPending(false);
  });
}
