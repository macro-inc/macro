import Check from '@icon/system/regular/check.svg';
import Email from '@icon/system/regular/envelope.svg';
import File from '@icon/system/regular/file.svg';
import Task from '@icon/system/regular/list-checks.svg';
import Search from '@icon/system/regular/magnifying-glass.svg';
import Phone from '@icon/system/regular/phone-call.svg';
import Sparkle from '@icon/system/regular/sparkle.svg';
import Chat from '@phosphor/chats-circle.svg';
import PullRequest from '@phosphor/git-pull-request.svg';
import Graph from '@phosphor/graph.svg';
import { For, Match, type ParentProps, Show, Switch } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import type { BenefitScene } from '../../core/benefit-pages';
import { FeatureDemoBackdrop } from '../FeatureDemoBackdrop';
import { wallpapers } from '../TutorialWallpaper';
import type { CompanyGraphScene } from './CompanyGraphDemo';

const icons = {
  email: Email,
  doc: File,
  task: Task,
  call: Phone,
  chat: Chat,
  pr: PullRequest,
};
type ItemKind = keyof typeof icons;

const blockPalettes = {
  email: wallpapers.mail,
  doc: wallpapers.docs,
  task: wallpapers.tasks,
  call: wallpapers.calls,
  chat: wallpapers.chat,
  pr: wallpapers.github,
  agent: wallpapers.agents,
};

function blockStyle(kind: keyof typeof blockPalettes) {
  return {
    '--benefit-block-color': blockPalettes[kind].colors[1],
    '--benefit-block-deep': blockPalettes[kind].colors[2],
  };
}

const sceneBlocks: Record<
  Exclude<BenefitScene, 'parallel-search' | CompanyGraphScene>,
  keyof typeof blockPalettes
> = {
  'auto-tags': 'email',
  'task-tags': 'task',
  'shared-tags': 'doc',
  'tag-filter': 'email',
  'channel-access': 'chat',
  membership: 'chat',
  'leave-channel': 'chat',
  'customer-event': 'email',
  'engineering-event': 'task',
  'property-event': 'call',
  search: 'email',
  'agent-search': 'agent',
};

function Tag(props: { label: string; color?: string }) {
  return (
    <span
      class="benefit-tag"
      style={{ '--tag-color': props.color ?? '#83b5ed' }}
    >
      <i />
      {props.label}
    </span>
  );
}

function Callout(props: ParentProps<{ below?: boolean }>) {
  return (
    <div class="benefit-callout" data-below={props.below}>
      <span>{props.children}</span>
      <i />
    </div>
  );
}

function Item(props: {
  kind: ItemKind;
  title: string;
  detail?: string;
  faded?: boolean;
  tag?: string;
}) {
  return (
    <div
      class="benefit-item"
      data-faded={props.faded}
      data-benefit-block={props.kind}
      style={blockStyle(props.kind)}
    >
      <span class="benefit-item-icon">
        <Dynamic component={icons[props.kind]} />
      </span>
      <div>
        <strong>{props.title}</strong>
        <Show when={props.detail}>
          <small>{props.detail}</small>
        </Show>
      </div>
      <Show when={props.tag}>{(tag) => <Tag label={tag()} />}</Show>
    </div>
  );
}

function AutoTagGraphic(props: { task?: boolean }) {
  return (
    <div class="benefit-autotag-scene">
      <div class="benefit-floating-tags">
        <Tag label={props.task ? 'Engineering' : 'Customer'} color="#c0a4ef" />
        <Tag label="High priority" color="#e2ab7a" />
        <Tag label="Urgent" color="#dc8b87" />
      </div>
      <Callout>Tags applied by your agent</Callout>
      <div
        class="benefit-glass benefit-tagged-email"
        data-benefit-block={props.task ? 'task' : 'email'}
        style={blockStyle(props.task ? 'task' : 'email')}
      >
        <div class="benefit-card-label">
          <Dynamic component={props.task ? Task : Email} />
          {props.task ? 'New task' : 'Incoming email'} <small>9:41 AM</small>
        </div>
        <h3>
          {props.task ? 'Fix checkout timeout' : 'Checkout keeps timing out'}
        </h3>
        <p>
          {props.task
            ? 'Investigate the Safari error reported by Northwind.'
            : 'Our customers can’t finish their orders in Safari. Can you take a look today?'}
        </p>
        <div class="benefit-tags">
          <Tag
            label={props.task ? 'Engineering' : 'Customer'}
            color="#c0a4ef"
          />
          <Tag label="High priority" color="#e2ab7a" />
        </div>
      </div>
      <div
        class="benefit-rule"
        data-benefit-block="agent"
        style={blockStyle('agent')}
      >
        <Sparkle />
        <span>
          {props.task
            ? 'When a task is created, categorize it and set priority.'
            : 'When email arrives, tag it by topic and urgency.'}
        </span>
      </div>
    </div>
  );
}

