import ArrowLeft from '@phosphor/arrow-left.svg';
import ArrowRight from '@phosphor/arrow-right.svg';
import Calendar from '@phosphor/calendar-blank.svg';
import CaretRight from '@phosphor/caret-right.svg';
import Chat from '@phosphor/chat-circle.svg';
import Check from '@phosphor/check.svg';
import Clock from '@phosphor/clock.svg';
import Envelope from '@phosphor/envelope.svg';
import File from '@phosphor/file-text.svg';
import Globe from '@phosphor/globe.svg';
import Tasks from '@phosphor/list-checks.svg';
import MagnifyingGlass from '@phosphor/magnifying-glass.svg';
import Plus from '@phosphor/plus.svg';
import Robot from '@phosphor/robot.svg';
import Sparkle from '@phosphor/sparkle.svg';
import { useSearchParams } from '@solidjs/router';
import { createSignal, For, type JSX, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import {
  DEFAULT_MACRO_AGENT,
  type ManagementKind,
  PREVIEW_RESOURCES,
  PREVIEW_TEMPLATES,
  PREVIEW_TOOLS,
  type PreviewResource,
} from './management-preview-data';

const CONTROL =
  'inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg px-3 text-[13px] transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50';
const PRIMARY = `${CONTROL} bg-ink text-panel font-medium hover:bg-ink/90`;
const INPUT =
  'w-full rounded-xl border border-edge-muted bg-ink/2 px-3 py-2.5 text-sm text-ink outline-none placeholder:text-ink-extra-muted focus:border-ink/25 focus:ring-2 focus:ring-ink/5';
const PANEL = 'overflow-hidden rounded-2xl border border-edge-muted bg-ink/2';

function ToolGlyph(props: { id: string; class?: string }) {
  const icons: Record<string, typeof File> = {
    drive: File,
    email: Envelope,
    chat: Chat,
    calendar: Calendar,
    tasks: Tasks,
    web: Globe,
  };
  return (
    <Dynamic
      component={icons[props.id] ?? Sparkle}
      class={props.class ?? 'size-4'}
    />
  );
}

function ToolIcons(props: { ids: string[] }) {
  return (
    <span class="flex shrink-0 items-center -space-x-1">
      <For each={props.ids}>
        {(id) => (
          <span
            title={PREVIEW_TOOLS.find((tool) => tool.id === id)?.name ?? id}
            class="flex size-7 items-center justify-center rounded-full border border-edge-muted bg-panel text-ink-muted"
          >
            <ToolGlyph id={id} class="size-3.5" />
          </span>
        )}
      </For>
    </span>
  );
}

function Status(props: { enabled: boolean }) {
  return (
    <span
      class="inline-flex items-center gap-1.5 whitespace-nowrap text-xs"
      classList={{
        'text-success': props.enabled,
        'text-ink-extra-muted': !props.enabled,
      }}
    >
      <span class="size-1.5 rounded-full bg-current" />
      {props.enabled ? 'Enabled' : 'Paused'}
    </span>
  );
}

function Section(props: {
  title: string;
  description?: string;
  children: JSX.Element;
  action?: JSX.Element;
}) {
  return (
    <section>
      <div class="mb-3 flex items-center justify-between gap-3">
        <div>
          <h3 class="text-sm font-medium text-ink">{props.title}</h3>
          <Show when={props.description}>
            <p class="mt-1 text-xs leading-5 text-ink-extra-muted">
              {props.description}
            </p>
          </Show>
        </div>
        {props.action}
      </div>
      {props.children}
    </section>
  );
}

/** Interactive design preview. All edits are local to this mounted workspace. */
export function ManagementPreview(props: { kind: ManagementKind }) {
  const [params, setParams] = useSearchParams();
  const [records, setRecords] = createSignal(
    PREVIEW_RESOURCES[props.kind].map((item) => ({ ...item }))
  );
  const [scope, setScope] = createSignal<'Mine' | 'Team'>('Mine');
  const [search, setSearch] = createSignal('');
  const [newDraft, setNewDraft] = createSignal<PreviewResource>();
  const [saved, setSaved] = createSignal(false);
  const noun = () => (props.kind === 'routines' ? 'routine' : 'agent');
  const title = () => (props.kind === 'routines' ? 'Routines' : 'Agents');
  const selected = () =>
    params.agentItem === 'new'
      ? (newDraft() ?? emptyDraft)
      : records().find((item) => item.id === params.agentItem);
  const blank = (): PreviewResource => ({
    id: 'new',
    name: '',
    description: '',
    enabled: false,
    scope: 'Mine',
    instructions: '',
    schedule: 'Every weekday',
    time: '09:00',
    tools: [],
    model: 'Auto',
  });
  const emptyDraft = blank();
  const open = (id: string) => {
    setSaved(false);
    setParams({ agentItem: id, agentSection: undefined });
  };
  const back = () =>
    setParams({ agentItem: undefined, agentSection: undefined });
  const create = (template?: {
    name: string;
    description: string;
    tools: string[];
    instructions: string;
  }) => {
    setNewDraft({ ...blank(), ...template });
    open('new');
  };
  const visible = () =>
    records().filter(
      (item) =>
        item.scope === scope() &&
        `${item.name} ${item.description}`
          .toLowerCase()
          .includes(search().toLowerCase())
    );
  const save = (draft: PreviewResource) => {
    const item = {
      ...draft,
      id: draft.id === 'new' ? crypto.randomUUID() : draft.id,
    };
    setRecords((items) =>
      items.some((entry) => entry.id === item.id)
        ? items.map((entry) => (entry.id === item.id ? item : entry))
        : [...items, item]
    );
    setScope(item.scope);
    setSaved(true);
    setParams({ agentItem: item.id, agentSection: undefined });
  };
  return (
    <div class="@container flex h-full min-h-0 flex-col">
      <header class="flex h-12 shrink-0 items-center gap-2 px-4 text-sm">
        <Show
          when={selected()}
          fallback={<span class="font-semibold">{title()}</span>}
        >
          <button
            type="button"
            onClick={back}
            class="rounded text-ink-muted hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/50"
          >
            {title()}
          </button>
          <CaretRight class="size-3 text-ink-extra-muted" />
          <span class="min-w-0 truncate">
            {selected()?.name || `New ${noun()}`}
          </span>
          <Show when={params.agentSection && params.agentSection !== 'history'}>
            <CaretRight class="size-3 shrink-0 text-ink-extra-muted" />
            <span class="capitalize text-ink-muted">
              {String(params.agentSection)}
            </span>
          </Show>
        </Show>
        <span
          title="Sample data. Changes stay in this preview."
          class="ml-auto shrink-0 rounded-md border border-edge-muted px-2 py-0.5 text-[11px] text-ink-extra-muted"
        >
          Design preview
        </span>
      </header>
      <div class="min-h-0 flex-1 overflow-y-auto">
        <Show
          when={params.agentItem}
          fallback={
            <div class="mx-auto max-w-5xl space-y-10 px-4 py-4">
              <div class="flex flex-col items-start justify-between gap-5 @xl:flex-row @xl:gap-6">
                <div>
                  <h2 class="text-2xl font-medium tracking-tight">
                    {props.kind === 'routines' ? 'Routines' : 'Your agents'}
                  </h2>
                  <p class="mt-2 max-w-xl text-sm leading-6 text-ink-muted">
                    {props.kind === 'routines'
                      ? 'Put recurring work in motion. Give an agent a rhythm, some context, and a clear outcome.'
                      : 'Create agents that know how you work. Give each one a focus, instructions, and the right tools.'}
                  </p>
                </div>
                <button type="button" class={PRIMARY} onClick={() => create()}>
                  <Plus class="size-4" />
                  New {noun()}
                </button>
              </div>
              <Show when={props.kind === 'agents'}>
                <Section
                  title={
                    props.kind === 'routines'
                      ? 'Made for your everyday'
                      : 'From Macro'
                  }
                  description={
                    props.kind === 'routines'
                      ? 'Useful starting points, ready to make your own.'
                      : 'A foundation you can adapt to your work.'
                  }
                >
                  <div class={PANEL}>
                    <For each={[DEFAULT_MACRO_AGENT]}>
                      {(template, index) => (
                        <button
                          type="button"
                          onClick={() => create(template)}
                          class="group flex w-full items-center gap-4 border-b border-edge-muted px-5 py-4 text-left last:border-0 hover:bg-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/50"
                        >
                          <span class="flex size-10 shrink-0 items-center justify-center rounded-xl border border-edge-muted bg-ink/4 text-ink-muted">
                            <Dynamic
                              component={
                                index() === 0
                                  ? Sparkle
                                  : props.kind === 'routines'
                                    ? Clock
                                    : Robot
                              }
                              class="size-5"
                            />
                          </span>
                          <span class="min-w-0 flex-1">
                            <span class="block text-sm font-medium">
                              {template.name}
                            </span>
                            <span class="mt-1 block text-[13px] leading-5 text-ink-muted">
                              {template.description}
                            </span>
                          </span>
                          <CaretRight class="size-4 shrink-0 text-ink-extra-muted group-hover:text-ink" />
                        </button>
                      )}
                    </For>
                  </div>
                </Section>
              </Show>
              <section>
                <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div
                    class="flex gap-1"
                    role="tablist"
                    aria-label={`${title()} ownership`}
                  >
                    <For each={['Mine', 'Team'] as const}>
                      {(tab) => (
                        <button
                          type="button"
                          role="tab"
                          aria-selected={scope() === tab}
                          onClick={() => setScope(tab)}
                          class={`${CONTROL} rounded-full`}
                          classList={{
                            'bg-ink/6 text-ink': scope() === tab,
                            'text-ink-muted': scope() !== tab,
                          }}
                        >
                          {tab}
                          <span class="text-xs text-ink-extra-muted">
                            {
                              records().filter((item) => item.scope === tab)
                                .length
                            }
                          </span>
                        </button>
                      )}
                    </For>
                  </div>
                  <label class="flex h-9 w-52 items-center gap-2 rounded-lg border border-edge-muted bg-ink/2 px-3 text-ink-extra-muted">
                    <MagnifyingGlass class="size-4 shrink-0" />
                    <input
                      aria-label={`Search ${props.kind}`}
                      type="search"
                      placeholder={`Search ${props.kind}…`}
                      value={search()}
                      onInput={(event) => setSearch(event.currentTarget.value)}
                      class="min-w-0 w-full bg-transparent text-xs text-ink outline-none"
                    />
                  </label>
                </div>
                <div class={PANEL}>
                  <div class="flex items-center gap-4 border-b border-edge-muted px-5 py-3 text-xs text-ink-extra-muted">
                    <span class="flex-1">Name</span>
                    <span class="hidden w-28 @2xl:block">
                      {props.kind === 'routines' ? 'Schedule' : 'Access'}
                    </span>
                    <span class="w-20">Status</span>
                    <span class="hidden w-20 @xl:block">Tools</span>
                    <span class="w-3" />
                  </div>
                  <For each={visible()}>
                    {(item) => (
                      <button
                        type="button"
                        onClick={() => open(item.id)}
                        class="group flex w-full items-center gap-4 border-b border-edge-muted px-5 py-4 text-left last:border-0 hover:bg-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/50"
                      >
                        <span class="min-w-0 flex-1">
                          <span class="block truncate text-sm font-medium">
                            {item.name}
                          </span>
                          <span class="mt-1 block truncate text-xs text-ink-extra-muted">
                            {item.description}
                          </span>
                        </span>
                        <span class="hidden w-28 shrink-0 text-xs text-ink-muted @2xl:block">
                          {props.kind === 'routines'
                            ? item.schedule
                            : item.scope === 'Mine'
                              ? 'Only you'
                              : 'Your team'}
                        </span>
                        <span class="w-20 shrink-0">
                          <Status enabled={item.enabled} />
                        </span>
                        <span class="hidden w-20 shrink-0 @xl:block">
                          <ToolIcons ids={item.tools} />
                        </span>
                        <CaretRight class="size-3 shrink-0 text-ink-extra-muted" />
                      </button>
                    )}
                  </For>
                  <Show when={visible().length === 0}>
                    <div class="px-5 py-10 text-center text-sm text-ink-muted">
                      {search()
                        ? `No ${props.kind} match “${search()}”.`
                        : `No ${props.kind} here yet.`}
                      <button
                        type="button"
                        class={`${CONTROL} mx-auto mt-3 flex`}
                        onClick={() => {
                          setSearch('');
                          create();
                        }}
                      >
                        Create a {noun()}
                        <ArrowRight class="size-3.5" />
                      </button>
                    </div>
                  </Show>
                </div>
              </section>
              <Show when={props.kind === 'agents'}>
                <Section
                  title="Start with a template"
                  description="Pick a starting point and make it yours."
                >
                  <div class="grid gap-3 @xl:grid-cols-2">
                    <For each={PREVIEW_TEMPLATES[props.kind]}>
                      {(template) => (
                        <button
                          type="button"
                          onClick={() => create(template)}
                          class={`${PANEL} group flex flex-col gap-4 p-5 text-left hover:bg-hover focus-visible:ring-2 focus-visible:ring-accent/50`}
                        >
                          <span class="flex items-center gap-3">
                            <span class="flex size-8 items-center justify-center rounded-lg bg-ink/4 text-ink-muted">
                              <ToolGlyph id={template.tools[0]} />
                            </span>
                            <span class="text-sm font-medium">
                              {template.name}
                            </span>
                            <ArrowRight class="ml-auto size-3.5 text-ink-extra-muted" />
                          </span>
                          <span class="flex-1 text-[13px] leading-5 text-ink-muted">
                            {template.description}
                          </span>
                          <span class="flex items-center gap-2 text-xs text-ink-extra-muted">
                            <Dynamic
                              component={
                                props.kind === 'routines' ? Clock : Robot
                              }
                              class="size-3.5"
                            />
                            {props.kind === 'routines'
                              ? 'Scheduled'
                              : 'On demand'}
                            <span class="mx-1">·</span>
                            {template.tools
                              .map(
                                (id) =>
                                  PREVIEW_TOOLS.find((tool) => tool.id === id)
                                    ?.name
                              )
                              .join(', ')}
                          </span>
                        </button>
                      )}
                    </For>
                  </div>
                </Section>
              </Show>
              <p class="text-xs text-ink-extra-muted">
                Sample workspace · edits here won’t create agents or schedule
                runs.
              </p>
            </div>
          }
        >
          <Show
            when={selected()}
            keyed
            fallback={
              <div class="p-8 text-sm text-ink-muted">
                This preview isn’t available.
                <button class={CONTROL} onClick={back}>
                  Back to {title()}
                </button>
              </div>
            }
          >
            {(item) => (
              <ResourceEditor
                initial={item}
                kind={props.kind}
                saved={saved()}
                onSave={save}
                onBack={back}
              />
            )}
          </Show>
        </Show>
      </div>
    </div>
  );
}

function ResourceEditor(props: {
  initial: PreviewResource;
  kind: ManagementKind;
  saved: boolean;
  onSave: (item: PreviewResource) => void;
  onBack: () => void;
}) {
  const [params, setParams] = useSearchParams();
  const [draft, setDraft] = createSignal({
    ...props.initial,
    tools: [...props.initial.tools],
  });
  const [hasEdits, setHasEdits] = createSignal(false);
  const patch = (value: Partial<PreviewResource>) => {
    setHasEdits(true);
    setDraft((item) => ({ ...item, ...value }));
  };
  const section = () =>
    typeof params.agentSection === 'string' ? params.agentSection : 'settings';
  const navigate = (next?: string) => setParams({ agentSection: next });
  const noun = () => (props.kind === 'routines' ? 'routine' : 'agent');
  const toggleTool = (id: string) =>
    patch({
      tools: draft().tools.includes(id)
        ? draft().tools.filter((tool) => tool !== id)
        : [...draft().tools, id],
    });
  return (
    <div class="mx-auto max-w-4xl px-4 py-4">
      <button
        type="button"
        class="mb-6 inline-flex items-center gap-2 rounded text-xs text-ink-muted hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/50"
        onClick={() =>
          section() === 'settings' || section() === 'history'
            ? props.onBack()
            : navigate()
        }
      >
        <ArrowLeft class="size-3.5" />
        {section() === 'settings' || section() === 'history'
          ? `All ${props.kind}`
          : `Back to ${draft().name || noun()}`}
      </button>
      <Show
        when={section() === 'settings' || section() === 'history'}
        fallback={
          <div class="space-y-7">
            <div>
              <h2 class="text-2xl font-medium tracking-tight">
                {section() === 'tools'
                  ? 'Tools & connections'
                  : 'When should it run?'}
              </h2>
              <p class="mt-2 text-sm text-ink-muted">
                {section() === 'tools'
                  ? 'Give this agent access to the context it needs.'
                  : 'Choose the rhythm that works for you.'}
              </p>
            </div>
            <Show
              when={section() === 'tools'}
              fallback={
                <div class="space-y-6">
                  <div class={PANEL}>
                    <For
                      each={[
                        'Every weekday',
                        'Every day',
                        'Every Monday',
                        'Every Friday',
                      ]}
                    >
                      {(schedule) => (
                        <button
                          type="button"
                          aria-pressed={draft().schedule === schedule}
                          onClick={() => patch({ schedule })}
                          class="flex w-full items-center gap-3 border-b border-edge-muted px-5 py-4 text-left last:border-0 hover:bg-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/50"
                        >
                          <Clock class="size-4 text-ink-muted" />
                          <span class="flex-1 text-sm">{schedule}</span>
                          <Show when={draft().schedule === schedule}>
                            <Check class="size-4 text-ink" />
                          </Show>
                        </button>
                      )}
                    </For>
                  </div>
                  <label class="block max-w-xs text-sm">
                    At time
                    <input
                      type="time"
                      aria-label="Run at time"
                      class={`${INPUT} mt-2`}
                      value={draft().time}
                      onInput={(event) =>
                        patch({ time: event.currentTarget.value })
                      }
                    />
                  </label>
                  <p class="text-xs text-ink-extra-muted">
                    Timezone: {Intl.DateTimeFormat().resolvedOptions().timeZone}
                  </p>
                </div>
              }
            >
              <div class={PANEL}>
                <For each={PREVIEW_TOOLS}>
                  {(tool) => (
                    <label class="flex items-center gap-4 border-b border-edge-muted px-5 py-4 last:border-0 hover:bg-hover">
                      <span class="flex size-10 items-center justify-center rounded-xl border border-edge-muted bg-ink/3 text-ink-muted">
                        <ToolGlyph id={tool.id} class="size-5" />
                      </span>
                      <span class="flex-1">
                        <span class="block text-sm font-medium">
                          {tool.name}
                        </span>
                        <span class="mt-1 block text-xs leading-5 text-ink-muted">
                          {tool.description}
                        </span>
                      </span>
                      <input
                        type="checkbox"
                        aria-label={tool.name}
                        checked={draft().tools.includes(tool.id)}
                        onChange={() => toggleTool(tool.id)}
                        class="size-4 accent-current"
                      />
                    </label>
                  )}
                </For>
              </div>
            </Show>
            <div class="flex justify-end">
              <button class={PRIMARY} onClick={() => navigate()}>
                Done
                <Check class="size-3.5" />
              </button>
            </div>
          </div>
        }
      >
        <div class="space-y-8">
          <div>
            <div class="flex items-start gap-4">
              <div class="min-w-0 flex-1">
                <input
                  aria-label={`${props.kind === 'routines' ? 'Routine' : 'Agent'} name`}
                  placeholder={`Untitled ${noun()}`}
                  value={draft().name}
                  onInput={(event) =>
                    patch({ name: event.currentTarget.value })
                  }
                  class="w-full min-w-0 bg-transparent text-2xl font-medium tracking-tight text-ink outline-none placeholder:text-ink-muted focus-visible:rounded focus-visible:ring-2 focus-visible:ring-accent/30"
                />
                <input
                  aria-label="Description"
                  placeholder="Add a short description…"
                  value={draft().description}
                  onInput={(event) =>
                    patch({ description: event.currentTarget.value })
                  }
                  class="mt-2 w-full bg-transparent text-sm text-ink-muted outline-none placeholder:text-ink-extra-muted focus-visible:rounded focus-visible:ring-2 focus-visible:ring-accent/30"
                />
              </div>
              <button
                type="button"
                class={PRIMARY}
                disabled={!draft().name.trim()}
                onClick={() => props.onSave(draft())}
                classList={{ 'opacity-40': !draft().name.trim() }}
              >
                Save {noun()}
              </button>
            </div>
            <div class="mt-5 flex flex-wrap items-center gap-4 text-xs text-ink-muted">
              <button
                type="button"
                role="switch"
                aria-checked={draft().enabled}
                aria-label={`Enable ${noun()} in preview`}
                onClick={() => patch({ enabled: !draft().enabled })}
                class="flex items-center gap-2 rounded focus-visible:ring-2 focus-visible:ring-accent/50"
              >
                <span
                  class="flex h-5 w-8 items-center rounded-full p-0.5"
                  classList={{
                    'bg-success': draft().enabled,
                    'bg-ink/15': !draft().enabled,
                  }}
                >
                  <span
                    class="size-4 rounded-full bg-panel shadow-sm transition-transform motion-reduce:transition-none"
                    classList={{ 'translate-x-3': draft().enabled }}
                  />
                </span>
                {draft().enabled ? 'Enabled' : 'Paused'}
              </button>
              <span class="h-3 w-px bg-edge-muted" />
              <label class="flex items-center gap-2">
                Access
                <select
                  aria-label="Access"
                  value={draft().scope}
                  onChange={(event) =>
                    patch({
                      scope: event.currentTarget.value as 'Mine' | 'Team',
                    })
                  }
                  class="rounded bg-panel py-1 text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                >
                  <option value="Mine">Only me</option>
                  <option value="Team">My team</option>
                </select>
              </label>
              <span class="h-3 w-px bg-edge-muted" />
              <span>Preview configuration</span>
            </div>
            <Show when={props.saved && !hasEdits()}>
              <p
                role="status"
                class="mt-4 flex items-center gap-2 text-xs text-success"
              >
                <Check class="size-3.5" />
                Saved in this preview
              </p>
            </Show>
          </div>
          <div
            class="flex gap-1 pb-3"
            role="tablist"
            aria-label={`${noun()} details`}
          >
            <For each={['settings', 'history']}>
              {(tab) => (
                <button
                  type="button"
                  role="tab"
                  aria-selected={section() === tab}
                  class={`${CONTROL} rounded-full`}
                  classList={{
                    'bg-ink/6 text-ink': section() === tab,
                    'text-ink-muted': section() !== tab,
                  }}
                  onClick={() => navigate(tab === 'settings' ? undefined : tab)}
                >
                  {tab === 'settings'
                    ? 'Settings'
                    : props.kind === 'routines'
                      ? 'Run history'
                      : 'Activity'}
                </button>
              )}
            </For>
          </div>
          <Show
            when={section() === 'settings'}
            fallback={
              <Section
                title={
                  props.kind === 'routines' ? 'Recent runs' : 'Recent activity'
                }
                description="Sample history to illustrate this layout."
              >
                <Show
                  when={PREVIEW_RESOURCES[props.kind].some(
                    (item) => item.id === props.initial.id
                  )}
                  fallback={
                    <div class={`${PANEL} py-14 text-center`}>
                      <Clock class="mx-auto mb-3 size-6 text-ink-extra-muted" />
                      <p class="text-sm text-ink-muted">No runs yet</p>
                      <p class="mt-1 text-xs text-ink-extra-muted">
                        Your history will appear here.
                      </p>
                    </div>
                  }
                >
                  <div class={PANEL}>
                    <For
                      each={[
                        'Today at 9:00 AM',
                        'Yesterday at 9:00 AM',
                        'Monday at 9:00 AM',
                      ]}
                    >
                      {(date, index) => (
                        <details class="group border-b border-edge-muted last:border-0">
                          <summary class="flex min-h-16 list-none items-center gap-3 px-5 py-4 hover:bg-hover focus-visible:ring-2 focus-visible:ring-accent/50">
                            <span class="flex size-7 items-center justify-center rounded-full bg-success/10 text-success">
                              <Check class="size-3.5" />
                            </span>
                            <span class="flex-1 text-sm">{date}</span>
                            <span class="text-xs text-ink-extra-muted">
                              {index() === 0 ? '24s' : '31s'}
                            </span>
                            <span class="text-xs text-success">Completed</span>
                            <CaretRight class="size-3.5 text-ink-extra-muted group-open:rotate-90" />
                          </summary>
                          <div class="space-y-3 border-t border-edge-muted bg-ink/2 px-5 py-4 text-[13px]">
                            <p class="text-ink-muted">
                              Gathered context from{' '}
                              {draft()
                                .tools.map(
                                  (id) =>
                                    PREVIEW_TOOLS.find((tool) => tool.id === id)
                                      ?.name
                                )
                                .join(', ') || 'the available tools'}
                              .
                            </p>
                            <p class="text-ink">
                              Prepared a summary with the key updates and
                              suggested next steps.
                            </p>
                            <span class="inline-block rounded-md bg-ink/5 px-2 py-1 text-xs text-ink-extra-muted">
                              Example output
                            </span>
                          </div>
                        </details>
                      )}
                    </For>
                  </div>
                </Show>
              </Section>
            }
          >
            <Show when={props.kind === 'routines'}>
              <Section
                title="Trigger"
                description="Set a schedule for this routine."
              >
                <button
                  type="button"
                  class={`${PANEL} flex w-full items-center gap-4 px-5 py-4 text-left hover:bg-hover focus-visible:ring-2 focus-visible:ring-accent/50`}
                  onClick={() => navigate('trigger')}
                >
                  <span class="flex size-9 items-center justify-center rounded-lg bg-ink/4 text-ink-muted">
                    <Clock class="size-4" />
                  </span>
                  <span class="flex-1">
                    <span class="block text-sm">{draft().schedule}</span>
                    <span class="mt-1 block text-xs text-ink-muted">
                      At {draft().time} ·{' '}
                      {Intl.DateTimeFormat().resolvedOptions().timeZone}
                    </span>
                  </span>
                  <span class="text-xs text-ink-extra-muted">Edit</span>
                  <CaretRight class="size-3.5 text-ink-extra-muted" />
                </button>
              </Section>
            </Show>
            <Section
              title="Instructions"
              description={
                props.kind === 'routines'
                  ? 'Describe what a successful run should accomplish.'
                  : 'Define its role, how it should work, and what it should know.'
              }
            >
              <div class={PANEL}>
                <textarea
                  aria-label="Agent instructions"
                  placeholder="What should this agent do?"
                  value={draft().instructions}
                  onInput={(event) =>
                    patch({ instructions: event.currentTarget.value })
                  }
                  class="min-h-48 w-full resize-y bg-transparent px-5 py-4 text-sm leading-7 text-ink outline-none placeholder:text-ink-extra-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/30"
                />
                <div class="flex items-center justify-between border-t border-edge-muted px-4 py-2.5">
                  <label class="flex items-center gap-2 text-xs text-ink-muted">
                    <Sparkle class="size-3.5" />
                    <select
                      aria-label="Model"
                      class="max-w-52 rounded bg-panel py-1 text-xs text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                      value={draft().model}
                      onChange={(event) =>
                        patch({ model: event.currentTarget.value })
                      }
                    >
                      <option>Auto</option>
                      <option>Fast</option>
                      <option>Thinking</option>
                    </select>
                  </label>
                  <span class="text-[11px] text-ink-extra-muted">
                    {draft().instructions.length} characters
                  </span>
                </div>
              </div>
            </Section>
            <Section
              title="Tools & connections"
              description="The context and capabilities this agent can use."
              action={
                <button
                  type="button"
                  class={`${CONTROL} text-ink-muted`}
                  onClick={() => navigate('tools')}
                >
                  <Plus class="size-3.5" />
                  Add tools
                </button>
              }
            >
              <div class={PANEL}>
                <For each={draft().tools}>
                  {(id) => (
                    <button
                      type="button"
                      class="flex w-full items-center gap-3 border-b border-edge-muted px-5 py-4 text-left last:border-0 hover:bg-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/50"
                      onClick={() => navigate('tools')}
                    >
                      <ToolGlyph id={id} />
                      <span class="flex-1 text-sm">
                        {PREVIEW_TOOLS.find((tool) => tool.id === id)?.name ??
                          id}
                      </span>
                      <span class="text-xs text-ink-muted">Included</span>
                      <CaretRight class="size-3.5 text-ink-extra-muted" />
                    </button>
                  )}
                </For>
                <Show when={!draft().tools.length}>
                  <button
                    type="button"
                    class="flex w-full items-center gap-3 px-5 py-5 text-sm text-ink-muted hover:bg-hover"
                    onClick={() => navigate('tools')}
                  >
                    <Plus class="size-4" />
                    Choose tools for this agent
                  </button>
                </Show>
              </div>
            </Section>
            <p class="pb-4 text-xs leading-5 text-ink-extra-muted">
              This is a design preview. Saving changes updates this example
              only; it doesn’t enable an agent or schedule a run.
            </p>
          </Show>
        </div>
      </Show>
    </div>
  );
}
