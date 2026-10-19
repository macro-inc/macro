import { SplitRouter } from '@app/lib/split-router';
import { useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import { isScopeInActiveBranch } from '@core/hotkey/utils';
import EnvelopeOpenIcon from '@phosphor/envelope-simple-open.svg';
import { createSignal, onCleanup, Suspense } from 'solid-js';
import { type EmailListPane, EmailReaderPaneContext } from '../reader-pane';

function EmailReaderEmpty() {
  return (
    <div class="flex size-full min-h-0 min-w-0 flex-col items-center justify-center gap-1 px-6 text-center">
      <EnvelopeOpenIcon class="mb-2 size-6 text-ink-extra-muted" />
      <p class="text-sm text-ink-muted">No conversation selected</p>
      <p class="text-xs text-ink-extra-muted">
        Pick one from the list, or move with j and k
      </p>
    </div>
  );
}

/** The reading pane: the thread route, in its own hotkey scope. */
export function EmailReader(props: {
  focusList: () => void;
  setListPane: (pane: EmailListPane | undefined) => void;
}) {
  const [attachHotkeys, hotkeyScope] = useHotkeyDOMScope('email-reader');
  const [focusRequest, setFocusRequest] = createSignal<string>();
  props.setListPane({
    focusReader: (threadId) => setFocusRequest(threadId),
    readerHasKeyboard: () => isScopeInActiveBranch(hotkeyScope),
  });
  onCleanup(() => props.setListPane(undefined));
  return (
    <div
      ref={attachHotkeys}
      role="region"
      aria-label="Reading pane"
      class="size-full min-h-0 min-w-0"
    >
      <EmailReaderPaneContext.Provider
        value={{
          hotkeyScope,
          focusList: props.focusList,
          focusRequest,
          requestFocus: setFocusRequest,
          clearFocusRequest: () => setFocusRequest(undefined),
        }}
      >
        {/* A thread that is still loading suspends here, not the Email view,
            so the list beside it stays mounted and keeps the keyboard while
            the pane follows its cursor. */}
        <Suspense>
          <SplitRouter.Outlet fallback={EmailReaderEmpty} />
        </Suspense>
      </EmailReaderPaneContext.Provider>
    </div>
  );
}
