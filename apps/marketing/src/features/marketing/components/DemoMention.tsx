import File from '@phosphor/file.svg?raw';
import Hash from '@phosphor/hash.svg?raw';
import ListChecks from '@phosphor/list-checks.svg?raw';
import Sparkle from '@phosphor/sparkle.svg?raw';
import Table from '@phosphor/table.svg?raw';
import { For, Show } from 'solid-js';
import {
  demoMentions,
  type DemoMention as MentionData,
} from '../core/demo-mentions';
import './demo-mentions.css';

const icons = {
  document: File,
  task: ListChecks,
  agent: Sparkle,
  channel: Hash,
  spreadsheet: Table,
  person: '',
};
const label = (item: MentionData) =>
  item.kind === 'person' ? `@${item.shortName ?? item.label}` : item.label;

// Frozen presentation of UserMention and DocumentMention/MentionContainer.
export function DemoMentionIcon(props: { item: MentionData }) {
  return (
    <span
      aria-hidden="true"
      class={`demo-mention-icon mention-${props.item.kind}`}
      innerHTML={icons[props.item.kind]}
    />
  );
}

export function DemoMention(props: { item: MentionData }) {
  return (
    <span
      class={`demo-inline-mention mention-${props.item.kind}`}
      data-demo-mention={props.item.id}
      contentEditable={false}
      title={props.item.label}
    >
      <Show when={props.item.kind !== 'person'}>
        <DemoMentionIcon item={props.item} />
      </Show>
      <span class="demo-mention-name">{label(props.item)}</span>
      <Show when={props.item.kind === 'task'}>
        <span
          class="demo-mention-status"
          data-status={props.item.status}
          aria-label={props.item.status ?? 'Not Started'}
        />
      </Show>
    </span>
  );
}

/** Insert an atomic token, never arbitrary HTML supplied by an editor. */
export function createDemoMentionElement(item: MentionData) {
  const token = document.createElement('span');
  token.className = `demo-inline-mention mention-${item.kind}`;
  token.dataset.demoMention = item.id;
  token.setAttribute('contenteditable', 'false');
  token.title = item.label;
  if (item.kind !== 'person') {
    const icon = document.createElement('span');
    icon.className = `demo-mention-icon mention-${item.kind}`;
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = icons[item.kind];
    token.append(icon);
  }
  const name = document.createElement('span');
  name.className = 'demo-mention-name';
  name.textContent = label(item);
  token.append(name);
  if (item.kind === 'task') {
    const status = document.createElement('span');
    status.className = 'demo-mention-status';
    status.setAttribute('aria-label', item.status ?? 'Not Started');
    status.dataset.status = item.status;
    token.append(status);
  }
  return token;
}

export function serializeDemoEditor(editor: HTMLElement): string {
  const visit = (node: Node): string => {
    if (node instanceof HTMLElement) {
      const item = demoMentions.find(
        (item) => item.id === node.dataset.demoMention
      );
      if (item) return `@[${item.label}](demo-mention:${item.id})`;
      if (node.tagName === 'BR') return '\n';
      const text = Array.from(node.childNodes, visit).join('');
      return ['DIV', 'P'].includes(node.tagName) && node !== editor
        ? `${text}\n`
        : text;
    }
    return node.textContent ?? '';
  };
  return visit(editor).replaceAll('\u00a0', ' ');
}

export function DemoMentionText(props: { text: string }) {
  const parts = () =>
    props.text.split(/(@\[[^\]]*\]\(demo-mention:[\w-]+\))/g).map((text) => {
      const id = /^@\[[^\]]*\]\(demo-mention:([\w-]+)\)$/.exec(text)?.[1];
      return { text, item: demoMentions.find((item) => item.id === id) };
    });
  return (
    <For each={parts()}>
      {(part) => (
        <Show when={part.item} fallback={part.text}>
          {(item) => <DemoMention item={item()} />}
        </Show>
      )}
    </For>
  );
}
