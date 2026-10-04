import BuildingOffice from '@phosphor/building-office.svg';
import Clock from '@phosphor/clock.svg';
import Envelope from '@phosphor/envelope.svg';
import File from '@phosphor/file.svg';
import HashStraight from '@phosphor/hash-straight.svg';
import ListChecks from '@phosphor/list-checks.svg';
import { type Component, type ComponentProps, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { homepagePeople } from '../../core/homepage-demo-people';
import '../demo-mentions.css';

export type DocMentionKind =
  | 'person'
  | 'document'
  | 'task'
  | 'channel'
  | 'company'
  | 'email'
  | 'date';

export type DocMentionItem = {
  kind: DocMentionKind;
  label: string;
  /** People menu rows show their email beside the name. */
  detail?: string;
  photo?: string;
  status?: 'Not Started' | 'In Progress' | 'In Review';
};

// EntityIcon targets: md, task, channel, company, and the menu's email glyph.
const icons: Record<
  Exclude<DocMentionKind, 'person'>,
  Component<ComponentProps<'svg'>>
> = {
  document: File,
  task: ListChecks,
  channel: HashStraight,
  company: BuildingOffice,
  email: Envelope,
  date: Clock,
};

export function DocMentionIcon(props: { kind: DocMentionKind }) {
  return (
    <span aria-hidden="true" class={`demo-mention-icon mention-${props.kind}`}>
      <Show when={props.kind !== 'person' && props.kind}>
        {(kind) => (
          <Dynamic
            component={icons[kind() as Exclude<DocMentionKind, 'person'>]}
          />
        )}
      </Show>
    </span>
  );
}

/** UserMention and DocumentMention/MentionContainer, as the editor draws them. */
export function DocMention(props: { item: DocMentionItem }) {
  return (
    <span
      class={`demo-inline-mention mention-${props.item.kind}`}
      data-doc-mention={props.item.kind}
      contentEditable={false}
    >
      <Show
        when={props.item.kind !== 'person'}
        fallback={<span class="demo-mention-name">@{props.item.label}</span>}
      >
        <DocMentionIcon kind={props.item.kind} />
        <span class="demo-mention-name">{props.item.label}</span>
        <Show when={props.item.kind === 'task'}>
          <span
            class="demo-mention-status"
            data-status={props.item.status}
            role="img"
            aria-label={props.item.status ?? 'Not Started'}
          />
        </Show>
      </Show>
    </span>
  );
}

export const people = {
  julia: {
    kind: 'person',
    label: homepagePeople.julia.name,
    detail: 'julia@macro.com',
    photo: homepagePeople.julia.photo,
  },
  teo: {
    kind: 'person',
    label: homepagePeople.teo.name,
    detail: 'teo@macro.com',
    photo: homepagePeople.teo.photo,
  },
  gabriel: {
    kind: 'person',
    label: homepagePeople.gabriel.name,
    detail: 'gabriel@macro.com',
    photo: homepagePeople.gabriel.photo,
  },
} satisfies Record<string, DocMentionItem>;
