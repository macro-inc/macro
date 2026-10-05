import BuildingOffice from '@phosphor/building-office.svg';
import CaretDown from '@phosphor/caret-down.svg';
import CaretRight from '@phosphor/caret-right.svg';
import CheckSquare from '@phosphor/check-square.svg';
import CircleDashed from '@phosphor/circle-dashed.svg';
import Clock from '@phosphor/clock.svg';
import Envelope from '@phosphor/envelope.svg';
import File from '@phosphor/file.svg';
import FilePdf from '@phosphor/file-pdf.svg';
import Files from '@phosphor/files.svg';
import Globe from '@phosphor/globe.svg';
import LinkIcon from '@phosphor/link.svg';
import ListBullets from '@phosphor/list-bullets.svg';
import Phone from '@phosphor/phone.svg';
import PhoneCall from '@phosphor/phone-call.svg';
import Plus from '@phosphor/plus.svg';
import SidebarSimple from '@phosphor/sidebar-simple.svg';
import SquaresFour from '@phosphor/squares-four.svg';
import Users from '@phosphor/users.svg';
import { Button, Dropdown } from '@ui';
import { Badge, badgeTriggerClasses } from '@ui/components/Badge';
import { TabsInset } from '@ui/components/TabsInset';
import {
  type Component,
  createEffect,
  createSignal,
  For,
  type JSX,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import type {
  WorkspaceComment,
  WorkspaceView,
} from '../../core/dummy-workspace';
import {
  type HomepagePersonId,
  homepagePeople,
} from '../../core/homepage-demo-people';
import {
  type CompanyEmail,
  type DealStage,
  dealStages,
  type SampleCompany,
} from '../../core/workspace-fixtures';
import type { DummyWorkspace } from '../../primitives/createDummyWorkspace';
import { ChannelComposer } from '../email/frozen/ChannelComposer';
import { SearchBar } from '../email/frozen/SearchBar';
import { PanelGrid, PanelRow } from './frozen/DetailPanel';
import { MessageRow } from './frozen/MessageRow';
import { PropertyValueIcon } from './frozen/PropertyValueIcon';
import { PROPERTY_OPTION_IDS } from './frozen/property-identifiers';
import { PersonIcon, PRIORITY_IDS, STATUS_IDS } from './frozen/TaskProperties';
import './workspace-companies.css';

/** crm/core/record: a company's top-bar tabs, in display order. */
export const COMPANY_SECTIONS = [
  'overview',
  'team',
  'emails',
  'files',
  'tasks',
  'calls',
] as const;
export type CompanySection = (typeof COMPANY_SECTIONS)[number];
const SECTION_LABELS: Record<CompanySection, string> = {
  overview: 'Overview',
  team: 'Team',
  emails: 'Emails',
  files: 'Files',
  tasks: 'Tasks',
  calls: 'Calls',
};
const SECTION_ICONS: Record<
  CompanySection,
  Component<JSX.SvgSVGAttributes<SVGSVGElement>>
> = {
  overview: SquaresFour,
  team: Users,
  emails: Envelope,
  files: Files,
  tasks: CheckSquare,
  calls: Phone,
};

export const STAGE_IDS: Record<Exclude<DealStage, 'No stage'>, string> = {
  Lead: PROPERTY_OPTION_IDS.STAGE.LEAD,
  Qualified: PROPERTY_OPTION_IDS.STAGE.QUALIFIED,
  Demo: PROPERTY_OPTION_IDS.STAGE.DEMO,
  Trial: PROPERTY_OPTION_IDS.STAGE.TRIAL,
  Negotiation: PROPERTY_OPTION_IDS.STAGE.NEGOTIATION,
  Customer: PROPERTY_OPTION_IDS.STAGE.CUSTOMER,
  Churned: PROPERTY_OPTION_IDS.STAGE.CHURNED,
};
const COMPANY_OWNERS = [
  'jacob',
  'julia',
  'teo',
  'valentina',
  'gabriel',
] as const;

/** CrmStageIcon: the system stage dot, or the dashed circle for No stage. */
export function StageIcon(props: { stage: DealStage; class?: string }) {
  return (
    <Show
      when={props.stage !== 'No stage' && props.stage}
      fallback={
        <CircleDashed
          class={`${props.class ?? 'size-3'} shrink-0 text-ink-extra-muted`}
        />
      }
    >
      {(stage) => (
        <PropertyValueIcon
          optionId={STAGE_IDS[stage() as Exclude<DealStage, 'No stage'>]}
          class={`${props.class ?? 'size-3'} shrink-0`}
        />
      )}
    </Show>
  );
}

/** crm/views/company-header Description: three lines, then Show more. */
function Description(props: { text: string }) {
  const [expanded, setExpanded] = createSignal(false);
  const [overflow, setOverflow] = createSignal(false);
  let ref: HTMLParagraphElement | undefined;
  const measure = () => {
    if (ref && !expanded())
      setOverflow(ref.scrollHeight > ref.clientHeight + 1);
  };
  createEffect(() => {
    props.text;
    if (expanded()) return;
    const frame = requestAnimationFrame(measure);
    onCleanup(() => cancelAnimationFrame(frame));
  });
  onMount(() => {
    if (typeof ResizeObserver === 'undefined' || !ref) return;
    const observer = new ResizeObserver(measure);
    observer.observe(ref);
    onCleanup(() => observer.disconnect());
  });
  return (
    <div class="sample-company-description flex flex-col items-start gap-0.5">
      <p
        ref={ref}
        class={`text-sm text-ink-muted ${expanded() ? '' : 'line-clamp-3'}`}
      >
        {props.text}
      </p>
      <Show when={overflow() || expanded()}>
        <button
          type="button"
          onClick={() => setExpanded(!expanded())}
          class="text-xs text-ink-muted underline hover:text-ink"
        >
          {expanded() ? 'Show less' : 'Show more'}
        </button>
      </Show>
    </div>
  );
}

/** EntityConversation on the company: unanchored roots with inline replies. */
function Discussion(props: {
  comments: WorkspaceComment[];
  onChange: (comments: WorkspaceComment[]) => void;
}) {
  const [expanded, setExpanded] = createSignal(true);
  const [replying, setReplying] = createSignal<string>();
  const [openThreads, setOpenThreads] = createSignal<string[]>([]);
  const roots = () => props.comments.filter((comment) => !comment.replyTo);
  const replies = (id: string) =>
    props.comments.filter((comment) => comment.replyTo === id);
  const time = () =>
    new Date().toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    });
  const send = (body: string, replyTo?: string) =>
    props.onChange([
      ...props.comments,
      {
        id: crypto.randomUUID(),
        person: 'jacob',
        body,
        time: time(),
        replyTo,
      },
    ]);
  const react = (id: string) =>
    props.onChange(
      props.comments.map((comment) =>
        comment.id !== id
          ? comment
          : {
              ...comment,
              reactions: comment.reactions?.includes('jacob')
                ? comment.reactions.filter((person) => person !== 'jacob')
                : [...(comment.reactions ?? []), 'jacob'],
            }
      )
    );
  const row = (message: WorkspaceComment) => (
    <MessageRow
      message={message}
      onReact={() => react(message.id)}
      onReply={() => setReplying(message.replyTo ?? message.id)}
    />
  );
  return (
    <section class="sample-company-discussion" data-entity-conversation>
      <button
        type="button"
        class="flex items-center gap-1"
        aria-expanded={expanded()}
        onClick={() => setExpanded(!expanded())}
      >
        <Show when={expanded()} fallback={<CaretRight class="size-3" />}>
          <CaretDown class="size-3" />
        </Show>
        <span class="text-xs">Discussion</span>
      </button>
      <Show when={expanded()}>
        <For each={roots()}>
          {(root) => {
            const shown = () =>
              openThreads().includes(root.id)
                ? replies(root.id)
                : replies(root.id).slice(0, 3);
            const hidden = () => replies(root.id).slice(shown().length);
            return (
              <div
                class="sample-channel-thread"
                data-thread-id={root.id}
                data-thread-open={
                  replies(root.id).length > 0 || replying() === root.id
                }
              >
                {row(root)}
                <Show when={replies(root.id).length || replying() === root.id}>
                  <div class="sample-thread-replies">
                    <For each={shown()}>{(reply) => row(reply)}</For>
                    <Show when={hidden().length}>
                      <button
                        type="button"
                        class="sample-thread-expand"
                        title="Expand thread"
                        onClick={() =>
                          setOpenThreads((ids) => [...ids, root.id])
                        }
                      >
                        <span class="sample-thread-avatars" aria-hidden="true">
                          <For
                            each={[
                              ...new Set(hidden().map((reply) => reply.person)),
                            ].slice(0, 4)}
                          >
                            {(person) => (
                              <img alt="" src={homepagePeople[person].photo} />
                            )}
                          </For>
                        </span>
                        <span class="text-accent">
                          {hidden().length}{' '}
                          {hidden().length === 1
                            ? 'more reply'
                            : 'more replies'}
                        </span>
                        <span class="text-ink-extra-muted">
                          Last reply today
                        </span>
                        <CaretRight class="size-3 text-ink-extra-muted" />
                      </button>
                    </Show>
                    <Show when={replying() === root.id}>
                      <div class="sample-thread-editor">
                        <ChannelComposer
                          label="Thread reply"
                          placeholder="Send a reply"
                          onSend={(body) => {
                            send(body, root.id);
                            setReplying(undefined);
                          }}
                        />
                      </div>
                    </Show>
                  </div>
                </Show>
              </div>
            );
          }}
        </For>
        <div class="mt-4" data-discussion-composer>
          <ChannelComposer
            label="Comment on company"
            placeholder="Leave a comment..."
            onSend={(body) => send(body)}
          />
        </div>
      </Show>
    </section>
  );
}

