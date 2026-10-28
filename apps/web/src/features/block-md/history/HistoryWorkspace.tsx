import { getSaveState } from '@core/component/LexicalMarkdown/utils';
import { ParamsProvider } from '@core/component/ParamsProvider';
import {
  enableHistoryComponent,
  isFeatureEnabled,
} from '@core/constant/featureFlags';
import { isMobile } from '@core/mobile/isMobile';
import { Scroll } from '@ui';
import { type ParentProps, Show } from 'solid-js';
import { useMarkdownName } from '../component/MarkdownNameProvider';
import { useMarkdownDocument } from '../context/markdown-document-context';
import { useHistory } from './HistoryContext';
import { HistoryOverlay } from './HistoryOverlay';
import { HistoryScrubber } from './HistoryScrubber';
import { HistorySessionList } from './HistorySessionList';
import { HistoryToolbar } from './HistoryToolbar';

/** A block-local takeover that keeps the live editor mounted beneath it. */
export function HistoryWorkspace(props: ParentProps) {
  const history = useHistory();
  const { state, element } = useMarkdownDocument();
  const { displayName } = useMarkdownName();
  const visible = () =>
    history.isOpen() && !isMobile() && isFeatureEnabled(enableHistoryComponent);
  const currentState = () => {
    const editor = state.editor.md.editor;
    return editor ? getSaveState(editor.getEditorState()) : undefined;
  };
  const close = () => {
    history.exit();
    element()?.focus({ preventScroll: true });
  };

  return (
    <>
      <div class="contents" inert={visible()}>
        {props.children}
      </div>
      <Show when={visible()}>
        <section
          aria-label="Document history"
          tabIndex={-1}
          class="absolute inset-0 z-modal flex min-h-0 min-w-0 flex-col bg-panel text-ink motion-safe:animate-[dialog-overlay-open_100ms_ease-out]"
          onKeyDown={(event) => {
            if (event.key !== 'Escape' || event.defaultPrevented) return;
            event.preventDefault();
            event.stopPropagation();
            close();
          }}
        >
          <HistoryToolbar onClose={close} />
          <div class="flex min-h-0 min-w-0 flex-1">
            <section
              aria-label="Version preview"
              class="min-h-0 min-w-0 flex-1"
            >
              <Scroll>
                <div class="mx-auto w-full max-w-3xl px-6 py-8">
                  <h1 class="mb-6 break-words text-xl font-semibold">
                    {displayName()}
                  </h1>
                  <ParamsProvider state={state.params}>
                    <HistoryOverlay
                      currentState={currentState}
                      selectedAt={history.selectedAt()}
                      isLive={history.isLive()}
                    />
                  </ParamsProvider>
                </div>
              </Scroll>
            </section>
            <aside
              aria-label="History timeline and sessions"
              class="flex min-h-0 w-80 max-w-[45%] shrink-0 flex-col border-l border-edge-muted"
            >
              <Show
                when={!history.loading.sessions()}
                fallback={
                  <div role="status" class="p-4 text-xs text-ink-muted">
                    <div
                      aria-hidden="true"
                      class="mb-3 h-20 rounded-md bg-skeleton skeleton-shimmer"
                    />
                    Loading history…
                  </div>
                }
              >
                <Show
                  when={!history.error()}
                  fallback={
                    <p role="alert" class="p-4 text-sm text-ink-muted">
                      Couldn't load history. Close and reopen history to try
                      again.
                    </p>
                  }
                >
                  <Show
                    when={history.sessions().length > 0}
                    fallback={
                      <p class="p-4 text-sm text-ink-muted">No history yet</p>
                    }
                  >
                    <div class="shrink-0 border-b border-edge-muted p-4 pb-6">
                      <h3 class="mb-4 text-xs text-ink-muted">Timeline</h3>
                      <HistoryScrubber compact />
                    </div>
                    <div class="min-h-0 flex-1">
                      <Scroll>
                        <div class="p-3">
                          <h3 class="px-2 text-xs text-ink-muted">Sessions</h3>
                          <HistorySessionList
                            sessions={history.sessions()}
                            selectedAt={history.selectedAt}
                            onSelect={history.enter}
                            onViewSessionDiff={(session) => {
                              if (
                                history.diff.session()?.startMs ===
                                session.startMs
                              )
                                history.diff.clear();
                              else history.diff.view(session);
                            }}
                          />
                        </div>
                      </Scroll>
                    </div>
                  </Show>
                </Show>
              </Show>
            </aside>
          </div>
        </section>
      </Show>
    </>
  );
}