function SharedTagsGraphic() {
  return (
    <div class="benefit-shared-tags-scene">
      <Tag label="Northwind" color="#ad9fe5" />
      <div class="benefit-branch-lines" />
      <div class="benefit-tag-cards">
        <For
          each={[
            {
              kind: 'email' as const,
              title: 'Next steps',
              detail: 'Customer email',
            },
            {
              kind: 'doc' as const,
              title: 'Meeting notes',
              detail: 'Shared document',
            },
            {
              kind: 'task' as const,
              title: 'Send proposal',
              detail: 'Follow-up task',
            },
          ]}
        >
          {(item) => (
            <div
              class="benefit-glass benefit-tag-card"
              data-benefit-block={item.kind}
              style={blockStyle(item.kind)}
            >
              <Dynamic component={icons[item.kind]} />
              <strong>{item.title}</strong>
              <small>{item.detail}</small>
              <Tag label="Northwind" color="#ad9fe5" />
            </div>
          )}
        </For>
      </div>
      <Callout below>One tag, across every kind of work</Callout>
    </div>
  );
}

function SearchGraphic(props: { mode: 'search' | 'tag' | 'agent' }) {
  return (
    <div class="benefit-search-scene">
      <Show when={props.mode === 'agent'}>
        <div
          class="benefit-glass benefit-agent-query"
          data-benefit-block="agent"
          style={blockStyle('agent')}
        >
          <Sparkle />
          <span>What happened with Northwind’s checkout issue?</span>
        </div>
        <div class="benefit-connection" />
      </Show>
      <div class="benefit-glass benefit-search-window">
        <div class="benefit-search-input">
          <Search />
          <span>
            {props.mode === 'tag' ? 'Urgent work' : 'Northwind checkout'}
          </span>
          <kbd>/</kbd>
        </div>
        <Show when={props.mode === 'tag'}>
          <div class="benefit-filter-bar">
            <Tag label="Urgent" color="#dc8b87" />
            <span class="benefit-filter-pill">All types</span>
          </div>
        </Show>
        <div class="benefit-search-results">
          <Item
            kind="email"
            title="Checkout keeps timing out"
            detail="Sam · Northwind · Our customers can’t finish their orders…"
          />
          <Item
            kind="chat"
            title="Engineering"
            detail="Julia · I can reproduce the Safari error."
          />
          <Item
            kind="task"
            title="Fix checkout timeout"
            detail="Priya · In progress · Linked to the customer email"
          />
        </div>
        <div class="benefit-search-footer">
          <kbd>↵</kbd> Open <kbd>L</kbd> Preview
        </div>
      </div>
      <Callout below>
        {props.mode === 'tag'
          ? 'Urgency across the workspace'
          : props.mode === 'agent'
            ? 'The same search for people and agents'
            : 'One query across your work'}
      </Callout>
    </div>
  );
}

function ChannelAccessGraphic() {
  return (
    <div class="benefit-channel-scene">
      <div
        class="benefit-glass benefit-channel-card"
        data-benefit-block="chat"
        style={blockStyle('chat')}
      >
        <div class="benefit-card-label">
          <Chat />
          Product
        </div>
        <div class="benefit-person">
          <span class="benefit-avatar">J</span>
          <strong>Julia</strong>
          <small>10:24 AM</small>
        </div>
        <p>Here’s the plan for Friday.</p>
        <span
          class="benefit-inline-mention"
          data-benefit-block="doc"
          style={blockStyle('doc')}
        >
          <File />
          Launch notes
        </span>
      </div>
      <div class="benefit-connection" />
      <div class="benefit-access-people">
        <span class="benefit-avatar">J</span>
        <span class="benefit-avatar">T</span>
        <span class="benefit-avatar">P</span>
        <span class="benefit-access-check">
          <Check />
        </span>
      </div>
      <Callout below>Channel members have access</Callout>
    </div>
  );
}