/** Property.Pill / Property.Caret with the app's Dropdown surface. */
function PropertyMenu<T extends string>(props: {
  id: string;
  label: string;
  value: T | '';
  options: readonly T[];
  icon: (value: T) => JSX.Element;
  display?: (value: T) => string;
  onSave: (value: T) => void;
}) {
  return (
    <Dropdown modal={false}>
      <Dropdown.Trigger
        aria-label={`Change ${props.label}`}
        data-company-property={props.id}
        data-slot="property-pill"
        noTouchResize
        class={badgeTriggerClasses({
          variant: 'outline',
          size: 'sm',
          class: 'max-w-full text-left bg-surface-2 border-0',
        })}
      >
        <Show
          when={props.value}
          fallback={<span class="text-ink-extra-muted">Empty</span>}
        >
          {(value) => (
            <>
              {props.icon(value() as T)}
              <span class="truncate">
                {props.display?.(value() as T) ?? value()}
              </span>
            </>
          )}
        </Show>
        <CaretDown class="size-3 shrink-0" />
      </Dropdown.Trigger>
      <Dropdown.Content
        depth={3}
        class="max-h-96 overflow-hidden flex flex-col w-56 max-w-70 p-0 text-sm"
        portalScope="local"
      >
        <Dropdown.Group>
          <Dropdown.GroupLabel>{props.label}</Dropdown.GroupLabel>
          <For each={props.options}>
            {(option) => (
              <Dropdown.Item onSelect={() => props.onSave(option)}>
                {props.icon(option)}
                <span>{props.display?.(option) ?? option}</span>
                <span class="ml-auto text-ink-muted">
                  {option === props.value ? '✓' : ''}
                </span>
              </Dropdown.Item>
            )}
          </For>
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
}

/** SidePanel.Section in its floating form: a header row that collapses. */
function PanelSection(props: {
  title: string;
  open?: boolean;
  children: JSX.Element;
}) {
  return (
    <details class="sample-company-panel-section" open={props.open}>
      <summary>
        <span>{props.title}</span>
        <CaretRight class="size-3 shrink-0" />
      </summary>
      <div class="px-2 pb-2 text-sm">{props.children}</div>
    </details>
  );
}

function SharingToggle(props: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: JSX.Element;
}) {
  return (
    <div class="flex flex-col gap-2">
      <button
        type="button"
        role="checkbox"
        aria-checked={props.checked}
        class="sample-company-toggle"
        onClick={() => props.onChange(!props.checked)}
      >
        <span class="sample-company-checkbox" data-checked={props.checked} />
        <span class="whitespace-nowrap">{props.label}</span>
      </button>
      <p class="text-ink-muted leading-5">{props.children}</p>
    </div>
  );
}

