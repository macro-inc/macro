/**
 * App adapter: the channel composer's `/poll` and `/form` actions (RFC 03 §3).
 * Both create a form and put it into the message as a card; posting the
 * message shares it with the channel at View, so members can respond. A poll
 * is posted at once; a form's card joins the draft once it has a question.
 */
import { globalSplitManager } from '@app/signal/splitLayout';
import { trashDatabase } from '@block-database/queries/trash-database';
import { toast } from '@core/component/Toast/Toast';
import { $createDocumentCardNode } from '@macro-inc/lexical-core';
import ChartBar from '@phosphor/chart-bar.svg';
import { createForm, onFormFirstQuestion } from '@queries/storage/forms';
import { getEntityGraphqlClient } from '@service-storage/graphql-soup';
import { Dialog, type ManagedDialogProps, openDialog } from '@ui';
import { $insertNodes, type LexicalEditor } from 'lexical';
import { createSignal } from 'solid-js';
import {
  PollComposer,
  type PollComposerDraft,
} from './components/poll/poll-composer';
import { trashForm } from './queries/form-entity';
import { type MadePoll, publishPoll } from './queries/publish-poll';

/** Trash a poll that was not posted: its form, then its database. */
function discardPoll(made: MadePoll) {
  const client = getEntityGraphqlClient();
  return trashForm(client, made.formId).andThen(() =>
    trashDatabase(client, made.databaseId)
  );
}

/**
 * Put a form into the message as a card, where the caret is. Committed at
 * once, so the composer's draft and references hold it when this returns.
 */
function insertFormCard(editor: LexicalEditor, formId: string, name: string) {
  editor.update(
    () => {
      $insertNodes([
        $createDocumentCardNode({
          documentId: formId,
          documentName: name,
          blockName: 'form',
        }),
      ]);
    },
    { discrete: true }
  );
}

/** Put a poll's card into the message and send it (RFC 03 §3, step 5). */
export function postFormCard(
  editor: LexicalEditor,
  formId: string,
  name: string,
  sendMessage: () => void
) {
  insertFormCard(editor, formId, name);
  sendMessage();
}

function PollComposerDialog(
  props: ManagedDialogProps & {
    onCreated: (formId: string, name: string) => void;
  }
) {
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal<string>();
  // Closed while posting: the poll is not sent, and goes to the trash.
  let dismissed = false;
  const close = () => {
    dismissed = true;
    props.onOpenChange(false);
  };
  async function post(draft: PollComposerDraft) {
    setPending(true);
    setError(undefined);
    const created = await publishPoll(draft, discardPoll);
    setPending(false);
    if (created.isErr()) {
      setError(created.error.message);
      return;
    }
    if (dismissed) {
      void discardPoll(created.value);
      return;
    }
    props.onCreated(created.value.formId, created.value.name);
    props.onOpenChange(false);
  }
  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      class="w-110"
      visibleScrim
    >
      <div class="flex flex-col gap-3 p-4">
        <h2 class="flex items-center gap-2 text-sm font-semibold text-ink">
          <ChartBar class="size-4 text-violet" aria-hidden="true" />
          New poll
        </h2>
        <PollComposer
          pending={pending()}
          error={error()}
          onPost={(draft) => void post(draft)}
          onCancel={close}
        />
      </div>
    </Dialog>
  );
}

/** `/poll`: the poll composer; the poll posts as soon as it is made. */
export function openPollComposer(
  editor: LexicalEditor,
  sendMessage: () => void
) {
  openDialog(PollComposerDialog, {
    onCreated: (formId, name) =>
      postFormCard(editor, formId, name, sendMessage),
  });
}

/**
 * `/form` (RFC 03 §3): create the form and open its builder beside the
 * conversation; its card joins the message once the builder saved a
 * question, so an abandoned form leaves no card behind.
 */
export async function startFormInMessage(editor: LexicalEditor) {
  const created = await createForm(
    { name: 'Untitled form', source: { kind: 'new' } },
    'composer'
  );
  if (created.isErr()) {
    toast.failure('Could not create the form');
    return;
  }
  const { id } = created.value.form;
  const stop = onFormFirstQuestion(id, (name) =>
    insertFormCard(editor, id, name)
  );
  // A composer that goes away (sent elsewhere, closed) stops waiting.
  const unregister = editor.registerRootListener((root) => {
    if (root) return;
    stop();
    unregister();
  });
  toast.success('Add a question and the form joins your message.');
  globalSplitManager()?.openWithSplit(
    { type: 'form', id },
    { preferNewSplit: true, activate: true, referredFrom: null }
  );
}
