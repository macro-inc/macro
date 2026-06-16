import { useSplitLayout } from '@app/component/split-layout/layout';
import { SplitToolbarLeft } from '@app/component/split-layout/components/SplitToolbar';
import { buildConfig } from '@core/component/LexicalMarkdown/builder/MarkdownConfigBuilder';
import { MarkdownShell } from '@core/component/LexicalMarkdown/builder/MarkdownShell';
import { toast } from '@core/component/Toast/Toast';
import { storageServiceClient } from '@service-storage/client';
import {
  type HistorySession,
  syncServiceClient,
} from '@service-sync/client';
import { useHistoryStateQuery } from '@queries/history';
import { useCreatePinMutation, useDeletePinMutation, usePinsQuery } from '@queries/pins';
import { Button } from '@ui';
import GitFork from '@phosphor-icons/core/regular/git-fork.svg?component-solid';
import {
  createMemo,
  createResource,
  createSignal,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { HistoryScrubber } from './HistoryScrubber';

async function fetchHistory(
  documentId: string
): Promise<{ sessions: HistorySession[] } | undefined> {
  const maybe = await syncServiceClient.getHistoryMeta({ documentId });
  if (maybe.isErr()) {
    console.error("Couldn't get history meta for history overlay", maybe.error);
    return undefined;
  }
  return { sessions: maybe.value.sessions };
}

export function HistoryOverlay(props: {
  documentId: string;
  documentName: string;
  visible: boolean;
  onExit: () => void;
}) {
  const [history] = createResource(() => props.documentId, fetchHistory);
  const { insertSplit } = useSplitLayout();

  const pins = usePinsQuery(() => props.documentId);
  const createPin = useCreatePinMutation(() => props.documentId);
  const deletePin = useDeletePinMutation(() => props.documentId);

  const onKeyDown = (e: KeyboardEvent) => {
    if (!props.visible || e.key !== 'Escape' || e.defaultPrevented) return;
    e.preventDefault();
    props.onExit();
  };
  onMount(() => {
    document.addEventListener('keydown', onKeyDown);
    onCleanup(() => document.removeEventListener('keydown', onKeyDown));
  });

  const [selected, setSelected] = createSignal<Date | null>(null);

  // The moment we resolve state at: the selected cursor, or the latest session end.
  const targetAtMs = createMemo<number | undefined>(() => {
    const scrubbed = selected();
    if (scrubbed) return scrubbed.getTime();

    const sessions = history()?.sessions;
    if (!sessions || sessions.length === 0) return undefined;

    return sessions.reduce((m, s) => Math.max(m, s.endMs), sessions[0].endMs);
  });

  const committed = useHistoryStateQuery(() => props.documentId, targetAtMs);

  const [forking, setForking] = createSignal(false);
  const handleFork = async (keepOpen = false) => {
    const current = committed.data;
    if (!current || forking()) return;
    setForking(true);
    const res = await storageServiceClient.copyDocument({
      documentId: props.documentId,
      documentName: `${props.documentName} (forked)`,
      syncServiceVersion: current.versionId ?? undefined,
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
    <div class="absolute inset-0 z-20" style={{ display: props.visible ? undefined : 'none' }}>
      <div class="absolute inset-y-0 -inset-x-1 -z-10 bg-surface" />
      {/* Fork button portalled into the toolbar left, on top of the hamburger. */}
      <Show when={props.visible}>
        <SplitToolbarLeft>
          <Button
            variant="active"
            size="sm"
            class="order-first"
            onClick={(e) => handleFork(e.ctrlKey || e.metaKey)}
            disabled={forking() || !committed.data}
          >
            <GitFork />
            {forking() ? 'Forking…' : 'Fork'}
          </Button>
        </SplitToolbarLeft>
      </Show>
      {/* placeholderData keeps the last rendered state visible while the next loads. */}
      <Show keyed when={committed.data?.state}>
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
              disabled
              noMenus
              class="ph-no-capture w-full max-w-full pb-20 [&>*:first-child>*:first-child]:mt-0"
            />
          );
        }}
      </Show>
      {/* Controls pinned to the viewport so they're reachable on long docs. */}
      <Show when={history()}>
        {(h) => (
          <div class="fixed inset-x-0 bottom-0 z-30 flex items-center gap-3 border-edge border-t bg-active px-3 pt-4 pb-3 ">
            <div class="flex-1 min-w-0">
              <HistoryScrubber
                  sessions={h().sessions}
                  pins={pins.data ?? []}
                  onSelect={setSelected}
                  onCreatePin={(atMs, label) => createPin.mutate({ atMs, label })}
                  onDeletePin={(pinId) => deletePin.mutate(pinId)}
                />
            </div>
          </div>
        )}
      </Show>
    </div>
  );
}
