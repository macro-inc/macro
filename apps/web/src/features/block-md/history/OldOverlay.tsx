import { useSplitLayout } from '@components/app/split-layout/layout';
import { useBlockId } from '@core/block';
import { toast } from '@core/component/Toast/Toast';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
import GitFork from '@phosphor-icons/core/regular/git-fork.svg?component-solid';
import XIcon from '@phosphor-icons/core/regular/x.svg?component-solid';
import { storageServiceClient } from '@service-storage/client';
import { Button, Hotkey } from '@ui';
import { createSignal, Show } from 'solid-js';
import { useHistory } from './HistoryContext';

const nameForkedDocument = (name: string) => `${name} (forked)`;

export function OldOverlay() {
  const history = useHistory();
  const blockId = useBlockId();
  const documentName = useBlockDocumentName();
  const { insertSplit } = useSplitLayout();
  const [forking, setForking] = createSignal(false);

  const handleFork = async () => {
    if (forking()) return;
    const ms = history.selectedAt()?.getTime();
    const vid = history.isLive()
      ? undefined
      : ms
        ? (history.versionIdAt(ms) ?? undefined)
        : undefined;
    if (!history.isLive() && !vid) return;
    setForking(true);
    const res = await storageServiceClient.copyDocument({
      documentId: blockId,
      documentName: nameForkedDocument(documentName() ?? ''),
      syncServiceVersion: vid,
    });
    setForking(false);
    if (res.isErr()) {
      toast.failure('Failed to fork document');
      return;
    }
    insertSplit({ type: 'md', id: res.value.documentId }, 'fork');
    history.exit();
  };

  return (
    <Show when={history.isOpen()}>
      <div class="flex w-full items-center gap-2 bg-alert-bg px-3 py-2 text-xs text-alert-ink">
        <span class="flex items-center gap-1 flex-1">
          You are viewing history. Press{' '}
          <Hotkey shortcut="escape" theme="current" /> to exit.
        </span>
        <Button variant="outline" size="sm" onClick={history.exit}>
          <XIcon />
          Exit
        </Button>
        <Button
          variant="accent"
          size="sm"
          onClick={handleFork}
          disabled={
            forking() ||
            (!history.isLive() &&
              (history.loading.doc() ||
                !history.versionIdAt(history.selectedAt()?.getTime() ?? 0)))
          }
        >
          <GitFork class="size-3.5 shrink-0" />
          {forking() ? 'Forking…' : 'Fork'}
        </Button>
      </div>
    </Show>
  );
}
