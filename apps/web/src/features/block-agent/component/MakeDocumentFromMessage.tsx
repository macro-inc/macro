/**
 * Creates a markdown document from one finished agent reply and opens it
 * beside the session. The reply is already written, so this does not ask
 * the agent to do it.
 */

import { useSplitLayout } from '@components/app/split-layout/layout';
import { toast } from '@core/component/Toast/Toast';
import { fireAndForget } from '@core/util/fireAndForget';
import FilePlus from '@icon/system/regular/file-plus.svg';
import Spinner from '@icon/system/regular/spinner-gap.svg';
import { Telemetry } from '@macro-inc/observability';
import { Button } from '@ui';
import { createSignal, onCleanup, Show } from 'solid-js';
import { createDocumentFromReply } from '../queries/create-message-document';

export function MakeDocumentFromMessage(props: {
  title: string;
  markdown: string;
}) {
  const { openWithSplit } = useSplitLayout();
  const [saving, setSaving] = createSignal(false);
  const [openedDocument, setOpenedDocument] = createSignal<string>();
  let alive = true;
  onCleanup(() => {
    alive = false;
  });

  const make = async () => {
    if (saving()) return;
    setSaving(true);
    try {
      const documentId = await createDocumentFromReply({
        title: props.title,
        markdown: props.markdown,
      });
      if (!alive) return;
      if (!documentId) {
        toast.failure("Couldn't make a doc");
        return;
      }
      openWithSplit(
        { type: 'md', id: documentId },
        { preferNewSplit: true, activate: true }
      );
      setOpenedDocument(documentId);
    } catch (error) {
      if (!alive) return;
      toast.failure("Couldn't make a doc");
      Telemetry.error(error, { surface: 'agent-message-document' });
    } finally {
      if (alive) setSaving(false);
    }
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      class="self-start"
      data-opened-document={openedDocument()}
      disabled={saving()}
      onClick={() => {
        fireAndForget(make(), 'agent-message-document');
      }}
    >
      <Show when={saving()} fallback={<FilePlus class="size-4 shrink-0" />}>
        <Spinner class="size-4 shrink-0 animate-spin" />
      </Show>
      {saving() ? 'Making a doc' : 'Make a doc'}
    </Button>
  );
}