function CompanyPanel(props: {
  company: SampleCompany;
  update: (patch: Partial<SampleCompany>) => void;
}) {
  const [visible, setVisible] = createSignal(true);
  const [sync, setSync] = createSignal(true);
  return (
    <aside aria-label="Details panel" class="sample-company-panel">
      <PanelSection title="Properties" open>
        <PanelGrid>
          <PanelRow label="Stage">
            <PropertyMenu
              id="stage"
              label="Stage"
              value={
                props.company.stage === 'No stage' ? '' : props.company.stage
              }
              options={dealStages.filter((stage) => stage !== 'No stage')}
              icon={(stage) => <StageIcon stage={stage} />}
              onSave={(stage) => props.update({ stage })}
            />
          </PanelRow>
          <PanelRow label="Owner">
            <PropertyMenu
              id="owner"
              label="Owner"
              value={props.company.owner}
              options={COMPANY_OWNERS}
              icon={(person) => <PersonIcon person={person} />}
              display={(person) => homepagePeople[person].shortName}
              onSave={(owner) => props.update({ owner })}
            />
          </PanelRow>
          <PanelRow label="Revenue">
            <input
              aria-label="Revenue"
              class="sample-inline-input sample-company-revenue"
              placeholder="Empty"
              inputMode="decimal"
              value={props.company.revenue}
              onInput={(e) => props.update({ revenue: e.currentTarget.value })}
            />
          </PanelRow>
        </PanelGrid>
      </PanelSection>
      <PanelSection title="Lists" open>
        <div class="flex flex-col gap-3">
          <Show
            when={props.company.lists?.length}
            fallback={
              <p class="text-xs text-ink-muted">Not in any lists yet.</p>
            }
          >
            <div
              class="flex flex-wrap gap-1.5"
              aria-label="Company list memberships"
            >
              <For each={props.company.lists}>
                {(list) => (
                  <span class="inline-flex max-w-full items-center gap-1.5 rounded-lg bg-active px-2 py-1 text-xs">
                    <ListBullets class="size-3.5 shrink-0" />
                    <span class="truncate">{list}</span>
                  </span>
                )}
              </For>
            </div>
          </Show>
        </div>
      </PanelSection>
      <PanelSection title="Sharing">
        <div class="flex flex-col gap-4 text-xs">
          <SharingToggle
            label="Visible in CRM"
            checked={visible()}
            onChange={setVisible}
          >
            Shows this company in your team's CRM lists and search. Hide
            companies that aren't relevant to your team's CRM.
          </SharingToggle>
          <SharingToggle
            label="Sync Emails"
            checked={sync()}
            onChange={setSync}
          >
            Lets everyone on your team see each other's emails with this
            company.
          </SharingToggle>
        </div>
      </PanelSection>
    </aside>
  );
}

