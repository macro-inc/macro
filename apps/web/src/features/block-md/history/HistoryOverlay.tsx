import { buildConfig } from '@core/component/LexicalMarkdown/builder/MarkdownConfigBuilder';
import { MarkdownShell } from '@core/component/LexicalMarkdown/builder/MarkdownShell';
import type { DiffStatus } from '@macro-inc/lexical-core';
import type { SerializedEditorState } from 'lexical';
import { createMemo, createSignal, onCleanup, onMount, Show } from 'solid-js';
import { diffAuthorColorPlugin } from './diffAuthorColorPlugin';
import { useHistory } from './HistoryContext';
import { UserHoverTag } from './UserHoverTag';
import { userColor } from './utils';

export function HistoryOverlay(props: {
  currentState: () => SerializedEditorState | undefined;
  selectedAt: Date | null;
  isLive: boolean;
  visible: boolean;
  onExit: () => void;
}) {
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

  const authorTagLabel = (name: string, status: DiffStatus | undefined) => {
    if (status === 'delete') return `Deleted by ${name}`;
    if (status === 'insert') return `Added by ${name}`;
    return `Edited by ${name}`;
  };

  return (
    <div
      ref={rootRef}
      class="absolute inset-0 z-20"
      style={{
        display: props.visible ? undefined : 'none',
        '--diff-author-color': diffAuthorColor(),
      }}
      onPointerMove={onDiffPointerMove}
      onPointerLeave={() => setHoverAuthor(null)}
    >
      <div class="absolute inset-y-0 -inset-x-1 -z-10 bg-surface" />
      <Show keyed when={previewState()}>
        {(state) => {
          const config = buildConfig('markdown')
            .withMentions()
            .withMedia()
            .withLinks()
            .withCode()
            .use(diffAuthorColorPlugin);
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
            label={authorTagLabel(
              history.userById(hover().userId).displayName(),
              hover().status
            )}
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
