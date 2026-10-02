import { useSplitLayout } from '@components/app/split-layout/layout';
import { toast } from '@core/component/Toast/Toast';
import { formatDate } from '@core/util/date';
import GitFork from '@phosphor-icons/core/regular/git-fork.svg?component-solid';
import XIcon from '@phosphor-icons/core/regular/x.svg?component-solid';
import { Button } from '@ui';
import { useMarkdownName } from '../component/MarkdownNameProvider';
import { useMarkdownDocument } from '../context/markdown-document-context';
import { createForkMarkdownDocumentMutation } from '../queries/markdown-document-operations';
import { useHistory } from './HistoryContext';

const nameForkedDocument = (name: string) => `${name} (forked)`;

export function HistoryToolbar(props: { onClose: () => void }) {
  const history = useHistory();
  const { documentId } = useMarkdownDocument();
  const { displayName } = useMarkdownName();
  const { insertSplit } = useSplitLayout();
  const forkDocument = createForkMarkdownDocumentMutation();

  const handleFork = async () => {
    if (forkDocument.isPending) return;
    const ms = history.selectedAt()?.getTime();
    const vid = history.isLive()
      ? undefined
      : ms
        ? (history.versionIdAt(ms) ?? undefined)
        : undefined;
    if (!history.isLive() && !vid) return;
    try {
      const copied = await forkDocument.mutateAsync({
        documentId: documentId(),
        documentName: nameForkedDocument(displayName() ?? ''),
        syncServiceVersion: vid,
      });
      insertSplit({ type: 'md', id: copied.documentId }, 'fork');
      history.exit();
    } catch {
      toast.failure('Failed to fork document');
    }
  };

  return (
    <div class="flex shrink-0 items-center gap-2 border-b border-edge-muted px-4 py-3 text-ink">
      <Button
        data-history-close
        variant="ghost"
        size="icon-sm"
        onClick={props.onClose}
        aria-label="Close history"
      >
        <XIcon />
      </Button>
      <div class="min-w-0 flex-1">
        <h2 class="text-sm font-medium">Document history</h2>
        <div class="truncate text-xs text-ink-muted">
          {history.isLive()
            ? 'Current version'
            : formatDate(history.selectedAt()!, { showTime: true })}
        </div>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => history.enter()}
        disabled={history.isLive()}
      >
        Current version
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={handleFork}
        disabled={
          forkDocument.isPending ||
          (!history.isLive() &&
            (history.loading.doc() ||
              !history.versionIdAt(history.selectedAt()?.getTime() ?? 0)))
        }
      >
        <GitFork class="size-3.5 shrink-0" />
        {forkDocument.isPending ? 'Forking…' : 'Fork'}
      </Button>
    </div>
  );
}
