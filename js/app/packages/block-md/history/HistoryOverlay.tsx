import { useSplitLayout } from '@app/component/split-layout/layout';
import { useSplitPanel } from '@app/component/split-layout/layoutUtils';
import { buildConfig } from '@core/component/LexicalMarkdown/builder/MarkdownConfigBuilder';
import { MarkdownShell } from '@core/component/LexicalMarkdown/builder/MarkdownShell';
import { toast } from '@core/component/Toast/Toast';
import GitFork from '@phosphor-icons/core/regular/git-fork.svg?component-solid';
import XIcon from '@phosphor-icons/core/regular/x.svg?component-solid';
import { storageServiceClient } from '@service-storage/client';
import { Button } from '@ui';
import type { SerializedEditorState } from 'lexical';
import { createMemo, createSignal, onCleanup, onMount, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import { useHistory } from './HistoryContext';

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
  const splitPanel = useSplitPanel();
  const controlMount = () => splitPanel?.layoutRefs.overlay;
  const history = useHistory();

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

  const targetMs = createMemo<number | undefined>(() => {
    if (props.isScrubbedRightmost) return undefined;
    return props.selectedAt?.getTime();
  });

  const previewState = createMemo(() => {
    if (props.isScrubbedRightmost) return currentEditorState();
    const ms = targetMs();
    if (ms === undefined) return currentEditorState();
    return history.checkoutAt(ms) ?? currentEditorState();
  });

  const versionId = createMemo(() => {
    const ms = targetMs();
    if (ms === undefined) return null;
    return history.versionIdAt(ms);
  });

  const [forking, setForking] = createSignal(false);
  const handleFork = async (keepOpen = false) => {
    const vid = props.isScrubbedRightmost
      ? undefined
      : (versionId() ?? undefined);
    if ((!props.isScrubbedRightmost && !vid) || forking()) return;
    setForking(true);
    const res = await storageServiceClient.copyDocument({
      documentId: props.documentId,
      documentName: nameForkedDocument(props.documentName),
      syncServiceVersion: vid,
    });
    setForking(false);
    if (res.isErr()) {
      toast.failure('Failed to fork document');
      return;
    }
    insertSplit({ type: 'md', id: res.value.documentId }, 'fork');
    if (!keepOpen) props.onExit();
  };

  return (
    <div
      class="absolute inset-0 z-20"
      style={{ display: props.visible ? undefined : 'none' }}
    >
      <div class="absolute inset-y-0 -inset-x-1 -z-10 bg-surface" />
      <Show when={props.visible && controlMount()}>
        <Portal mount={controlMount()!}>
          <div
            class="pointer-events-auto absolute bottom-4 left-4 flex items-center gap-1"
            style={{ 'z-index': 35 }}
          >
            <Button variant="danger" size="md" onClick={props.onExit}>
              <XIcon />
              Exit history
            </Button>
            <Button
              variant="active"
              size="md"
              onClick={(e) => handleFork(e.ctrlKey || e.metaKey)}
              disabled={
                forking() ||
                (!props.isScrubbedRightmost &&
                  (history.isLoadingHistoryDoc() || !versionId()))
              }
            >
              <GitFork class="size-4 shrink-0" />
              {forking() ? 'Forking…' : 'Fork'}
            </Button>
          </div>
        </Portal>
      </Show>
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
              placeholder=""
              disabled
              class="ph-no-capture w-full max-w-full pb-20 [&>*:first-child>*:first-child]:mt-0"
            />
          );
        }}
      </Show>
    </div>
  );
}
