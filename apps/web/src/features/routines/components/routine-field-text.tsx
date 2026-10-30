import BracketsIcon from '@icon/system/regular/brackets-curly.svg';
import { cn, Dropdown, inputVariants } from '@ui';
import { createEffect, createSignal, For, on, onMount, Show } from 'solid-js';
import { type StepScope, triggerFields } from '../core/step-catalog';
import { FIELD_PATTERN, fieldLabel, subjectNoun } from '../core/step-headline';
import { menuMount } from './routine-search-menu';

/** Keeps the caret after a field chip at the end of the text. */
const CARET_ANCHOR = '​';

/** A field as an atomic chip inside the editable text. */
function fieldChip(value: string, label: string): HTMLElement {
  const chip = document.createElement('span');
  chip.contentEditable = 'false';
  chip.dataset.field = value;
  chip.className =
    'mx-px inline-block rounded bg-accent-bg px-1 align-baseline font-mono text-xs leading-5 text-accent';
  chip.textContent = label;
  return chip;
}

/** The text with each field written back as its `{{…}}` placeholder. */
function serialize(node: Node): string {
  let text = '';
  node.childNodes.forEach((child, index) => {
    if (child.nodeType === Node.TEXT_NODE) {
      text += child.nodeValue ?? '';
    } else if (child instanceof HTMLElement) {
      if (child.dataset.field) text += child.dataset.field;
      else if (child.tagName === 'BR') text += '\n';
      else {
        // Browsers wrap new lines in blocks when they edit on their own.
        if (index > 0 && /^(DIV|P)$/.test(child.tagName)) text += '\n';
        text += serialize(child);
      }
    }
  });
  return text.replaceAll(CARET_ANCHOR, '');
}

function render(root: HTMLElement, value: string, scope: StepScope) {
  const nodes: Node[] = [];
  let last = 0;
  for (const found of value.matchAll(FIELD_PATTERN)) {
    const at = found.index ?? 0;
    if (at > last) nodes.push(document.createTextNode(value.slice(last, at)));
    nodes.push(fieldChip(found[0], fieldLabel(found[0], scope)));
    last = at + found[0].length;
  }
  if (last < value.length)
    nodes.push(document.createTextNode(value.slice(last)));
  if (nodes.at(-1) instanceof HTMLElement)
    nodes.push(document.createTextNode(CARET_ANCHOR));
  root.replaceChildren(...nodes);
}

/** Put `nodes` where the caret was, else at the end, and the caret after them. */
function insertAt(root: HTMLElement, nodes: Node[], saved: Range | undefined) {
  const range =
    saved && root.contains(saved.startContainer)
      ? saved
      : (() => {
          const end = document.createRange();
          end.selectNodeContents(root);
          end.collapse(false);
          return end;
        })();
  range.deleteContents();
  const fragment = document.createDocumentFragment();
  for (const node of nodes) fragment.append(node);
  const last = nodes.at(-1);
  range.insertNode(fragment);
  if (!last) return;
  const after = document.createRange();
  after.setStartAfter(last);
  after.collapse(true);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(after);
}

/**
 * Text that can embed fields from the triggering item and earlier steps.
 * Fields read as chips ("Pay: [Email subject]"); `{ }` inserts one at the caret.
 */
