import { EntityIcon } from '@core/component/EntityIcon';
import { TaskStatusIcon } from '@core/component/TaskStatusIcon';
import { PROPERTY_OPTION_IDS } from '@property/identifiers';
import { For, type JSX } from 'solid-js';
import type { AgentFaceLook } from '../core/agent-face';
import { SettingsSurface } from '../primitives';
import { AgentFaceBadge } from './agent-avatar';

/**
 * Three small scenes drawn from the app's own documents, CRM records, and
 * tasks, showing where a new agent turns up: a mention in a doc, the owner of
 * a deal, and the assignee of a task.
 */
export function AgentMentionShowcase(props: {
  name: string;
  tag: string;
  look: AgentFaceLook;
}) {
  const agent = () => (
    <span class="inline-flex min-w-0 items-center gap-1.5 text-ink">
      <AgentFaceBadge look={props.look} class="size-6" />
      <span class="truncate">{props.name}</span>
    </span>
  );
  const mention = () => (
    <span class="whitespace-nowrap rounded-md bg-accent/8 p-0.5 text-accent">
      @{props.tag}
    </span>
  );

  return (
    <div class="grid grid-cols-1 gap-3 @min-[420px]:grid-cols-2">
      <Scene caption="Mention it in a doc" class="@min-[420px]:col-span-2">
        <Heading icon={<EntityIcon targetType="md" size="fill" />}>
          Launch plan
        </Heading>
        <p class="mt-2 text-sm leading-6 text-ink">
          Pricing still reads like a draft. {mention()} can you tighten it up
          before Friday?
        </p>
        <div class="mt-2 flex items-center gap-1.5 text-xs text-ink-muted">
          {agent()}
          <span>is editing</span>
          <Typing />
        </div>
      </Scene>
      <Scene caption="Make it a record’s owner">
        <Heading icon={<EntityIcon targetType="crm_company" size="fill" />}>
          Northwind
        </Heading>
        <Fields>
          <Field label="Stage">Negotiation</Field>
          <Field label="Owner">{agent()}</Field>
        </Fields>
      </Scene>
      <Scene caption="Assign it a task">
        <Heading
          icon={
            <TaskStatusIcon
              size="fill"
              statusId={PROPERTY_OPTION_IDS.STATUS.IN_PROGRESS}
            />
          }
        >
          Fix the pricing table
        </Heading>
        <Fields>
          <Field label="Assignee">{agent()}</Field>
          <Field label="Due">Friday</Field>
        </Fields>
      </Scene>
    </div>
  );
}

function Scene(props: {
  caption: string;
  class?: string;
  children: JSX.Element;
}) {
  return (
    <figure class={props.class}>
      <div aria-hidden="true">
        <SettingsSurface class="p-3.5">{props.children}</SettingsSurface>
      </div>
      <figcaption class="mt-2 text-center text-xs text-ink-muted">
        {props.caption}
      </figcaption>
    </figure>
  );
}

function Heading(props: { icon: JSX.Element; children: JSX.Element }) {
  return (
    <div class="flex min-w-0 items-center gap-2 text-sm font-medium text-ink">
      <span class="size-4 shrink-0">{props.icon}</span>
      <span class="truncate">{props.children}</span>
    </div>
  );
}

function Fields(props: { children: JSX.Element }) {
  return (
    <dl class="mt-3 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-2 text-xs">
      {props.children}
    </dl>
  );
}

function Field(props: { label: string; children: JSX.Element }) {
  return (
    <>
      <dt class="text-ink-muted">{props.label}</dt>
      <dd class="min-w-0 text-ink">{props.children}</dd>
    </>
  );
}

/** Three dots that pulse in turn, and hold still under reduced motion. */
function Typing() {
  return (
    <span class="inline-flex gap-0.5" aria-hidden="true">
      <For each={[0, 160, 320]}>
        {(delay) => (
          <span
            class="size-1 rounded-full bg-ink-muted motion-safe:animate-pulse"
            style={{ 'animation-delay': `${delay}ms` }}
          />
        )}
      </For>
    </span>
  );
}