/** components/record-section: a title row with actions above the list. */
function RecordSection(props: {
  title: string;
  actions?: JSX.Element;
  children: JSX.Element;
}) {
  return (
    <div class="sample-record-section">
      <div class="sample-record-section-header">
        <h2 class="text-sm font-medium text-ink-muted">{props.title}</h2>
        <Show when={props.actions}>
          <div class="ml-auto flex shrink-0 items-center gap-2.5">
            {props.actions}
          </div>
        </Show>
      </div>
      <div class="dummy-scroll px-2 pb-6">{props.children}</div>
    </div>
  );
}

function EmptyList(props: { children: JSX.Element }) {
  return (
    <div class="rounded-lg border border-dashed border-edge-muted p-6 text-center text-sm text-ink-muted">
      {props.children}
    </div>
  );
}

/** A unified-list row (ListEntity's wide layout) for emails, files and calls. */
function RecordRow(props: {
  icon: JSX.Element;
  title: string;
  label: string;
  detail?: JSX.Element;
  time: string;
  unread?: boolean;
  onOpen?: () => void;
}) {
  const content = () => (
    <>
      <span class="sample-record-row-indicator">
        <Show when={props.unread}>
          <span class="size-1.5 rounded-full bg-accent" />
        </Show>
      </span>
      <span class="sample-record-row-content">
        {props.icon}
        <span class="sample-record-row-title truncate">{props.title}</span>
        <span class="sample-record-row-detail truncate">{props.detail}</span>
      </span>
      <span class="sample-record-row-time">{props.time}</span>
    </>
  );
  return (
    <Show
      when={props.onOpen}
      fallback={<div class="sample-record-row">{content()}</div>}
    >
      {(open) => (
        <button
          type="button"
          class="sample-record-row"
          aria-label={props.label}
          onClick={() => open()()}
        >
          {content()}
        </button>
      )}
    </Show>
  );
}

