import {
  type AiEditOrigin,
  applyAiOpsNative,
} from '@block-md/ai-edit/applyAiOpsNative';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { NativeLocationHighlight } from '@core/component/LexicalMarkdown/component/core/NativeLocationHighlight';
import { queryApplication } from '@core/component/LexicalMarkdown/plugins/group-b/command';
import type { PersistentLocation } from '@core/component/LexicalMarkdown/plugins/location/locationPlugin';
import { toast } from '@core/component/Toast/Toast';
import { fireAndForget } from '@core/util/fireAndForget';
import SparkleIcon from '@icon/system/bold/sparkle-bold.svg?component-solid';
import { Access } from '@macro-inc/collaboration/session/abi.generated';
import type { EditorView } from '@macro-inc/lexical-wasm-view';
import { SessionPort } from '@macro-inc/lexical-wasm-view/view/session-port';
import { type Span, Telemetry } from '@macro-inc/observability';
import { Button, SendButton, Toolbar } from '@ui';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  type JSX,
  onCleanup,
  Show,
  untrack,
} from 'solid-js';
import {
  cancelAiEdit,
  hasActiveAiEdit,
  requestAiEditWithToast,
} from '../../queries/ai-edit';
import {
  type BodyPopupPromptControl,
  type BodyPopupSlot,
  promptSlot,
} from './body-popup-slots';
import { readNativeSelectionSnippet } from './native-snippet';

/** What AI edit captured when its prompt opened: the editor it targets and
 *  that editor's generation. The run and the highlight stay bound to it. */
type Captured = AiEditOrigin & {
  /** Source resolveSelectedNodeIds over the selection retained at the tap
   *  (Source's popup keeps its last in-editor selection while the prompt or
   *  drawer holds focus). */
  readonly nodeIds: readonly string[];
  /** The MODEL selection those ids were read from (serialized). */
  readonly selection: string;
};

/** The selection highlight, bound to the origin it was read from. */
type Highlighted = {
  readonly origin: Captured;
  readonly location: PersistentLocation;
};

/** Why a submit was refused before any query or request (native only). */
type AiEditAdmissionRefusal = 'view-changed' | 'no-edit-access' | 'ended';

/** Source MarkdownPopup AI edit (:139-167, :329-394, :679-760, :817-822,
 *  :936-979) over a native view. The input, the run and the highlight live
 *  here, outside the toolbar, with Source's lifetimes: the input survives the
 *  popup hiding and is cleared by submit and dismiss; the highlight outlives
 *  the popup only while an edit runs. */
