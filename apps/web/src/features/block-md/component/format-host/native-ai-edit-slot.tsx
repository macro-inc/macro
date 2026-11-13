import {
  type AiEditOrigin,
  applyAiOpsNative,
} from '@block-md/ai-edit/applyAiOpsNative';
import { NativeLocationHighlight } from '@core/component/LexicalMarkdown/component/core/NativeLocationHighlight';
import { queryApplication } from '@core/component/LexicalMarkdown/plugins/group-b/command';
import type { PersistentLocation } from '@core/component/LexicalMarkdown/plugins/location/locationPlugin';
import { toast } from '@core/component/Toast/Toast';
import { fireAndForget } from '@core/util/fireAndForget';
import { Access } from '@macro-inc/collaboration/session/abi.generated';
import type { EditorView } from '@macro-inc/lexical-wasm-view';
import { SessionPort } from '@macro-inc/lexical-wasm-view/view/session-port';
import { type Span, Telemetry } from '@macro-inc/observability';
import { Button, SendButton, Toolbar } from '@ui';
import {
  type Accessor,
  createEffect,
  createSignal,
  type JSX,
  onCleanup,
  Show,
} from 'solid-js';
import {
  cancelAiEdit,
  hasActiveAiEdit,
  requestAiEditWithToast,
} from '../../queries/ai-edit';
import { type BodyPopupSlot, promptSlot } from './body-popup-slots';
import { readNativeSelectionSnippet } from './native-snippet';

/** What AI edit captured when its prompt opened: the editor it targets and
 *  that editor's generation. The run and the highlight stay bound to it. */
type Captured = AiEditOrigin;

/** The selection highlight, bound to the origin it was read from. */
type Highlighted = {
  readonly origin: Captured;
  readonly location: PersistentLocation;
};

/** Why a submit was refused before any query or request (native only). */
type AiEditAdmissionRefusal = 'view-changed' | 'no-edit-access';

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
  /** The popup's toolbar went away (Source PopupToolbar onCleanup). */
  popupClosed(): void;
} {
  const [input, setInput] = createSignal('');
  const [running, setRunning] = createSignal(false);
  const [inputFocused, setInputFocused] = createSignal(false);
  const [highlighted, setHighlighted] = createSignal<Highlighted | null>(null);
  const [commits, setCommits] = createSignal(undefined, { equals: false });

  /** The origin is still the mounted editor at its captured generation. */
  const bound = (origin: Captured) =>
    options.view() === origin.view &&
    origin.view.isMounted &&
    origin.view.mirror.keyGeneration === origin.generation;

  // The highlight never paints on another document: a rebind or disposal of
  // its origin clears it (checked on the origin's commits and view changes).
  createEffect(() => {
    const current = highlighted();
    if (!current) return;
    onCleanup(current.origin.view.onCommit(() => setCommits()));
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
    const nodeIds = selectedIds(view);
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
    capture: () => {
      const view = options.view();
      const generation = view?.mirror.keyGeneration;
      if (!view || generation === null || generation === undefined) {
        setHighlighted(null);
        return undefined;
      }
      const origin = { view, generation };
      const location = readNativeSelectionSnippet(view)?.location;
      setHighlighted(location ? { origin, location } : null);
      return origin;
    },
    prompt: (control) => (
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
          onInput={(event) => {
            setInput(event.currentTarget.value);
            event.currentTarget.style.height = 'auto';
            event.currentTarget.style.height = `${event.currentTarget.scrollHeight}px`;
          }}
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
        <Show
          when={hasActiveAiEdit(options.documentId())}
          fallback={
            <SendButton
              disabled={!input().trim()}
              onClick={() => {
                const captured = control.value;
                if (captured) submit(captured, control.close);
                else refuse('view-changed');
              }}
            />
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
      </>
    ),
  });

  const Highlight = () => (
    <Show when={(inputFocused() || running()) && highlighted()}>
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

  return {
    slot,
    Highlight,
    popupClosed: () => {
      if (!running()) setHighlighted(null);
    },
  };
}
