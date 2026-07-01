import { useSplitLayout } from '@app/component/split-layout/layout';
import { useSplitPanel } from '@app/component/split-layout/layoutUtils';
import { buildConfig } from '@core/component/LexicalMarkdown/builder/MarkdownConfigBuilder';
import { MarkdownShell } from '@core/component/LexicalMarkdown/builder/MarkdownShell';
import { toast } from '@core/component/Toast/Toast';
import type { DiffStatus } from '@lexical-core';
import GitFork from '@phosphor-icons/core/regular/git-fork.svg?component-solid';
import XIcon from '@phosphor-icons/core/regular/x.svg?component-solid';
import { storageServiceClient } from '@service-storage/client';
import { Button } from '@ui';
import type { SerializedEditorState } from 'lexical';
import { createMemo, createSignal, onCleanup, onMount, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import { useHistory } from './HistoryContext';
import { UserHoverTag } from './UserHoverTag';
import { userColor, userLabel } from './utils';

const nameForkedDocument = (name: string) => `${name} (forked)`;

export function HistoryOverlay(props: {
  documentId: string;
  documentName: string;
  currentState: () => SerializedEditorState | undefined;
  selectedAt: Date | null;
  isLive: boolean;
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
    if (props.isLive) return undefined;
    return props.selectedAt?.getTime();
  });

  const previewState = createMemo(() => {
    if (history.diff.session()) return history.diff.previewState() ?? undefined;
    if (props.isLive) return currentEditorState();
    const ms = targetMs();
    if (ms === undefined) return currentEditorState();
    return history.checkoutAt(ms) ?? currentEditorState();
  });

  // Tint inline diff markers with the session author's color
  const diffAuthorColor = createMemo(() => {
    const session = history.diff.session();
    return session ? userColor(session.userId) : undefined;
  });

  const versionId = createMemo(() => {
    const ms = targetMs();
    if (ms === undefined) return null;
    return history.versionIdAt(ms);
  });

  // Hovering a changed run shows who changed it, reusing the scrubber's tag. The
  // author (a user id) lives on the DiffTextNode's DOM as data-diff-author, so one
  // delegated handler covers every run — no per-node component bridging Lexical.
  let rootRef!: HTMLDivElement;
  const [hoverAuthor, setHoverAuthor] = createSignal<{
    userId: string;
    status: DiffStatus | undefined;
    x: number;
    y: number;
  } | null>(null);
  const onDiffPointerMove = (e: PointerEvent) => {
    const el = (e.target as HTMLElement | null)?.closest?.<HTMLElement>(
      '[data-diff-author]'
    );
    if (!el) {
      setHoverAuthor(null);
      return;
    }
    const rect = rootRef.getBoundingClientRect();
    const rawStatus = el.dataset.diffStatus;
    setHoverAuthor({
      userId: el.dataset.diffAuthor ?? 'unknown',
      status:
        rawStatus === 'insert' || rawStatus === 'delete'
          ? rawStatus
          : undefined,
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
  };

  const authorTagLabel = (userId: string, status: DiffStatus | undefined) => {
    const who = userLabel(userId);
    if (status === 'delete') return `Deleted by ${who}`;
    if (status === 'insert') return `Added by ${who}`;
    return `Edited by ${who}`;
  };

  const [forking, setForking] = createSignal(false);
  const handleFork = async (keepOpen = false) => {
    const vid = props.isLive ? undefined : (versionId() ?? undefined);
    if ((!props.isLive && !vid) || forking()) return;
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
      ref={rootRef}
      class="absolute inset-0 z-20"
      style={{
        display: props.visible ? undefined : 'none',
        '--diff-author': diffAuthorColor(),
      }}
      onPointerMove={onDiffPointerMove}
      onPointerLeave={() => setHoverAuthor(null)}
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
                (!props.isLive && (history.loading.doc() || !versionId()))
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
      <Show when={hoverAuthor()}>
        {(hover) => (
          <UserHoverTag
            label={authorTagLabel(hover().userId, hover().status)}
            color={userColor(hover().userId)}
            left={Math.max(
              0,
              Math.min((rootRef?.clientWidth ?? 0) - 180, hover().x + 12)
            )}
            top={Math.max(0, hover().y - 32)}
          />
        )}
      </Show>
    </div>
  );
}
