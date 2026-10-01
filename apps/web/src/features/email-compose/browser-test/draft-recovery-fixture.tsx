import { toast } from '@core/component/Toast/Toast';
import { ToastRegion } from '@core/component/Toast/ToastRegion';
import ExclamationIcon from '@phosphor-icons/core/regular/exclamation-mark.svg?component-solid';
import { createSignal, Show } from 'solid-js';
import type {
  EmailDraftStorage,
  SaveEmailDraft,
} from '../context/compose-capabilities';
import { decodeBase64Utf8 } from '../core/decode-base64';
import { createEmailComposer } from '../primitives/email-composer';
import { createEmailEditor, setEmailEditorText } from '../tests/editor';

/** Real controller and toast UI, with an injected durable-save transport. */
function RecoveryEditor() {
  const [saved, setSaved] = createSignal<SaveEmailDraft[]>([]);
  let changed: Parameters<NonNullable<EmailDraftStorage['watchDrafts']>>[0] =
    () => {};
  const editor = createEmailEditor();
  const state = createEmailComposer({
    drafts: {
      readDraft: async () => undefined,
      watchDrafts: (callback) => {
        changed = callback;
        return () => {
          changed = () => {};
        };
      },
      saveDraft: async (input) => {
        setSaved((previous) => [...previous, input]);
        return {
          draftId: input.clientHandles?.draftId,
          threadId: input.clientHandles?.threadId,
          inboxId: 'inbox',
          persistence: 'queued',
        };
      },
      deleteDraft: async () => {},
      restoreDraft: async () => {},
    },
    attachmentStorage: {
      uploadAttachments: async () => {},
      addForwardedAttachments: async () => {},
      removeAttachment: async () => {},
      removeForwardedAttachment: async () => {},
    },
    delivery: {
      sendMessage: async () => ({ inboxId: 'inbox' }),
      unschedule: async () => {},
      schedule: async () => {},
      archive: async () => {},
      undoSend: async () => {},
    },
    draftLifecycle: {
      observe: () => ({
        state: () => undefined,
        refresh: async () => undefined,
      }),
    },
    notices: {
      feedback: {
        ...toast,
        failure: (message, options) => {
          if (options?.persistent)
            return toast.custom(
              {
                title: message,
                content: () => options.subtext,
                icon: ExclamationIcon,
                color: 'var(--color-failure)',
                actions: options.actions,
              },
              { persistent: true }
            );
          toast.failure(message, options);
          return undefined;
        },
      },
      blockingNotice: async () => {},
      reportError: () => {},
    },
    accounts: {
      inboxes: () => [
        { id: 'inbox', email_address: 'me@example.com', settings: {} },
      ],
      loading: () => false,
      failed: () => false,
      primaryId: () => 'inbox',
    },
    connectivity: { looksOffline: () => false },
    viewerEmail: () => 'me@example.com',
    hasPaidAccess: () => true,
    recipients: () => [],
    recipientName: (id) => id,
    initialTo: ['colleague@example.com'],
  });
  state.context.captureEditor(editor);
  state.context.onContentChange('');
  return (
    <section aria-label="Draft recovery">
      <label>
        Message
        <textarea
          aria-label="Message"
          class="block border border-edge-muted p-2"
          onInput={(event) => {
            const text = event.currentTarget.value;
            setEmailEditorText(editor, text);
            state.context.onContentChange(text);
          }}
        />
      </label>
      <button
        onClick={() =>
          changed({
            mutationUuid: saved().at(-1)?.clientHandles?.draftId,
            failed: true,
          })
        }
      >
        Reject background save
      </button>
      <button onClick={() => toast.success('Copied')}>
        Show transient notice
      </button>
      <output data-testid="save-count">{saved().length}</output>
      <output data-testid="saved-draft-ids">
        {JSON.stringify(saved().map((input) => input.clientHandles?.draftId))}
      </output>
      <output data-testid="saved-body">
        {decodeBase64Utf8(saved().at(-1)?.draft.body_html ?? '')}
      </output>
    </section>
  );
}

export function DraftRecoveryFixture() {
  const [open, setOpen] = createSignal(true);
  return (
    <main class="min-h-screen bg-surface p-4 text-ink">
      <button onClick={() => setOpen(false)}>Close composer</button>
      <Show when={open()}>
        <RecoveryEditor />
      </Show>
      <ToastRegion />
    </main>
  );
}