function CompanyEmails(props: {
  emails: CompanyEmail[];
  onOpen: (email: CompanyEmail) => (() => void) | undefined;
}) {
  const [signal, setSignal] = createSignal<'signal' | 'all'>('all');
  const [scope, setScope] = createSignal<'team' | 'me'>('team');
  const emails = () =>
    props.emails.filter(
      (email) =>
        (signal() === 'all' || email.signal) &&
        (scope() === 'team' || email.mine)
    );
  const empty = () => {
    const kind = signal() === 'signal' ? 'signal emails' : 'emails';
    return scope() === 'me'
      ? `No ${kind} with this company in your inbox.`
      : `No ${kind} with this company yet.`;
  };
  return (
    <RecordSection
      title="Emails"
      actions={
        <>
          <TabsInset
            aria-label="Email importance"
            list={[
              { value: 'signal', label: 'Signal' },
              { value: 'all', label: 'All' },
            ]}
            value={signal()}
            onChange={(value) =>
              setSignal(value === 'signal' ? 'signal' : 'all')
            }
          />
          <TabsInset
            aria-label="Whose emails"
            list={[
              { value: 'team', label: 'Team' },
              { value: 'me', label: 'Me' },
            ]}
            value={scope()}
            onChange={(value) => setScope(value === 'me' ? 'me' : 'team')}
          />
        </>
      }
    >
      <Show when={emails().length} fallback={<EmptyList>{empty()}</EmptyList>}>
        <div aria-label="Company emails">
          <For each={emails()}>
            {(email) => (
              <RecordRow
                icon={<Envelope class="size-4 shrink-0 text-email" />}
                title={email.sender}
                label={`${email.sender} ${email.subject} ${email.time}`}
                detail={
                  <>
                    <span class="text-ink">{email.subject}</span>{' '}
                    <span class="sample-record-row-snippet truncate">
                      {email.snippet}
                    </span>
                  </>
                }
                time={email.time}
                unread={email.unread}
                onOpen={props.onOpen(email)}
              />
            )}
          </For>
        </div>
      </Show>
    </RecordSection>
  );
}