function MembershipGraphic(props: { leaving?: boolean }) {
  return (
    <div class="benefit-membership-scene">
      <div class="benefit-member-event">
        <span class="benefit-avatar">P</span>
        <span>
          <strong>Priya</strong> {props.leaving ? 'leaves' : 'joins'} Product
        </span>
      </div>
      <div class="benefit-connection" />
      <div class="benefit-glass benefit-list">
        <div class="benefit-card-label">
          <Graph />
          Shared with Product
        </div>
        <Item
          kind="doc"
          title="Launch notes"
          detail={props.leaving ? 'Channel access removed' : 'Shared last week'}
        />
        <Item
          kind="task"
          title="Improve team invitations"
          detail={props.leaving ? 'Channel access removed' : 'Shared yesterday'}
        />
        <Item
          kind="email"
          title="Customer feedback"
          detail={props.leaving ? 'Channel access removed' : 'Shared today'}
        />
      </div>
      <Callout below>
        {props.leaving
          ? 'Access follows channel membership'
          : 'Past shares, ready for the new teammate'}
      </Callout>
    </div>
  );
}

const eventExamples = {
  'customer-event': {
    kind: 'email',
    event: 'Customer email received',
    context: 'Northwind · Checkout issue',
    action: 'Create a follow-up task and draft a reply.',
  },
  'engineering-event': {
    kind: 'task',
    event: 'Task status changed to Completed',
    context: 'Fix checkout timeout · Engineering',
    action: 'Post an update in the Engineering channel.',
  },
  'property-event': {
    kind: 'call',
    event: 'Client call ended',
    context: 'Property viewing · Transcript and participants',
    action: 'Draft a recap and create viewing follow-ups.',
  },
} satisfies Record<
  string,
  { kind: ItemKind; event: string; context: string; action: string }
>;

function EventGraphic(props: { mode: keyof typeof eventExamples }) {
  const example = () => eventExamples[props.mode];
  return (
    <div class="benefit-event-context-scene">
      <div
        class="benefit-glass benefit-event-card"
        data-benefit-block={example().kind}
        style={blockStyle(example().kind)}
      >
        <Dynamic component={icons[example().kind]} />
        <div>
          <small>WHEN</small>
          <strong>{example().event}</strong>
        </div>
      </div>
      <div class="benefit-connection" />
      <div class="benefit-event-context">
        <span
          class="benefit-inline-mention"
          data-benefit-block={example().kind}
          style={blockStyle(example().kind)}
        >
          {example().context}
        </span>
      </div>
      <div class="benefit-connection" />
      <div
        class="benefit-glass benefit-event-card"
        data-benefit-block="agent"
        style={blockStyle('agent')}
      >
        <Sparkle />
        <div>
          <small>ROUTINE INSTRUCTIONS</small>
          <strong>{example().action}</strong>
        </div>
      </div>
      <Callout below>The event brings its context</Callout>
    </div>
  );
}

/** Editorial illustrations using Paper's annotation and translucent surface language. */
export function BenefitGraphic(props: {
  scene: Exclude<BenefitScene, 'parallel-search' | CompanyGraphScene>;
  label: string;
}) {
  return (
    <div
      class="benefit-graphic"
      role="img"
      aria-label={props.label}
      style={{
        '--feature-glow': blockPalettes[sceneBlocks[props.scene]].colors[1],
      }}
    >
      <FeatureDemoBackdrop />
      <div class="benefit-art" aria-hidden="true">
        <Switch>
          <Match
            when={props.scene === 'auto-tags' || props.scene === 'task-tags'}
          >
            <AutoTagGraphic task={props.scene === 'task-tags'} />
          </Match>
          <Match when={props.scene === 'shared-tags'}>
            <SharedTagsGraphic />
          </Match>
          <Match when={props.scene === 'channel-access'}>
            <ChannelAccessGraphic />
          </Match>
          <Match
            when={
              props.scene === 'membership' || props.scene === 'leave-channel'
            }
          >
            <MembershipGraphic leaving={props.scene === 'leave-channel'} />
          </Match>
          <Match when={props.scene === 'customer-event'}>
            <EventGraphic mode="customer-event" />
          </Match>
          <Match when={props.scene === 'engineering-event'}>
            <EventGraphic mode="engineering-event" />
          </Match>
          <Match when={props.scene === 'property-event'}>
            <EventGraphic mode="property-event" />
          </Match>
          <Match
            when={
              props.scene === 'search' ||
              props.scene === 'tag-filter' ||
              props.scene === 'agent-search'
            }
          >
            <SearchGraphic
              mode={
                props.scene === 'tag-filter'
                  ? 'tag'
                  : props.scene === 'agent-search'
                    ? 'agent'
                    : 'search'
              }
            />
          </Match>
        </Switch>
      </div>
    </div>
  );
}
