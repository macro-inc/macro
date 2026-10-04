/**
 * The SmartArt Text Pane: a bulleted list beside the graphic with one line
 * per node. Typing edits the node's text live; Enter adds a node, Tab and
 * Shift+Tab demote and promote, Backspace on an empty bullet deletes it, and
 * the arrow keys move between bullets, as in PowerPoint.
 */

import X from '@phosphor/x.svg';
import {
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import {
  type PaneAction,
  PROMPT,
  paneEdit,
  paneKey,
  paneLines,
} from '../../core/smartart';
import type {
  SmartArtState,
  SmartArtTarget,
} from '../../primitives/create-smart-art';

/** How long typing pauses before the text reaches the graphic. */
const TYPING_DELAY = 150;

export function SmartArtTextPane(props: {
  smartArt: SmartArtState;
  readonly: boolean;
  /** Where the pane sits, in CSS pixels on the stage. */
  position: { left: number; top: number };
  onClose: () => void;
}) {
  const s = () => props.smartArt;
  const lines = createMemo(() => {
    const o = s().outline();
    return o ? paneLines(o) : [];
  });
  /** Node ids in order; rows are keyed by id so inputs keep focus. */
  const ids = createMemo(() => lines().map((l) => l.id));
  const lineOf = (id: string) => lines().find((l) => l.id === id);
  const supported = () => !!s().outline()?.layout.supported;

  /** What each bullet shows while it is typed in (ahead of the graphic). */
  const [drafts, setDrafts] = createSignal<Record<string, string>>({});
  const setDraft = (id: string, text: string | undefined) =>
    setDrafts((d) => {
      const next = { ...d };
      if (text === undefined) delete next[id];
      else next[id] = text;
      return next;
    });
  const inputs = new Map<string, HTMLInputElement>();

  /** Pane edits run one after another, in the order they were made. */
  let chain: Promise<unknown> = Promise.resolve();
  const enqueue = <T,>(task: () => Promise<T>): Promise<T> => {
    const next = chain.then(task, task);
    chain = next.catch(() => undefined);
    return next;
  };

  /** Typing not yet sent, with the graphic it was typed into. */
  const pending = new Map<
    string,
    {
      text: string;
      at: SmartArtTarget | undefined;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  /** Sends a node's text now (`text`, or what is pending) if it changed. */
  const commit = (id: string, text?: string) => {
    const waiting = pending.get(id);
    clearTimeout(waiting?.timer);
    pending.delete(id);
    const value = text ?? waiting?.text;
    if (value === undefined) return Promise.resolve();
    const at = waiting?.at ?? s().target();
    return enqueue(async () => {
      if (lineOf(id)?.text === value) return;
      await s().setText(id, value, at);
    });
  };
  const schedule = (id: string, text: string) => {
    clearTimeout(pending.get(id)?.timer);
    pending.set(id, {
      text,
      at: s().target(),
      timer: setTimeout(() => void commit(id), TYPING_DELAY),
    });
  };
  // Closing the pane (or deselecting the graphic) sends what was typed.
  onCleanup(() => {
    for (const id of [...pending.keys()]) void commit(id);
  });

  const focus = (id: string | undefined, at: 'start' | 'end') => {
    if (!id) return;
    queueMicrotask(() => {
      const el = inputs.get(id);
      if (!el) return;
      el.focus({ preventScroll: true });
      const n = at === 'start' ? 0 : el.value.length;
      el.setSelectionRange(n, n);
    });
  };

  const run = async (action: PaneAction, input: HTMLInputElement) => {
    const edit = paneEdit(action);
    switch (action.kind) {
      case 'split': {
        setDraft(action.node, action.before);
        await commit(action.node, action.before);
        const id = await enqueue(() =>
          s().addNode('after', action.after, action.node)
        );
        focus(id, 'start');
        return;
      }
      case 'delete': {
        clearTimeout(pending.get(action.node)?.timer);
        pending.delete(action.node);
        setDraft(action.node, undefined);
        await enqueue(() =>
          s().edit({ action: 'deleteNode', node: action.node })
        );
        if (action.focus) s().setActiveNode(action.focus);
        focus(action.focus, 'end');
        return;
      }
      case 'focus':
        focus(action.node, action.at);
        return;
      default:
        if (!edit) return;
        await commit(input.dataset.node ?? '', input.value);
        await enqueue(() => s().edit(edit));
        focus(input.dataset.node, 'end');
    }
  };

  // Opening the pane puts the caret in the picked bullet (or the first).
  onMount(() => {
    if (s().pane.takeFocus() && !props.readonly)
      focus(s().activeNode() ?? ids()[0], 'end');
  });

  const onKeyDown = (e: KeyboardEvent, id: string) => {
    if (e.isComposing) return;
    const input = e.currentTarget as HTMLInputElement;
    if (e.key === 'Escape') {
      e.preventDefault();
      props.onClose();
      return;
    }
    const all = lines();
    const index = all.findIndex((l) => l.id === id);
    let action = paneKey(
      all,
      index,
      { key: e.key, shift: e.shiftKey },
      input.value,
      { start: input.selectionStart ?? 0, end: input.selectionEnd ?? 0 }
    );
    // Layouts this editor can't lay out keep their structure.
    if (!supported() && action.kind !== 'focus') action = { kind: 'none' };
    if (e.key === 'Tab' || e.key === 'Enter') e.preventDefault();
    if (action.kind === 'none') return;
    e.preventDefault();
    void run(action, input);
  };

  return (
    <div
      class="absolute z-20 flex w-60 flex-col rounded-lg border border-edge bg-menu text-ink shadow-xl"
      style={{
        left: `${props.position.left}px`,
        top: `${props.position.top}px`,
      }}
      data-testid="pptx-smartart-pane"
      onPointerDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
    >
      <div class="flex items-center justify-between border-edge-muted border-b px-2.5 py-1.5">
        <span class="font-medium text-xs">Type your text here</span>
        <button
          type="button"
          aria-label="Close the Text Pane"
          class="rounded p-0.5 text-ink-muted hover:bg-ink/5"
          data-testid="pptx-smartart-pane-close"
          onClick={() => props.onClose()}
        >
          <X class="size-3.5" />
        </button>
      </div>
      <ul class="flex max-h-72 flex-col gap-0.5 overflow-y-auto p-2">
        <For each={ids()}>
          {(id) => {
            const line = () => lineOf(id);
            onCleanup(() => {
              inputs.delete(id);
            });
            return (
              <li
                class="flex items-center gap-1.5"
                style={{
                  'padding-left': `${((line()?.level ?? 1) - 1) * 16}px`,
                }}
                data-level={line()?.level ?? 1}
              >
                <span aria-hidden="true" class="text-ink-muted text-xs">
                  •
                </span>
                <input
                  ref={(el) => inputs.set(id, el)}
                  type="text"
                  data-node={id}
                  data-testid="pptx-smartart-pane-line"
                  aria-label={`Level ${line()?.level ?? 1} text`}
                  class="min-w-0 flex-1 rounded-sm border border-transparent bg-transparent px-1 py-0.5 text-ink text-xs outline-none placeholder:text-ink-placeholder focus:border-accent"
                  classList={{
                    'bg-accent-bg': s().activeNode() === id,
                  }}
                  placeholder={PROMPT}
                  value={drafts()[id] ?? line()?.text ?? ''}
                  readOnly={props.readonly}
                  spellcheck={false}
                  autocomplete="off"
                  onFocus={() => s().setActiveNode(id)}
                  onInput={(e) => {
                    setDraft(id, e.currentTarget.value);
                    schedule(id, e.currentTarget.value);
                  }}
                  onBlur={(e) => {
                    const el = e.currentTarget;
                    void commit(id, el.value).then(() => {
                      if (document.activeElement !== el)
                        setDraft(id, undefined);
                    });
                  }}
                  onKeyDown={(e) => onKeyDown(e, id)}
                />
              </li>
            );
          }}
        </For>
      </ul>
      <Show when={s().outline()?.layout.name}>
        {(name) => (
          <div class="border-edge-muted border-t px-2.5 py-1.5 text-[11px] text-ink-muted">
            {name()}
            <Show when={!supported()}>
              {' '}
              — this layout's structure can't be changed here
            </Show>
          </div>
        )}
      </Show>
    </div>
  );
}