function CompanyTeam(props: { company: SampleCompany }) {
  const [search, setSearch] = createSignal('');
  const contacts = () =>
    props.company.contacts.filter((contact) =>
      `${contact.name} ${contact.email}`
        .toLowerCase()
        .includes(search().trim().toLowerCase())
    );
  return (
    <RecordSection
      title="Team"
      actions={
        <Button variant="ghost" size="sm">
          <Plus class="size-3.5" />
          Add contact
        </Button>
      }
    >
      <div class="px-2">
        <Show
          when={props.company.contacts.length}
          fallback={<div class="text-sm text-ink-muted">No contacts yet.</div>}
        >
          <div class="flex flex-col gap-2">
            <input
              type="text"
              aria-label="Search contacts"
              value={search()}
              onInput={(e) => setSearch(e.currentTarget.value)}
              placeholder="Search contacts…"
              class="w-full rounded-md border border-edge bg-surface px-2 py-1 text-sm text-ink placeholder:text-ink-placeholder focus:outline-none"
            />
            <Show
              when={contacts().length}
              fallback={
                <div class="text-sm text-ink-muted">No matching contacts.</div>
              }
            >
              <div class="flex flex-col gap-1" aria-label="Contacts">
                <For each={contacts()}>
                  {(contact) => (
                    <div class="flex min-w-0 flex-col gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-ink-muted/[0.06]">
                      <span class="truncate text-sm">{contact.name}</span>
                      <span class="truncate text-xs text-ink-muted">
                        {contact.email}
                      </span>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </div>
        </Show>
      </div>
    </RecordSection>
  );
}

function CompanyTasks(props: { company: SampleCompany }) {
  const [search, setSearch] = createSignal('');
  const tasks = () =>
    (props.company.tasks ?? []).filter((task) =>
      task.title.toLowerCase().includes(search().trim().toLowerCase())
    );
  const groups = () =>
    (Object.keys(STATUS_IDS) as (keyof typeof STATUS_IDS)[])
      .map((status) => ({
        status,
        tasks: tasks().filter((task) => task.status === status),
      }))
      .filter((group) => group.tasks.length);
  return (
    <RecordSection
      title="Tasks"
      actions={
        <SearchBar
          label="Search company tasks"
          placeholder="Search tasks"
          class="sample-record-search"
          value={search()}
          onValueChange={setSearch}
        />
      }
    >
      <Show
        when={groups().length}
        fallback={<EmptyList>No tasks with this company yet.</EmptyList>}
      >
        <div aria-label="Company tasks">
          <For each={groups()}>
            {(group) => (
              <>
                <div class="mx-2 mt-1 px-2 h-8 rounded-lg bg-hover text-xs text-ink-muted flex items-center gap-2">
                  <CaretDown class="size-3" />
                  <PropertyValueIcon
                    optionId={STATUS_IDS[group.status]}
                    class="size-3.5"
                  />
                  {group.status}
                  <span class="rounded-full px-1.5 bg-active">
                    {group.tasks.length}
                  </span>
                </div>
                <For each={group.tasks}>
                  {(task) => (
                    <div class="sample-record-task">
                      <PropertyValueIcon
                        optionId={STATUS_IDS[task.status]}
                        class="size-4"
                      />
                      <span class="truncate font-medium">{task.title}</span>
                      <span class="sample-record-task-priority">
                        <PropertyValueIcon
                          optionId={PRIORITY_IDS[task.priority]}
                          class="size-3.5"
                        />
                        <span>{task.priority}</span>
                      </span>
                      <span class="sample-record-task-owner">
                        <PersonIcon person={task.owner} />
                        <span>{homepagePeople[task.owner].shortName}</span>
                      </span>
                    </div>
                  )}
                </For>
              </>
            )}
          </For>
        </div>
      </Show>
    </RecordSection>
  );
}

function People(props: { people: HomepagePersonId[]; guests: string[] }) {
  return (
    <span class="sample-record-people">
      <For each={props.people}>
        {(person) => <img alt="" src={homepagePeople[person].photo} />}
      </For>
      <For each={props.guests}>
        {(guest) => (
          <span aria-hidden="true">
            {guest
              .split(' ')
              .map((part) => part[0])
              .join('')}
          </span>
        )}
      </For>
    </span>
  );
}

/**
 * crm/views/record-detail + company-detail: breadcrumbs, section tabs, copy
 * link and the floating information panel around a company's sections.
 */
export function CompanyRecord(props: {
  workspace: DummyWorkspace;
  company: SampleCompany;
  section: CompanySection;
  onSectionChange: (section: CompanySection) => void;
  panelOpen: boolean;
  onPanelChange: (open: boolean) => void;
  onOpenItem: (view: WorkspaceView, id: string) => void;
}) {
  const w = props.workspace;
  const update = (patch: Partial<SampleCompany>) =>
    w.setData('companies', (c) => c.id === props.company.id, patch);
  const emails = (): CompanyEmail[] => [
    ...w.data.emails
      .filter((email) => props.company.emailIds.includes(email.id))
      .map((email) => ({
        id: email.id,
        sender: email.sender,
        subject: email.subject,
        snippet: email.snippet,
        time: email.time,
        unread: email.unread,
        signal: !email.noise,
        mine: true,
      })),
    ...(props.company.emails ?? []),
  ];
  return (
    <div
      class="sample-company-record"
      data-panel-open={props.panelOpen ? 'true' : 'false'}
    >
      <div class="sample-company-topbar">
        <nav aria-label="CRM record location" class="sample-company-crumbs">
          <button
            type="button"
            class="sample-crumb sample-crumb-root"
            title={`Back to ${w.companyFilter()}`}
            onClick={() => w.open('crm')}
          >
            <span class="truncate">{w.companyFilter()}</span>
          </button>
          <CaretRight
            aria-hidden="true"
            class="sample-crumb-separator size-3 shrink-0 text-ink-extra-muted"
          />
          <button type="button" class="sample-crumb" aria-current="page">
            <BuildingOffice class="size-3.5 shrink-0" />
            <span class="truncate">{props.company.name}</span>
          </button>
        </nav>
        <div class="sample-company-tabs">
          <TabsInset
            aria-label="Record sections"
            class="shrink-0 whitespace-nowrap"
            list={COMPANY_SECTIONS.map((section) => {
              const Icon = SECTION_ICONS[section];
              return {
                value: section,
                label: (
                  <span
                    class="sample-record-tab"
                    data-record-tab={section}
                    title={SECTION_LABELS[section]}
                  >
                    <Icon class="size-4" aria-hidden="true" />
                    <span>{SECTION_LABELS[section]}</span>
                  </span>
                ),
              };
            })}
            value={props.section}
            onChange={(value) => {
              const section = COMPANY_SECTIONS.find((item) => item === value);
              if (section) props.onSectionChange(section);
            }}
          />
        </div>
        <div class="ml-auto flex shrink-0 items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            class="sample-company-copy shrink-0 bg-surface"
            label="Copy company link"
            onClick={() =>
              void navigator.clipboard
                ?.writeText(
                  `${location.origin}/demo#company-${props.company.id}`
                )
                .catch(() => {})
            }
          >
            <LinkIcon class="size-3.5" />
            <span>Copy link</span>
          </Button>
          <Button
            variant="ghost"
            size="icon-md"
            label="Toggle details panel"
            aria-expanded={props.panelOpen}
            onClick={() => props.onPanelChange(!props.panelOpen)}
          >
            <SidebarSimple />
          </Button>
        </div>
      </div>
      <div class="sample-company-body">
        <Show when={props.section === 'overview'}>
          <div class="dummy-scroll sample-company-scroll">
            <div class="sample-company-overview">
              <div>
                <div class="flex items-center gap-3">
                  <BuildingOffice class="size-8 shrink-0" aria-hidden="true" />
                  <h1 class="min-w-0 flex-1 text-2xl font-semibold">
                    <input
                      class="sample-inline-input"
                      aria-label="Company name"
                      placeholder="Company"
                      value={props.company.name}
                      onInput={(e) => update({ name: e.currentTarget.value })}
                    />
                  </h1>
                </div>
                <div
                  class="mb-6 mt-3 flex flex-wrap items-center gap-2"
                  aria-label="Company details"
                >
                  <Badge variant="outline" size="sm">
                    <Globe class="size-3" />
                    {props.company.domain}
                  </Badge>
                  <Show when={props.company.lastInteracted}>
                    {(when) => (
                      <Badge variant="outline" size="sm">
                        <Clock class="size-3" />
                        Last interacted {when()}
                      </Badge>
                    )}
                  </Show>
                </div>
                <Show when={props.company.description}>
                  {(text) => <Description text={text()} />}
                </Show>
              </div>
              <Discussion
                comments={props.company.comments}
                onChange={(comments) => update({ comments })}
              />
            </div>
          </div>
        </Show>
        <Show when={props.section === 'team'}>
          <CompanyTeam company={props.company} />
        </Show>
        <Show when={props.section === 'emails'}>
          <CompanyEmails
            emails={emails()}
            onOpen={(email) =>
              props.company.emailIds.includes(email.id)
                ? () => props.onOpenItem('email', email.id)
                : undefined
            }
          />
        </Show>
        <Show when={props.section === 'files'}>
          <RecordSection title="Files">
            <Show
              when={props.company.files?.length}
              fallback={<EmptyList>No files with this company yet.</EmptyList>}
            >
              <div aria-label="Company files">
                <For each={props.company.files}>
                  {(file) => (
                    <RecordRow
                      icon={
                        file.kind === 'pdf' ? (
                          <FilePdf class="size-4 shrink-0 text-pdf" />
                        ) : (
                          <File class="size-4 shrink-0 text-note" />
                        )
                      }
                      title={file.title}
                      label={`${file.title} ${file.time}`}
                      time={file.time}
                      onOpen={
                        file.documentId
                          ? () =>
                              props.onOpenItem(
                                'documents',
                                file.documentId ?? ''
                              )
                          : undefined
                      }
                    />
                  )}
                </For>
              </div>
            </Show>
          </RecordSection>
        </Show>
        <Show when={props.section === 'tasks'}>
          <CompanyTasks company={props.company} />
        </Show>
        <Show when={props.section === 'calls'}>
          <RecordSection title="Calls">
            <Show
              when={props.company.calls?.length}
              fallback={<EmptyList>No calls with this company yet.</EmptyList>}
            >
              <div aria-label="Company calls">
                <For each={props.company.calls}>
                  {(call) => (
                    <RecordRow
                      icon={
                        <PhoneCall class="size-4 shrink-0 text-ink-muted" />
                      }
                      title={call.title}
                      label={`${call.title} ${call.time}`}
                      detail={
                        <>
                          <People people={call.people} guests={call.guests} />
                          <span>{call.duration}</span>
                        </>
                      }
                      time={call.time}
                    />
                  )}
                </For>
              </div>
            </Show>
          </RecordSection>
        </Show>
        <Show when={props.panelOpen}>
          <CompanyPanel company={props.company} update={update} />
        </Show>
      </div>
    </div>
  );
}
