import {
  autoUpdate,
  computePosition,
  flip,
  offset,
  shift,
} from '@floating-ui/dom';
import {
  createEffect,
  createSignal,
  createUniqueId,
  For,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { Portal } from 'solid-js/web';
import {
  type DemoMention,
  demoMentions,
  mentionAtCaret,
} from '../core/demo-mentions';
import { createDemoMentionElement, DemoMentionIcon } from './DemoMention';
import './demo-mentions.css';

type Editor = HTMLInputElement | HTMLTextAreaElement | HTMLElement;
type MentionState = {
  editor: Editor;
  text: string;
  start: number;
  end: number;
  query: string;
  range?: Range;
};
const GROUPS = ['People', 'Documents, Agents, & Tasks', 'Channels'] as const;
const groupFor = (item: DemoMention) =>
  item.kind === 'person'
    ? GROUPS[0]
    : item.kind === 'channel'
      ? GROUPS[2]
      : GROUPS[1];

function readEditor(editor: Editor) {
  if (
    editor instanceof HTMLInputElement ||
    editor instanceof HTMLTextAreaElement
  ) {
    return {
      text: editor.value,
      caret: editor.selectionStart ?? editor.value.length,
    };
  }
  const selection = window.getSelection();
  if (!selection?.rangeCount || !editor.contains(selection.anchorNode))
    return undefined;
  if (selection.anchorNode?.parentElement?.closest('[data-demo-mention]'))
    return undefined;
  const range = selection.getRangeAt(0).cloneRange();
  if (!range.collapsed) return undefined;
  const before = range.cloneRange();
  before.selectNodeContents(editor);
  before.setEnd(range.startContainer, range.startOffset);
  return {
    text: editor.textContent ?? '',
    caret: before.toString().length,
    range,
  };
}

function textPoint(editor: HTMLElement, offset: number) {
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const length = node.textContent?.length ?? 0;
    if (offset <= length) return { node, offset };
    offset -= length;
    node = walker.nextNode();
  }
  return { node: editor, offset: editor.childNodes.length };
}

