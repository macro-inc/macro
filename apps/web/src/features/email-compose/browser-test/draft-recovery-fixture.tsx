import { toast } from '@core/component/Toast/Toast';
import { ToastRegion } from '@core/component/Toast/ToastRegion';
import FileTextIcon from '@icon/system/regular/file-text.svg';
import { createSignal, Show } from 'solid-js';
import type {
  EmailDraftStorage,
  SaveEmailDraft,
  SendEmailDraft,
} from '../context/compose-capabilities';
import { decodeBase64Utf8 } from '../core/decode-base64';
import type { LocalDraft } from '../core/local-draft';
import { createEmailComposer } from '../primitives/email-composer';
import { createEmailEditor, setEmailEditorText } from '../tests/editor';

/**
 * Real controller and toast UI, with an injected durable-save transport.
 * `durable` adds the outbox and an in-memory working copy, as in production.
 */
function RecoveryEditor(props: { durable: boolean }) {
  const [saved, setSaved] = createSignal<SaveEmailDraft[]>([]);
  const [sent, setSent] = createSignal<SendEmailDraft[]>([]);
  let local: LocalDraft | undefined;
  let changed: Parameters<NonNullable<EmailDraftStorage['watchDrafts']>>[0] =
    () => {};
  const editor = createEmailEditor();
  const state = createEmailComposer({
    drafts: {
      transferDraft: async () => ({
        draftId: 'moved-draft',
        threadId: 'moved-thread',
        attachments: [],
      }),
      readDraft: async () => undefined,
      saveLocalDraft: props.durable
        ? async (input) => {
            const draftId = input.clientHandles?.draftId ?? input.draft.db_id!;
            local = {
              key: draftId,
              draftId,
              threadId: input.clientHandles?.threadId,
              accountId: 'owner',
              generation: 'generation',
              revision: (local?.revision ?? 0) + 1,
              acknowledgedRevision: 0,
              status: 'dirty',
              updatedAt: Date.now(),
              content: input.draft,
              attachments: [],
            };
            return local;
          }
        : undefined,
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
      completeAttachment: async () => {},
      removeAttachment: async () => {},
      removeForwardedAttachment: async () => {},
    },
    delivery: {
      queueActive: () => props.durable,
      sendMessage: async (input) => {
        setSent((previous) => [...previous, input]);
        return { inboxId: 'inbox' };
      },
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
                icon: FileTextIcon,
                color: 'var(--color-accent)',
                actions: options.actions,
              },
              { persistent: true, dismissStyle: 'icon' }
            );
          toast.failure(message, options);
          return undefined;
        },
      },
      blockingNotice: async () => {},
      confirm: async () => false,
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
    editorFiles: { uploadDocuments: async () => [], makePublic: () => {} },
    viewerEmail: () => 'me@example.com',
    hasPaidAccess: () => true,
    recipients: () => [],
    recipientName: (id) => id,
    initialTo: ['colleague@example.com'],
    initialSubject: props.durable ? 'Review' : undefined,
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
      <button
        onClick={() =>
          changed({
            mutationUuid: saved().at(-1)?.clientHandles?.draftId,
            failed: true,
            code: 'DRAFT_ALREADY_SENT',
          })
        }
      >
        Report already sent
      </button>
      <button onClick={() => toast.success('Copied')}>
        Show transient notice
      </button>
      <button onClick={() => state.context.onSend()}>Send</button>
      <output data-testid="save-count">{saved().length}</output>
      <output data-testid="has-draft">
        {String(state.context.hasDraft())}
      </output>
      <output data-testid="saved-draft-ids">
        {JSON.stringify(saved().map((input) => input.clientHandles?.draftId))}
      </output>
      <output data-testid="saved-body">
        {decodeBase64Utf8(saved().at(-1)?.draft.body_html ?? '')}
      </output>
      <output data-testid="send-count">{sent().length}</output>
      <output data-testid="sent-body">
        {sent().at(-1)?.message.body_text ?? ''}
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
        <RecoveryEditor
          durable={new URLSearchParams(location.search).has('durable')}
        />
      </Show>
      <ToastRegion />
    </main>
  );
}