export function FieldText(props: {
  label: string;
  value: string;
  placeholder?: string;
  multiline?: boolean;
  scope: StepScope;
  onChange(value: string): void;
}) {
  let root: HTMLDivElement | undefined;
  let saved: Range | undefined;
  // What this editor last wrote, so its own changes don't re-render it.
  let written = props.value;
  const [empty, setEmpty] = createSignal(!props.value);
  const emit = () => {
    if (!root) return;
    written = serialize(root);
    setEmpty(!written);
    props.onChange(written);
  };
  const remember = () => {
    const selection = window.getSelection();
    if (root && selection?.rangeCount) {
      const range = selection.getRangeAt(0);
      if (root.contains(range.startContainer)) saved = range.cloneRange();
    }
  };
  onMount(() => {
    if (root) render(root, props.value, props.scope);
  });
  // The value can change from outside, e.g. undo or a template; follow it.
  createEffect(
    on(
      () => props.value,
      (value) => {
        if (!root || value === written) return;
        written = value;
        setEmpty(!value);
        render(root, value, props.scope);
      },
      { defer: true }
    )
  );
  const insertText = (text: string) => {
    if (!root) return;
    insertAt(root, [document.createTextNode(text)], saved);
    remember();
    emit();
  };
  return (
    <div
      class={cn(
        inputVariants({ variant: 'outline', size: 'md' }),
        'flex h-auto min-h-8 items-start gap-1 py-1 pr-1 focus-within:ring-2 focus-within:ring-edge-muted',
        props.multiline ? 'min-h-16 rounded-xl' : 'rounded-2xl'
      )}
    >
      <div class="relative min-w-0 flex-1 py-0.5">
        <Show when={empty() && props.placeholder}>
          <span
            aria-hidden="true"
            class="pointer-events-none absolute inset-x-0 top-0.5 truncate text-sm text-ink-placeholder"
          >
            {props.placeholder}
          </span>
        </Show>
        <div
          ref={root}
          role="textbox"
          tabIndex={0}
          aria-label={props.label}
          aria-multiline={props.multiline ?? false}
          aria-placeholder={props.placeholder}
          contentEditable
          class="min-h-5 whitespace-pre-wrap break-words text-sm leading-5 outline-none"
          onInput={() => {
            remember();
            emit();
          }}
          onKeyUp={remember}
          onMouseUp={remember}
          onBlur={remember}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.isComposing) return;
            event.preventDefault();
            if (props.multiline) {
              remember();
              insertText('\n');
            }
          }}
          onPaste={(event) => {
            event.preventDefault();
            const text = event.clipboardData?.getData('text/plain') ?? '';
            remember();
            insertText(props.multiline ? text : text.replace(/\s*\n\s*/g, ' '));
          }}
          onDrop={(event) => event.preventDefault()}
        />
      </div>
      <FieldMenu
        scope={props.scope}
        onInsert={(field) => {
          if (!root) return;
          insertAt(
            root,
            [
              fieldChip(field, fieldLabel(field, props.scope)),
              document.createTextNode(CARET_ANCHOR),
            ],
            saved
          );
          remember();
          emit();
        }}
      />
    </div>
  );
}

/** `{ }`: insert a field from the triggering item or an earlier step. */
function FieldMenu(props: { scope: StepScope; onInsert(value: string): void }) {
  const fields = () => triggerFields(props.scope.subject);
  let trigger: HTMLButtonElement | undefined;
  return (
    <Show when={fields().length || props.scope.outputs.length}>
      <Dropdown placement="bottom-end">
        <Dropdown.Trigger
          ref={trigger}
          variant="ghost"
          size="icon-sm"
          aria-label="Insert a field"
          title="Insert a field from the triggering item or an earlier step"
          // Keep the caret where it is while the menu opens.
          onMouseDown={(event: MouseEvent) => event.preventDefault()}
        >
          <BracketsIcon class="size-3.5" />
        </Dropdown.Trigger>
        <Dropdown.Content
          portalScope="local"
          mount={menuMount(trigger)}
          class="min-w-56"
        >
          <Show when={fields().length}>
            <Dropdown.Group>
              <Dropdown.GroupLabel>
                From the {subjectNoun(props.scope.subject)}
              </Dropdown.GroupLabel>
              <For each={fields()}>
                {(field) => (
                  <Dropdown.Item onSelect={() => props.onInsert(field.value)}>
                    {field.label}
                  </Dropdown.Item>
                )}
              </For>
            </Dropdown.Group>
          </Show>
          <Dropdown.Group>
            <Dropdown.GroupLabel>From earlier steps</Dropdown.GroupLabel>
            <Show
              when={props.scope.outputs.length}
              fallback={
                <p class="px-2 pb-1.5 text-sm text-ink-muted">Nothing yet</p>
              }
            >
              <For each={props.scope.outputs}>
                {(output) => (
                  <Dropdown.Item onSelect={() => props.onInsert(output.value)}>
                    {output.label}
                  </Dropdown.Item>
                )}
              </For>
            </Show>
          </Dropdown.Group>
        </Dropdown.Content>
      </Dropdown>
    </Show>
  );
}