export function createNativeAiEditSlot(options: {
  documentId: Accessor<string>;
  /** The mounted native view, if any. */
  view: Accessor<EditorView | undefined>;
  /** Source shouldShowEditWithAiButton: the inline-ai-editing flag and canEdit. */
  enabled: Accessor<boolean>;
  /** Source flow.span: the parent of each edit's `doc.edit` span. */
  parentSpan: Span;
}): {
  readonly slot: BodyPopupSlot;
  /** The selection highlight; mount once beside the popup. */
  readonly Highlight: () => JSX.Element;
  /** The touch AI drawer (Source MobileDrawer); mount once beside the popup,
   *  outside its Show, so it outlives the popup. */
  readonly Drawer: () => JSX.Element;
  /** The popup's toolbar went away (Source PopupToolbar onCleanup). */
  popupClosed(): void;
} {
  const [input, setInput] = createSignal('');
  const [running, setRunning] = createSignal(false);
  const [inputFocused, setInputFocused] = createSignal(false);
  const [highlighted, setHighlighted] = createSignal<Highlighted | null>(null);
  // Touch: the drawer and the origin captured when its option was tapped.
  const [drawerOpen, setDrawerOpen] = createSignal(false);
  const [drawerOrigin, setDrawerOrigin] = createSignal<Captured>();
  // The desktop prompt is open (its renderer is mounted).
  const [promptOpen, setPromptOpen] = createSignal(false);
  // The current target: set at the tap, re-targeted while the prompt or the
  // drawer is open (Source popupPlugin updates its retained selection and
  // aiEditLocation on every in-editor selection change).
  const [target, setTarget] = createSignal<Captured>();
  const [commits, setCommits] = createSignal(undefined, { equals: false });

  /** The origin is still the mounted editor at its captured generation. */
  const bound = (origin: Captured) =>
    options.view() === origin.view &&
    origin.view.isMounted &&
    origin.view.mirror.keyGeneration === origin.generation;

  // The highlight never paints on another document: a rebind or disposal of
  // its origin clears it (checked on the origin's commits and view changes).
  // Subscribed by view only (see the re-target listener below): a new
  // highlight on the same view keeps its listener.
  const highlightedView = createMemo(() => highlighted()?.origin.view);
  createEffect(() => {
    const view = highlightedView();
    if (!view) return;
    onCleanup(view.onCommit(() => setCommits()));
  });
  createEffect(() => {
    commits();
    const current = highlighted();
    if (current && !bound(current.origin)) setHighlighted(null);
  });

  // Source: Escape anywhere cancels this document's running edit.
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') cancelAiEdit(options.documentId());
  };
  window.addEventListener('keydown', onKeyDown);
  onCleanup(() => window.removeEventListener('keydown', onKeyDown));

  const refuse = (cause: AiEditAdmissionRefusal) => {
    try {
      Telemetry.error(new Error('Native AI edit submit refused'), {
        surface: 'markdown-ai-edit',
        'editor.engine': 'native',
        'ai_edit.admission_refusal': cause,
      });
    } catch {
      // The refusal stands; a failed report must not replace it.
    }
  };

  /** Source resolveSelectedNodeIds, read from the native selection. */
  const selectedIds = (view: EditorView): string[] => {
    const reply = queryApplication(view, 'group-c.selected-block-ids', {});
    if (reply === null) return [];
    if (
      !Array.isArray(reply) ||
      !reply.every((id): id is string => typeof id === 'string')
    )
      throw new Error('Invalid selected block ids query');
    return reply;
  };

  const submit = (captured: Captured, close: () => void) => {
    if (running()) return;
    const instruction = input().trim();
    if (!instruction) return;
    // The overlay lifetime and the flag (enabled) gate every submission: a
    // drawer can outlive an ended overlay while its view stays mounted.
    if (!options.enabled()) {
      refuse('ended');
      return;
    }
    // Admission before the selection query and the service request: the
    // captured editor is still the mounted one at the captured generation,
    // with Edit authority.
    const view = captured.view;
    if (!bound(captured)) {
      refuse('view-changed');
      return;
    }
    if (
      !(view.port instanceof SessionPort) ||
      view.port.effectiveAccess() !== Access.Edit
    ) {
      refuse('no-edit-access');
      return;
    }
    const current = target();
    const nodeIds =
      current &&
      current.view === captured.view &&
      current.generation === captured.generation
        ? current.nodeIds
        : captured.nodeIds;
    if (nodeIds.length === 0) {
      toast.failure('Could not resolve the selected nodes');
      return;
    }
    setRunning(true);
    const documentId = options.documentId();
    fireAndForget(
      options.parentSpan.span('doc.edit', (parentSpan) =>
        requestAiEditWithToast(
          {
            documentId,
            parentSpan,
            prompt: `Request: ${instruction}\nUser is selecting nodes ${nodeIds.join(' ')}. Proceed with requested edit`,
            mode: 'fast',
            // Every chunk is admitted against the captured origin.
            onOps: (ops) => applyAiOpsNative(captured, ops, parentSpan),
          },
          () => {
            setHighlighted(null);
            setRunning(false);
          }
        )
      ),
      'markdown-ai-edit'
    );
    setInput('');
    close();
  };

  /** The editor and generation to bind the edit to, with the highlight
   *  location read from the native selection now. */
  const captureOrigin = (): Captured | undefined => {
    const view = options.view();
    const generation = view?.mirror.keyGeneration;
    if (
      !options.enabled() ||
      !view ||
      generation === null ||
      generation === undefined
    ) {
      setHighlighted(null);
      return undefined;
    }
    const origin = {
      view,
      generation,
      nodeIds: selectedIds(view),
      selection: JSON.stringify(view.selection().selection),
    };
    const location = readNativeSelectionSnippet(view)?.location;
    setHighlighted(location ? { origin, location } : null);
    setTarget(origin);
    return origin;
  };

  const resize = (
    event: InputEvent & { currentTarget: HTMLTextAreaElement }
  ) => {
    setInput(event.currentTarget.value);
    event.currentTarget.style.height = 'auto';
    event.currentTarget.style.height = `${event.currentTarget.scrollHeight}px`;
  };

  /** Source AiEditSubmitButton: send, or stop while this document edits. */
  const SubmitOrStop = (props: { onSubmit: () => void }) => (
    <Show
      when={hasActiveAiEdit(options.documentId())}
      fallback={
        <SendButton disabled={!input().trim()} onClick={props.onSubmit} />
      }
    >
      <Button
        size="icon-sm"
        variant="ghost"
        tooltip="Stop AI edit"
        onClick={() => cancelAiEdit(options.documentId())}
      >
        <div class="size-2.5 rounded-xs bg-current" />
      </Button>
    </Show>
  );

  /** Source drawer close: the highlight stays only while an edit runs. */
  const closeDrawer = () => {
    setDrawerOpen(false);
    if (!running()) setHighlighted(null);
  };
  const submitDrawer = () => {
    const captured = drawerOrigin();
    if (!captured) {
      refuse('view-changed');
      return;
    }
    submit(captured, () => setDrawerOpen(false));
  };

  const slot = promptSlot<Captured | undefined>({
    id: 'ai',
    available: options.enabled,
    button: (control) => (
      <Toolbar.Button size="sm" onClick={() => control.open()}>
        AI edit
      </Toolbar.Button>
    ),
    // Source dismissPrompt clears the AI input on any prompt's Escape.
    dismissed: () => setInput(''),
    capture: captureOrigin,
    // Touch "Edit with AI" (Source handleOpenAiEditDrawer): the origin is
    // captured on the tap, before the popup hides and before the drawer's
    // textarea takes focus and the DOM selection collapses.
    select: (hide) => {
      if (!options.enabled()) {
        hide();
        return;
      }
      setDrawerOrigin(captureOrigin());
      setDrawerOpen(true);
      hide();
    },
    prompt: (control) => {
      setPromptOpen(true);
      onCleanup(() => setPromptOpen(false));
      return promptBody(control);
    },
  });

  /** Re-target while open: a new NON-collapsed MODEL range (read from the
   *  native commit, never DOM selectionchange) at the same view and
   *  generation replaces the ids and the highlight; a collapsed or lost
   *  selection keeps the last target; a rebind or detach stops it. */
  // The subscription follows only the target's view, so a re-target (a new
  // target on the same view) never tears the listener down mid-dispatch:
  // onCommit iterates its live Set, which would visit a re-added listener
  // again for the same commit.
  const targetView = createMemo(() => target()?.view);
  createEffect(() => {
    const view = targetView();
    if (!view || !(promptOpen() || drawerOpen())) return;
    let released = false;
    let resolving = false;
    // Runs in the selectionChanged commit itself, so the committed range is
    // the one read before any later collapse can replace it. The queries it
    // makes can commit again; those re-entrant commits are ignored.
    const retarget = () => {
      const current = untrack(target);
      if (
        !current ||
        current.view !== view ||
        resolving ||
        released ||
        !options.enabled() ||
        !bound(current)
      )
        return;
      const selection = current.view.selection().selection;
      const serialized = JSON.stringify(selection);
      if (
        serialized === current.selection ||
        selection.kind !== 'range' ||
        (selection.anchor.key === selection.focus.key &&
          selection.anchor.offset === selection.focus.offset &&
          selection.anchor.type === selection.focus.type)
      )
        return;
      resolving = true;
      try {
        const retargeted = {
          ...current,
          nodeIds: selectedIds(current.view),
          selection: serialized,
        };
        const location = readNativeSelectionSnippet(current.view)?.location;
        setHighlighted(location ? { origin: retargeted, location } : null);
        setTarget(retargeted);
      } finally {
        resolving = false;
      }
    };
    const stop = view.onCommit((commit) => {
      if (commit.selectionChanged) retarget();
    });
    onCleanup(() => {
      released = true;
      stop();
    });
  });

  function promptBody(control: BodyPopupPromptControl<Captured | undefined>) {
    return (
      <>
        <textarea
          class="grow resize-none overflow-hidden bg-transparent pl-2 text-sm placeholder:text-ink-placeholder focus:outline-none"
          rows={1}
          placeholder="Describe changes"
          ref={(element) => {
            const frame = requestAnimationFrame(() => element.focus());
            onCleanup(() => cancelAnimationFrame(frame));
          }}
          onFocus={() => setInputFocused(true)}
          onBlur={() => setInputFocused(false)}
          onInput={resize}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              const captured = control.value;
              if (captured) submit(captured, control.close);
              else refuse('view-changed');
            } else if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              control.dismiss();
            }
          }}
        />
        <SubmitOrStop
          onSubmit={() => {
            const captured = control.value;
            if (captured) submit(captured, control.close);
            else refuse('view-changed');
          }}
        />
      </>
    );
  }

  const Highlight = () => (
    <Show when={(inputFocused() || running() || drawerOpen()) && highlighted()}>
      {(current) => (
        <Show when={current().origin.view} keyed>
          {(view) => (
            <>
              <style>{`
                .ai-edit-highlight {
                  background-color: color-mix(in oklab, var(--color-ink) 5%, transparent);
                  border-radius: 3px;
                }
                @keyframes ai-edit-swipe {
                  0% { background-position: 150% 0; }
                  100% { background-position: -50% 0; }
                }
                .ai-edit-highlight-running {
                  background-image: linear-gradient(
                    100deg,
                    transparent 40%,
                    color-mix(in oklab, var(--color-ink) 9%, transparent) 50%,
                    transparent 60%
                  );
                  background-size: 250% 100%;
                  background-repeat: no-repeat;
                  animation: ai-edit-swipe 1.6s ease-in-out infinite;
                }
              `}</style>
              <NativeLocationHighlight
                view={view}
                location={current().location}
                padding={[0, 2]}
                class={
                  running()
                    ? 'ai-edit-highlight ai-edit-highlight-running'
                    : 'ai-edit-highlight'
                }
              />
            </>
          )}
        </Show>
      )}
    </Show>
  );

  const Drawer = () => (
    <MobileDrawer
      side="bottom"
      open={drawerOpen()}
      onOpenChange={(open: boolean) => {
        // Close, Escape and Android Back all land here.
        if (!open) closeDrawer();
      }}
      closeOnOutsidePointerStrategy="pointerdown"
      preventScroll={false}
      preventScrollbarShift={false}
    >
      <MobileDrawer.Portal>
        <MobileDrawer.Overlay />
        <MobileDrawer.Content aria-label="Edit with AI">
          <MobileDrawer.Handle class="pb-1" />
          <div class="flex items-center gap-2 px-4 pb-3">
            <SparkleIcon class="size-4 shrink-0 text-ink-extra-muted" />
            <textarea
              class="grow resize-none bg-transparent py-1.5 text-sm placeholder:text-ink-placeholder focus:outline-none"
              rows={1}
              placeholder="Describe changes"
              value={input()}
              ref={(element) => {
                const frame = requestAnimationFrame(() => element.focus());
                onCleanup(() => cancelAnimationFrame(frame));
              }}
              onInput={resize}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  submitDrawer();
                }
              }}
            />
            <SubmitOrStop onSubmit={submitDrawer} />
          </div>
        </MobileDrawer.Content>
      </MobileDrawer.Portal>
    </MobileDrawer>
  );

  return {
    slot,
    Highlight,
    Drawer,
    popupClosed: () => {
      if (!running() && !drawerOpen()) setHighlighted(null);
    },
  };
}
