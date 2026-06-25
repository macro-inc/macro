import { SplitToolbarLeft } from '@app/component/split-layout/components/SplitToolbar';
import { useSplitLayout } from '@app/component/split-layout/layout';
import { buildConfig } from '@core/component/LexicalMarkdown/builder/MarkdownConfigBuilder';
import { MarkdownShell } from '@core/component/LexicalMarkdown/builder/MarkdownShell';
import { toast } from '@core/component/Toast/Toast';
import GitFork from '@phosphor-icons/core/regular/git-fork.svg?component-solid';
import XIcon from '@phosphor-icons/core/regular/x.svg?component-solid';
import { useHistoryStateQuery } from '@queries/history';
import { storageServiceClient } from '@service-storage/client';
import { Button } from '@ui';
import type { SerializedEditorState } from 'lexical';
import { createMemo, createSignal, onCleanup, onMount, Show } from 'solid-js';

const nameForkedDocument = (name: string) => `${name} (forked)`;

export function HistoryOverlay(props: {
  documentId: string;
  documentName: string;
  currentState: () => SerializedEditorState | undefined;
  selectedAt: Date | null;
  isScrubbedRightmost: boolean;
  visible: boolean;
  onExit: () => void;
}) {
  const { insertSplit } = useSplitLayout();

  const onKeyDown = (e: KeyboardEvent) => {
    if (!props.visible || e.key !== 'Escape' || e.defaultPrevented) return;
    e.preventDefault();
    props.onExit();
  };
  onMount(() => {
    document.addEventListener('keydown', onKeyDown);
    onCleanup(() => document.removeEventListener('keydown', onKeyDown));
  });

  const currentEditorState = createMemo(() => {
    if (!props.visible) return undefined;
    return props.currentState();
  });

  // The current document is the latest state; only fetch historical state once
  // the user explicitly selects a timestamp from the scrubber.
  const targetAtMs = createMemo<number | undefined>(() => {
    if (props.isScrubbedRightmost) return undefined;
    const scrubbed = props.selectedAt;
    if (scrubbed) return scrubbed.getTime();
    return undefined;
  });

  const stateAtCursor = useHistoryStateQuery(
    () => props.documentId,
    targetAtMs
  );

  const previewState = createMemo(() => {
    if (props.isScrubbedRightmost) return currentEditorState();
    if (props.selectedAt)
      return stateAtCursor.data?.state ?? currentEditorState();
    return currentEditorState();
  });

  const [forking, setForking] = createSignal(false);
  const handleFork = async (keepOpen = false) => {
    const versionId = props.isScrubbedRightmost
      ? undefined
      : (stateAtCursor.data?.versionId ?? undefined);
    if ((!props.isScrubbedRightmost && !versionId) || forking()) return;
    setForking(true);
    const res = await storageServiceClient.copyDocument({
      documentId: props.documentId,
      documentName: nameForkedDocument(props.documentName),
      syncServiceVersion: versionId,
    });
    setForking(false);
    if (res.isErr()) {
      toast.failure('Failed to fork document');
      return;
    }
    insertSplit({ type: 'md', id: res.value.documentId }, 'fork');
    if (!keepOpen) props.onExit(); // hold ctrl/meta to keep history open
  };

  return (
    <div
      class="absolute inset-0 z-20"
      style={{ display: props.visible ? undefined : 'none' }}
    >
      <div class="absolute inset-y-0 -inset-x-1 -z-10 bg-surface" />
      <Show when={props.visible}>
        <SplitToolbarLeft>
          <Button
            variant="danger"
            size="md"
            class="order-first"
            onClick={props.onExit}
          >
            <XIcon />
            Exit history
          </Button>
          <Button
            variant="active"
            size="md"
            onClick={(e) => handleFork(e.ctrlKey || e.metaKey)}
            disabled={
              forking() || (!props.isScrubbedRightmost && !stateAtCursor.data)
            }
          >
            <GitFork class="size-4 shrink-0" />
            {forking() ? 'Forking…' : 'Fork'}
          </Button>
        </SplitToolbarLeft>
      </Show>
      {/* placeholderData keeps the last rendered state visible while the next loads. */}
      <Show keyed when={previewState()}>
        {(state) => {
          const config = buildConfig('markdown')
            .withMentions()
            .withMedia()
            .withLinks()
            .withCode();
          return (
            <MarkdownShell
              config={config}
              initialState={state}
              placeholder="No history found"
              disabled
              class="ph-no-capture w-full max-w-full pb-20 [&>*:first-child>*:first-child]:mt-0"
            />
          );
        }}
      </Show>
    </div>
  );
}