/** A single delegated typeahead covers current and dynamically mounted demos. */
export function DemoMentionMenu() {
  const id = createUniqueId();
  const [state, setState] = createSignal<MentionState>();
  const [selected, setSelected] = createSignal(0);
  const [expanded, setExpanded] = createSignal<string>();
  const [position, setPosition] = createSignal({ x: 0, y: 0 });
  let menu!: HTMLDivElement;
  const [menuElement, setMenuElement] = createSignal<HTMLDivElement>();
  let dismissed: { editor: Editor; text: string; caret: number } | undefined;
  let inserted: { editor: Editor; start: number; text: string } | undefined;
  const matching = () =>
    demoMentions.filter((item) =>
      item.label
        .toLowerCase()
        .includes(state()?.query.trim().toLowerCase() ?? '')
    );
  const grouped = () =>
    GROUPS.map((label) => {
      const all = matching().filter((item) => groupFor(item) === label);
      return {
        label,
        all,
        items: state()?.query || expanded() === label ? all : all.slice(0, 3),
      };
    }).filter(
      (group) => group.all.length && (!expanded() || expanded() === group.label)
    );
  const options = () => grouped().flatMap((group) => group.items);
  const close = () => {
    const current = state();
    if (current)
      dismissed = {
        editor: current.editor,
        text: current.text,
        caret: current.end,
      };
    setState(undefined);
  };
  const update = (target: EventTarget | null) => {
    if (!(target instanceof HTMLElement)) return;
    const editor = target.closest<Editor>(
      'textarea, input, [contenteditable]:not([contenteditable="false"])'
    );
    if (
      !editor?.closest('.workspace-demo, [data-demo-mentions="on"]') ||
      editor.closest('[data-demo-mentions="off"]') ||
      editor.getAttribute('role') === 'combobox' ||
      /search/i.test(editor.getAttribute('aria-label') ?? '') ||
      (editor instanceof HTMLInputElement &&
        !['text', 'email'].includes(editor.type)) ||
      ('readOnly' in editor && (editor.readOnly || editor.disabled))
    ) {
      close();
      return;
    }
    const value = readEditor(editor);
    if (!value) {
      setState(undefined);
      return;
    }
    if (
      dismissed?.editor === editor &&
      dismissed.text === value.text &&
      dismissed.caret === value.caret
    )
      return;
    const match = mentionAtCaret(value.text, value.caret);
    if (!match) {
      setState(undefined);
      return;
    }
    if (value.range) {
      // A completed user token begins with @, but is not a new query. Search
      // only the editable text after it when continuing the sentence.
      for (const token of editor.querySelectorAll('[data-demo-mention]')) {
        const before = document.createRange();
        before.selectNodeContents(editor);
        before.setEndAfter(token);
        const end = before.toString().length;
        if (end <= value.caret && match.start < end) {
          setState(undefined);
          return;
        }
      }
    }
    // A chosen mention is complete: continuing the sentence must not reopen it.
    if (
      inserted?.editor === editor &&
      inserted.start === match.start &&
      value.text.slice(match.start).startsWith(inserted.text) &&
      value.caret >= match.start + inserted.text.length
    ) {
      setState(undefined);
      return;
    }
    if (state()?.editor !== editor || state()?.query !== match.query) {
      setSelected(0);
      setExpanded(undefined);
    }
    setState({ editor, ...value, ...match });
  };
  const choose = (item?: DemoMention) => {
    const current = state();
    if (!current || !item) return;
    const insertion = `@${item.label} `;
    const editor = current.editor;
    inserted = { editor, start: current.start, text: insertion };
    editor.focus();
    if (
      editor instanceof HTMLInputElement ||
      editor instanceof HTMLTextAreaElement
    ) {
      const text =
        editor.value.slice(0, current.start) +
        insertion +
        editor.value.slice(current.end);
      // Use the native setter so controlled demo fields receive the input event.
      const prototype =
        editor instanceof HTMLInputElement
          ? HTMLInputElement.prototype
          : HTMLTextAreaElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(
        editor,
        text
      );
      if (editor.type !== 'email')
        editor.setSelectionRange(
          current.start + insertion.length,
          current.start + insertion.length
        );
    } else {
      const range = document.createRange();
      const start = textPoint(editor, current.start);
      const end = textPoint(editor, current.end);
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset);
      range.deleteContents();
      const token = createDemoMentionElement(item);
      const space = document.createTextNode(' ');
      const fragment = document.createDocumentFragment();
      fragment.append(token, space);
      range.insertNode(fragment);
      range.setStartAfter(space);
      range.collapse(true);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
    const value = readEditor(editor);
    if (value) dismissed = { editor, text: value.text, caret: value.caret };
    setState(undefined);
    editor.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        inputType: 'insertText',
        data: insertion,
      })
    );
  };
  onMount(() => {
    const input = (event: Event) => update(event.target);
    const selection = () => update(document.activeElement);
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menu?.contains(target) && !state()?.editor.contains(target)) close();
    };
    const key = (event: KeyboardEvent) => {
      if (
        !state() ||
        event.isComposing ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      )
        return;
      if (
        ![
          'ArrowDown',
          'ArrowUp',
          'ArrowLeft',
          'ArrowRight',
          'Enter',
          'Tab',
          'Escape',
        ].includes(event.key)
      )
        return;
      if (event.shiftKey && event.key === 'Enter') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.key === 'ArrowLeft') {
        setExpanded(undefined);
        setSelected(0);
      } else if (event.key === 'ArrowRight') {
        const active = options()[selected()];
        if (active) setExpanded(groupFor(active));
        setSelected(0);
      } else if (
        event.key === 'Escape' ||
        (event.key === 'Tab' && event.shiftKey)
      )
        close();
      else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        const count = options().length;
        setSelected(
          count
            ? (selected() + (event.key === 'ArrowDown' ? 1 : count - 1)) % count
            : 0
        );
        menu
          ?.querySelector('[aria-selected="true"]')
          ?.scrollIntoView({ block: 'nearest' });
      } else {
        const active = options()[selected()];
        if (active) choose(active);
        else close();
      }
    };
    document.addEventListener('input', input, true);
    document.addEventListener('focusin', input);
    document.addEventListener('selectionchange', selection);
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', key, true);
    onCleanup(() => {
      document.removeEventListener('input', input, true);
      document.removeEventListener('focusin', input);
      document.removeEventListener('selectionchange', selection);
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', key, true);
    });
  });
  createEffect(() => {
    const current = state();
    if (!current) return;
    const editor = current.editor;
    const previous = [
      'aria-controls',
      'aria-expanded',
      'aria-activedescendant',
    ].map((name) => [name, editor.getAttribute(name)] as const);
    editor.setAttribute('aria-controls', id);
    editor.setAttribute('aria-expanded', 'true');
    const active = options()[selected()];
    if (active)
      editor.setAttribute('aria-activedescendant', `${id}-${active.id}`);
    else editor.removeAttribute('aria-activedescendant');
    onCleanup(() =>
      previous.forEach(([name, value]) =>
        value === null
          ? editor.removeAttribute(name)
          : editor.setAttribute(name, value)
      )
    );
  });
  createEffect(() => {
    const current = state();
    const floating = menuElement();
    if (!current || !floating) return;
    const reference = {
      contextElement: current.editor,
      getBoundingClientRect: () => {
        const rect = current.range?.getBoundingClientRect();
        return rect && (rect.width || rect.height)
          ? rect
          : current.editor.getBoundingClientRect();
      },
    };
    let active = true;
    const reposition = () => {
      void computePosition(reference, floating, {
        strategy: 'fixed',
        placement: 'top-start',
        middleware: [offset(8), flip(), shift({ padding: 12 })],
      }).then(({ x, y }) => {
        if (active) setPosition({ x, y });
      });
    };
    const stop = autoUpdate(current.editor, floating, reposition);
    onCleanup(() => {
      active = false;
      stop();
    });
  });
  return (
    <Show when={state()}>
      <Portal>
        <div class="workspace-demo portal-scope" data-theme="dark">
          <div
            ref={(element) => {
              menu = element;
              setMenuElement(element);
            }}
            class="demo-mention-menu"
            role="listbox"
            aria-label="Mention a demo item"
            id={id}
            style={{ left: `${position().x}px`, top: `${position().y}px` }}
            onPointerDown={(event) => event.preventDefault()}
            onMouseDown={(event) => event.preventDefault()}
          >
            <div class="demo-mention-groups">
              <For each={grouped()}>
                {(group) => (
                  <section>
                    <div class="demo-mention-heading">
                      <span>{group.label}</span>
                      <Show when={expanded()}>
                        <button
                          type="button"
                          onClick={() => {
                            setExpanded(undefined);
                            setSelected(0);
                          }}
                        >
                          ← Back to everything
                        </button>
                      </Show>
                      <Show when={group.all.length > group.items.length}>
                        <button
                          type="button"
                          onClick={() => {
                            setExpanded(group.label);
                            setSelected(0);
                          }}
                        >
                          View all ({group.all.length})
                        </button>
                      </Show>
                    </div>
                    <For each={group.items}>
                      {(item) => (
                        <button
                          type="button"
                          role="option"
                          id={`${id}-${item.id}`}
                          aria-selected={options()[selected()]?.id === item.id}
                          class="demo-mention-option"
                          onMouseMove={() =>
                            setSelected(
                              options().findIndex(
                                (option) => option.id === item.id
                              )
                            )
                          }
                          onClick={() => choose(item)}
                        >
                          <Show
                            when={item.photo}
                            fallback={<DemoMentionIcon item={item} />}
                          >
                            {(photo) => <img src={photo()} alt="" />}
                          </Show>
                          <span>
                            {item.label}
                            <Show when={item.detail}>
                              <span class="demo-mention-detail">
                                {item.detail}
                              </span>
                            </Show>
                          </span>
                        </button>
                      )}
                    </For>
                  </section>
                )}
              </For>
              <Show when={!options().length}>
                <p class="demo-mention-empty">No matching demo items</p>
              </Show>
            </div>
          </div>
        </div>
      </Portal>
    </Show>
  );
}
