import { createMemo, createSignal, For, Show } from 'solid-js';
import type { Presentation, Workspace } from '../context/contracts';
import {
  filterTickets,
  type Priority,
  type Queue,
  queues,
  type ResponseMode,
  type Settings,
  statusLabels,
  type TicketStatus,
} from '../core/types';
import './support.css';

const modes: { id: ResponseMode; name: string; description: string }[] = [
  {
    id: 'draft',
    name: 'Draft for review',
    description: 'Prepare suggestions. A teammate decides what to send.',
  },
  {
    id: 'automatic',
    name: 'Respond immediately',
    description: 'Send grounded answers as soon as a customer writes.',
  },
  {
    id: 'delayed',
    name: 'Give humans time',
    description:
      'Respond if a teammate has not replied within your time window.',
  },
  {
    id: 'confident',
    name: 'Only when confident',
    description:
      'Answer when confidence meets your threshold; otherwise draft.',
  },
];
function uuid7() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let time = Date.now();
  for (let i = 5; i >= 0; i--) {
    bytes[i] = time % 256;
    time = Math.floor(time / 256);
  }
  bytes[6] = (bytes[6] & 15) | 112;
  bytes[8] = (bytes[8] & 63) | 128;
  const h = Array.from(bytes, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
function initials(name: string) {
  return name
    .split(/[ @]/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0])
    .join('')
    .toUpperCase();
}
export function SupportWorkspace(props: {
  workspace: Workspace;
  presentation: Presentation;
}) {
  const w = props.workspace;
  const p = props.presentation;
  const [section, setSection] = createSignal<'inbox' | 'agent' | 'channels'>(
    'inbox'
  );
  const [queue, setQueue] = createSignal<Queue>('open');
  const [search, setSearch] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [feedback, setFeedback] = createSignal('');
  const [error, setError] = createSignal('');
  const [modal, setModal] = createSignal<'ticket' | 'task' | undefined>();
  const tickets = createMemo(() =>
    filterTickets(w.tickets(), queue(), search(), p.userId)
  );
  async function run(action: () => Promise<unknown>, success = '') {
    if (busy()) return;
    setBusy(true);
    setError('');
    setFeedback('');
    try {
      await action();
      setFeedback(success);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Could not save. Please try again.'
      );
    } finally {
      setBusy(false);
    }
  }
  const choose = (id: Queue) => {
    setQueue(id);
    setSection('inbox');
    w.select(undefined);
  };
  return (
    <div class="support-workspace">
      <aside class="support-nav">
        <div class="support-title">
          <span class="support-logo">◉</span>
          <strong>Support</strong>
        </div>
        <button class="support-agent-card" onClick={() => setSection('agent')}>
          <span class="support-agent-avatar">✦</span>
          <span>
            <strong>{w.settings()?.name ?? 'Support agent'}</strong>
            <small>
              <i classList={{ 'is-on': w.settings()?.agent_enabled }} />
              {w.settings()?.agent_enabled
                ? 'Agent enabled'
                : 'Human review by default'}
            </small>
          </span>
          <span>›</span>
        </button>
        <div class="support-nav-label">WORKSPACE</div>
        <For each={queues}>
          {(item) => (
            <button
              class="support-nav-item"
              classList={{
                active: section() === 'inbox' && queue() === item.id,
              }}
              onClick={() => choose(item.id)}
            >
              <span class="support-nav-symbol">
                {item.id === 'high'
                  ? '⚑'
                  : item.id === 'mine'
                    ? '◎'
                    : item.id === 'resolved'
                      ? '✓'
                      : '▤'}
              </span>
              {item.label}
              <span class="support-count">
                {filterTickets(w.tickets(), item.id, '', p.userId).length}
              </span>
            </button>
          )}
        </For>
        <div class="support-nav-bottom">
          <div class="support-nav-label">MANAGE</div>
          <button
            class="support-nav-item"
            classList={{ active: section() === 'agent' }}
            onClick={() => setSection('agent')}
          >
            ✦<span>Support agent</span>
          </button>
          <button
            class="support-nav-item"
            classList={{ active: section() === 'channels' }}
            onClick={() => setSection('channels')}
          >
            ⌘<span>Channels & installation</span>
          </button>
          <div class="support-team-note">
            One shared inbox.
            <br />
            Every customer, in context.
          </div>
        </div>
      </aside>
      <main class="support-main">
        <Show when={error() || w.error()}>
          <div class="support-banner error" role="alert">
            {error() || w.error()}
          </div>
        </Show>
        <Show when={feedback()}>
          <div class="support-banner" role="status">
            {feedback()}
          </div>
        </Show>
        <Show when={section() === 'inbox'}>
          <Show
            when={w.selected()}
            fallback={
              <>
                <header class="support-header">
                  <div>
                    <div class="support-eyebrow">CUSTOMER OPERATIONS</div>
                    <h1>{queues.find((q) => q.id === queue())?.label}</h1>
                    <p>A clear view of every conversation and next step.</p>
                  </div>
                  <button
                    class="support-primary"
                    onClick={() => setModal('ticket')}
                  >
                    ＋ New ticket
                  </button>
                </header>
                <div class="support-metrics">
                  <div>
                    <small>Open tickets</small>
                    <strong>
                      {filterTickets(w.tickets(), 'open', '', p.userId).length}
                    </strong>
                    <span>Across email and website chat</span>
                  </div>
                  <div>
                    <small>High priority</small>
                    <strong>
                      {filterTickets(w.tickets(), 'high', '', p.userId).length}
                    </strong>
                    <span>Needs your team's attention</span>
                  </div>
                  <div>
                    <small>Ready for review</small>
                    <strong>{w.tickets().filter((t) => t.draft).length}</strong>
                    <span>Suggestions from your agent</span>
                  </div>
                </div>
                <div class="support-list-toolbar">
                  <label class="support-search">
                    ⌕
                    <input
                      aria-label="Search tickets"
                      placeholder="Search tickets, customers, companies…"
                      value={search()}
                      onInput={(e) => setSearch(e.currentTarget.value)}
                    />
                  </label>
                  <span>{tickets().length} tickets</span>
                </div>
                <div class="support-list-heading">
                  <span>Conversation</span>
                  <span>Customer</span>
                  <span>Status</span>
                  <span>Priority</span>
                </div>
                <Show
                  when={!w.loading()}
                  fallback={<div class="support-empty">Loading Support…</div>}
                >
                  <For
                    each={tickets()}
                    fallback={
                      <div class="support-empty">
                        No tickets here yet. Start a conversation or connect
                        your channels.
                      </div>
                    }
                  >
                    {(ticket) => (
                      <button
                        class="support-ticket-row"
                        onClick={() => w.select(ticket.id)}
                      >
                        <div class="support-ticket-subject">
                          <span class="support-source">
                            {ticket.source === 'email' ? '✉' : '◌'}
                          </span>
                          <span>
                            <strong>{ticket.subject}</strong>
                            <small>
                              {ticket.draft
                                ? '✦ Agent suggestion ready · '
                                : ''}
                              {ticket.preview.slice(0, 90)}
                            </small>
                          </span>
                        </div>
                        <div class="support-customer-cell">
                          <span class="support-avatar">
                            {initials(ticket.customer.name)}
                          </span>
                          <span>
                            <strong>{ticket.customer.name}</strong>
                            <small>
                              {ticket.customer.company_name ??
                                ticket.customer.email.split('@')[1]}
                            </small>
                          </span>
                        </div>
                        <span class={`support-status ${ticket.status}`}>
                          {statusLabels[ticket.status]}
                        </span>
                        <span class={`support-priority ${ticket.priority}`}>
                          ● {ticket.priority}
                        </span>
                      </button>
                    )}
                  </For>
                </Show>
                <Show when={w.hasMore()}>
                  <button
                    class="support-secondary"
                    disabled={busy()}
                    onClick={() => run(w.loadMore)}
                  >
                    Load more tickets
                  </button>
                </Show>
              </>
            }
          >
            <Show
              when={w.detail()?.ticket.id}
              keyed
              fallback={<div class="support-empty">Loading conversation…</div>}
            >
              {(_key) => (
                <TicketConversation
                  detail={() => w.detail()!}
                  workspace={w}
                  presentation={p}
                  busy={busy}
                  run={run}
                  back={() => w.select(undefined)}
                  addTask={() => setModal('task')}
                />
              )}
            </Show>
          </Show>
        </Show>
        <Show when={section() !== 'inbox'}>
          <Show
            when={w.settings()}
            keyed
            fallback={<div class="support-empty">Loading configuration…</div>}
          >
            {(settings) => (
              <SettingsForm
                initial={settings}
                section={section()}
                presentation={p}
                workspace={w}
                busy={busy}
                run={run}
              />
            )}
          </Show>
        </Show>
      </main>
      <Show when={modal()}>
        <div
          class="support-modal-scrim"
          onClick={(e) => {
            if (e.target === e.currentTarget && !busy()) setModal(undefined);
          }}
        >
          <div
            class="support-modal"
            role="dialog"
            aria-modal="true"
            aria-label={modal() === 'ticket' ? 'New ticket' : 'Link a Task'}
          >
            <button
              class="support-modal-close"
              aria-label="Close dialog"
              disabled={busy()}
              onClick={() => setModal(undefined)}
            >
              ×
            </button>
            <Show
              when={modal() === 'ticket'}
              fallback={
                <TaskForm
                  busy={busy}
                  submit={(value) =>
                    run(async () => {
                      await w.linkTask(w.selected()!, value);
                      setModal(undefined);
                    }, 'Task linked')
                  }
                />
              }
            >
              <NewTicketForm
                busy={busy}
                submit={(value) =>
                  run(async () => {
                    await w.create(value);
                    setModal(undefined);
                  }, 'Ticket created')
                }
              />
            </Show>
          </div>
        </div>
      </Show>
    </div>
  );
}
type Run = (action: () => Promise<unknown>, success?: string) => Promise<void>;
function TicketConversation(props: {
  detail: () => import('../core/types').Detail;
  workspace: Workspace;
  presentation: Presentation;
  busy: () => boolean;
  run: Run;
  back: () => void;
  addTask: () => void;
}) {
  const w = props.workspace,
    p = props.presentation;
  const ticket = () => props.detail().ticket;
  const [content, setContent] = createSignal('');
  const [mentions, setMentions] = createSignal<unknown[]>([]);
  const [internal, setInternal] = createSignal(ticket().source === 'manual');
  const [editorKey, setEditorKey] = createSignal(0);
  let pending: import('../core/types').Reply | undefined;
  const update = (patch: import('../core/types').TicketPatch) =>
    props.run(() => w.patch(ticket().id, patch));
  const send = () =>
    props.run(
      async () => {
        const next = {
          content: content(),
          public: !internal(),
          mentions: mentions(),
        };
        if (
          !pending ||
          pending.content !== next.content ||
          pending.public !== next.public
        )
          pending = { id: uuid7(), ...next };
        const sent = pending;
        await w.reply(ticket().id, sent);
        pending = undefined;
        if (content() === sent.content && internal() === !sent.public) {
          setContent('');
          setMentions([]);
          setEditorKey((n) => n + 1);
        }
      },
      internal() ? 'Internal note added' : 'Reply sent'
    );
  const suggestion = () => {
    setContent(ticket().draft!.content);
    setInternal(ticket().source === 'manual');
    setMentions([]);
    setEditorKey((n) => n + 1);
  };
  return (
    <div class="support-detail">
      <header class="support-detail-header">
        <button class="support-back" onClick={props.back}>
          ‹ Inbox
        </button>
        <span class="support-status">
          {ticket().source === 'email'
            ? '✉ Email'
            : ticket().source === 'manual'
              ? 'Tracking'
              : '◌ Chat'}
        </span>
        <button
          class="support-secondary"
          disabled={props.busy()}
          onClick={() =>
            update({
              status: ticket().status === 'resolved' ? 'open' : 'resolved',
            })
          }
        >
          {ticket().status === 'resolved'
            ? 'Reopen ticket'
            : '✓ Resolve ticket'}
        </button>
      </header>
      <div class="support-detail-columns">
        <section class="support-conversation">
          <div class="support-conversation-heading">
            <h1>{ticket().subject}</h1>
            <p>
              {ticket().customer.name} · {ticket().customer.email}
            </p>
          </div>
          <Show when={ticket().source === 'manual'}>
            <p class="support-explainer">
              Tracking ticket · add internal notes here. Customer replies are
              available on email and website conversations.
            </p>
          </Show>
          <div class="support-message-list">
            <For each={props.detail().messages}>
              {(message) => (
                <article
                  class="support-message"
                  classList={{ 'internal-note': !message.public }}
                >
                  <span class="support-avatar">
                    {message.author_kind === 'agent'
                      ? '✦'
                      : initials(message.author_name)}
                  </span>
                  <div>
                    <header>
                      <strong>
                        {message.author_kind === 'human'
                          ? 'Teammate'
                          : message.author_name}
                      </strong>
                      <span>
                        {message.public ? '' : 'Internal note · '}
                        {new Date(message.created_at).toLocaleTimeString([], {
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                      </span>
                    </header>
                    <p.Markdown content={message.content} />
                  </div>
                </article>
              )}
            </For>
          </div>
          <Show when={ticket().draft}>
            <div class="support-agent-draft">
              <header>
                <strong>✦ Suggested reply</strong>
                <span>
                  {Math.round((ticket().draft?.confidence ?? 0) * 100)}%
                  confidence
                </span>
              </header>
              <p.Markdown content={ticket().draft!.content} />
              <button
                class="support-secondary"
                disabled={props.busy()}
                onClick={suggestion}
              >
                Use suggestion
              </button>
              <small>
                Review before sending.{' '}
                {ticket().draft?.handoff ? 'Human help recommended.' : ''}
              </small>
            </div>
          </Show>
          <div class="support-composer">
            <div class="support-composer-tabs">
              <button
                classList={{ active: !internal() }}
                disabled={ticket().source === 'manual'}
                onClick={() => setInternal(false)}
              >
                Reply to customer
              </button>
              <button
                classList={{ active: internal() }}
                onClick={() => setInternal(true)}
              >
                Internal note
              </button>
            </div>
            <Show when={editorKey() + 1} keyed>
              {(_key) => (
                <p.Editor
                  value={content()}
                  onChange={(value, refs) => {
                    setContent(value);
                    setMentions(refs);
                  }}
                />
              )}
            </Show>
            <footer>
              <span>
                {internal()
                  ? 'Only your team can see this note'
                  : 'Markdown supported · @ mention to reference Macro items'}
              </span>
              <button
                class="support-primary"
                disabled={props.busy() || !content().trim()}
                onClick={send}
              >
                {internal() ? 'Add note' : 'Send reply'} ↗
              </button>
            </footer>
          </div>
        </section>
        <aside class="support-ticket-sidebar">
          <div class="support-nav-label">TICKET DETAILS</div>
          <label>
            Status
            <select
              aria-label="Ticket status"
              value={ticket().status}
              disabled={props.busy()}
              onChange={(e) =>
                update({ status: e.currentTarget.value as TicketStatus })
              }
            >
              <For each={Object.entries(statusLabels)}>
                {([value, label]) => <option value={value}>{label}</option>}
              </For>
            </select>
          </label>
          <label>
            Priority
            <select
              aria-label="Ticket priority"
              value={ticket().priority}
              disabled={props.busy()}
              onChange={(e) =>
                update({ priority: e.currentTarget.value as Priority })
              }
            >
              <For each={['urgent', 'high', 'medium', 'low']}>
                {(value) => (
                  <option value={value}>
                    {value[0].toUpperCase() + value.slice(1)}
                  </option>
                )}
              </For>
            </select>
          </label>
          <label>
            Assignee
            <span>
              {ticket().assignee_id
                ? ticket().assignee_id?.split('|')[1]
                : 'Unassigned'}
            </span>
          </label>
          <div class="support-inline-actions">
            <button
              disabled={props.busy()}
              onClick={() => update({ assignee_id: p.userId })}
            >
              Assign to me
            </button>
            <Show when={ticket().assignee_id}>
              <button
                disabled={props.busy()}
                onClick={() => update({ assignee_id: '' })}
              >
                Unassign
              </button>
            </Show>
          </div>
          <div class="support-divider" />
          <div class="support-nav-label">CUSTOMER CONTEXT</div>
          <strong>
            {ticket().customer.company_name ??
              ticket().customer.email.split('@')[1]}
          </strong>
          <small>{ticket().customer.name}</small>
          <Show when={ticket().customer.company_id}>
            <button
              class="support-text-button"
              onClick={() => p.openCompany(ticket().customer.company_id!)}
            >
              Open CRM company ↗
            </button>
          </Show>
          <button
            class="support-text-button"
            onClick={() => p.openChannel(ticket().channel_id)}
          >
            Conversation & references ↗
          </button>
          <div class="support-divider" />
          <div class="support-sidebar-heading">
            <div class="support-nav-label">LINKED TASKS</div>
            <button aria-label="Link a Task" onClick={props.addTask}>
              ＋
            </button>
          </div>
          <p class="support-explainer">
            Track engineering and follow-up work. Task completion leaves this
            ticket open.
          </p>
          <For
            each={props.detail().tasks}
            fallback={<small>No linked Tasks yet.</small>}
          >
            {(task) => (
              <div class="support-linked-task">
                <button onClick={() => p.openTask(task.id)}>
                  <strong>☑ {task.title}</strong>
                  <small>{task.status.replaceAll('_', ' ')}</small>
                </button>
                <button
                  aria-label={`Unlink ${task.title}`}
                  disabled={props.busy()}
                  onClick={() =>
                    props.run(() => w.unlinkTask(ticket().id, task.id))
                  }
                >
                  ×
                </button>
              </div>
            )}
          </For>
          <button class="support-secondary" onClick={props.addTask}>
            Create or link Task
          </button>
          <div class="support-divider" />
          <div class="support-nav-label">SUPPORT AGENT</div>
          <label class="support-toggle">
            <input
              type="checkbox"
              checked={!ticket().agent_paused}
              disabled={props.busy()}
              onChange={(e) =>
                update({ agent_paused: !e.currentTarget.checked })
              }
            />
            <span>
              {ticket().agent_paused
                ? 'Paused for this ticket'
                : 'Enabled for this ticket'}
            </span>
          </label>
        </aside>
      </div>
    </div>
  );
}
function SettingsForm(props: {
  initial: Settings;
  section: string;
  presentation: Presentation;
  workspace: Workspace;
  busy: () => boolean;
  run: Run;
}) {
  const [settings, setSettings] = createSignal<Settings>({
    ...props.initial,
    allowed_origins: [...props.initial.allowed_origins],
  });
  const update = (patch: Partial<Settings>) =>
    setSettings((value) => ({ ...value, ...patch }));
  const [copied, setCopied] = createSignal(false);
  const snippet = () =>
    `<script src="${props.presentation.apiBase}/support/widget.js" data-macro-support="${settings().widget_key}" async></script>`;
  const save = () =>
    props.run(
      () => props.workspace.configure(settings()),
      'Support settings saved'
    );
  return (
    <div class="support-settings">
      <header class="support-header">
        <div>
          <div class="support-eyebrow">WORKSPACE SETTINGS</div>
          <h1>
            {props.section === 'agent'
              ? 'Support agent'
              : 'Channels & installation'}
          </h1>
          <p>
            {props.section === 'agent'
              ? 'An extra teammate, with the controls your team needs.'
              : 'Let customers reach your team from your website or inbox.'}
          </p>
        </div>
        <button
          class="support-primary"
          disabled={props.busy() || !props.presentation.canConfigure()}
          onClick={save}
        >
          Save settings
        </button>
      </header>
      <Show when={!props.presentation.canConfigure()}>
        <div class="support-banner">
          Only team admins can change Support configuration.
        </div>
      </Show>
      <fieldset disabled={!props.presentation.canConfigure() || props.busy()}>
        <Show when={props.section === 'agent'}>
          <section class="support-settings-card">
            <div class="support-settings-card-heading">
              <span class="support-agent-avatar">✦</span>
              <div>
                <h2>Your Support agent</h2>
                <p>Grounded in the public knowledge you provide.</p>
              </div>
              <label class="support-toggle">
                <input
                  aria-label="Enable support agent"
                  type="checkbox"
                  checked={settings().agent_enabled}
                  onChange={(e) =>
                    update({ agent_enabled: e.currentTarget.checked })
                  }
                />
                Enabled
              </label>
            </div>
            <label>
              Agent name
              <input
                value={settings().name}
                maxlength="100"
                onInput={(e) => update({ name: e.currentTarget.value })}
              />
            </label>
            <label>
              System prompt
              <textarea
                aria-label="System prompt"
                rows="4"
                maxlength="16000"
                value={settings().system_prompt}
                onInput={(e) =>
                  update({ system_prompt: e.currentTarget.value })
                }
              />
              <small>
                Define tone, helpful behaviors, and when to hand off.
              </small>
            </label>
            <label>
              Public knowledge
              <textarea
                aria-label="Public knowledge"
                rows="5"
                maxlength="100000"
                value={settings().knowledge}
                placeholder="Add approved product documentation, FAQs, and support policies…"
                onInput={(e) => update({ knowledge: e.currentTarget.value })}
              />
              <small>Only add information you want customers to receive.</small>
            </label>
          </section>
          <section class="support-settings-card">
            <h2>When should the agent respond?</h2>
            <p>
              Your agent drafts when it needs human help or has low confidence.
            </p>
            <div class="support-mode-grid">
              <For each={modes}>
                {(mode) => (
                  <label
                    class="support-mode-card"
                    classList={{
                      selected: settings().response_mode === mode.id,
                    }}
                  >
                    <input
                      type="radio"
                      name="responseMode"
                      checked={settings().response_mode === mode.id}
                      onChange={() => update({ response_mode: mode.id })}
                    />
                    <strong>{mode.name}</strong>
                    <span>{mode.description}</span>
                  </label>
                )}
              </For>
            </div>
            <Show when={settings().response_mode === 'delayed'}>
              <label class="support-number-field">
                Human response window
                <div>
                  <input
                    aria-label="Human response window"
                    type="number"
                    min="1"
                    max="60"
                    value={settings().delay_minutes}
                    onInput={(e) =>
                      update({ delay_minutes: Number(e.currentTarget.value) })
                    }
                  />{' '}
                  minutes
                </div>
              </label>
            </Show>
            <label>
              Minimum answer confidence{' '}
              <strong>
                {Math.round(settings().confidence_threshold * 100)}%
              </strong>
              <input
                aria-label="Minimum answer confidence"
                type="range"
                min="50"
                max="100"
                value={settings().confidence_threshold * 100}
                onInput={(e) =>
                  update({
                    confidence_threshold: Number(e.currentTarget.value) / 100,
                  })
                }
              />
              <small>
                Agent confidence is an estimate. Start with human review while
                tuning your public knowledge.
              </small>
            </label>
          </section>
        </Show>
        <Show when={props.section === 'channels'}>
          <section class="support-settings-card">
            <div class="support-settings-card-heading">
              <div>
                <h2>◌ Website chat</h2>
                <p>
                  A lightweight chat widget connected to your Support inbox.
                </p>
              </div>
              <label class="support-toggle">
                <input
                  aria-label="Enable website chat"
                  type="checkbox"
                  checked={settings().widget_enabled}
                  onChange={(e) =>
                    update({ widget_enabled: e.currentTarget.checked })
                  }
                />
                Enabled
              </label>
            </div>
            <label>
              Welcome message
              <input
                aria-label="Welcome message"
                value={settings().welcome}
                onInput={(e) => update({ welcome: e.currentTarget.value })}
              />
            </label>
            <label>
              Allowed website origins
              <textarea
                aria-label="Allowed website origins"
                rows="3"
                value={settings().allowed_origins.join('\n')}
                placeholder="https://yourcompany.com"
                onInput={(e) =>
                  update({
                    allowed_origins: e.currentTarget.value
                      .split('\n')
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
              />
              <small>
                One exact HTTPS origin per line. Localhost may use HTTP.
              </small>
            </label>
            <label>
              Embed code<code class="support-embed">{snippet()}</code>
            </label>
            <button
              type="button"
              class="support-secondary"
              onClick={() =>
                props.run(async () => {
                  await navigator.clipboard.writeText(snippet());
                  setCopied(true);
                })
              }
            >
              {copied() ? '✓ Copied' : 'Copy embed code'}
            </button>
          </section>
          <section class="support-settings-card">
            <h2>✉ Support email</h2>
            <p>
              Connect an existing Macro inbox. Messages sent to your support
              address become tickets; replies stay in the original email thread.
            </p>
            <label>
              Connected inbox
              <select
                aria-label="Connected inbox"
                value={settings().email_link_id ?? ''}
                onChange={(e) => {
                  const inbox = props.workspace
                    .inboxes()
                    .find((i) => i.id === e.currentTarget.value);
                  update({
                    email_link_id: inbox?.id ?? null,
                    support_email: inbox?.email ?? null,
                  });
                }}
              >
                <option value="">Choose an inbox…</option>
                <For each={props.workspace.inboxes()}>
                  {(inbox) => <option value={inbox.id}>{inbox.email}</option>}
                </For>
              </select>
            </label>
            <Show when={settings().email_link_id}>
              <label>
                Support address or receiving alias
                <input
                  aria-label="Support email address"
                  type="email"
                  value={settings().support_email ?? ''}
                  onInput={(e) =>
                    update({ support_email: e.currentTarget.value })
                  }
                />
                <small>
                  This address must deliver to the connected inbox. New intake
                  begins when you save.
                </small>
              </label>
            </Show>
            <Show when={!props.workspace.inboxes().length}>
              <p>
                Connect an email account in Macro settings to enable email
                Support.
              </p>
            </Show>
          </section>
        </Show>
      </fieldset>
    </div>
  );
}
function NewTicketForm(props: {
  busy: () => boolean;
  submit: (value: import('../core/types').NewTicket) => Promise<void>;
}) {
  const [value, setValue] = createSignal({
    subject: '',
    name: '',
    email: '',
    content: '',
  });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        props.submit(value());
      }}
    >
      <div class="support-eyebrow">START A CONVERSATION</div>
      <h2>New ticket</h2>
      <p>
        Create a tracking ticket with a customer summary. Email and website
        conversations automatically create tickets you can reply to.
      </p>
      <For each={['subject', 'name', 'email', 'content'] as const}>
        {(key) => (
          <label>
            {key === 'name'
              ? 'Customer name'
              : key === 'email'
                ? 'Customer email'
                : key === 'content'
                  ? 'Message'
                  : 'Subject'}
            <Show
              when={key === 'content'}
              fallback={
                <input
                  required
                  type={key === 'email' ? 'email' : 'text'}
                  value={value()[key]}
                  onInput={(e) =>
                    setValue((v) => ({ ...v, [key]: e.currentTarget.value }))
                  }
                />
              }
            >
              <textarea
                required
                rows="4"
                value={value()[key]}
                onInput={(e) =>
                  setValue((v) => ({ ...v, [key]: e.currentTarget.value }))
                }
              />
            </Show>
          </label>
        )}
      </For>
      <button class="support-primary" disabled={props.busy()}>
        Create ticket
      </button>
    </form>
  );
}
function TaskForm(props: {
  busy: () => boolean;
  submit: (value: import('../core/types').TaskInput) => Promise<void>;
}) {
  const [existing, setExisting] = createSignal(false);
  const [title, setTitle] = createSignal('');
  const [description, setDescription] = createSignal('');
  const [id, setId] = createSignal('');
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        props.submit(
          existing()
            ? { task_id: id() }
            : { title: title(), description: description() }
        );
      }}
    >
      <div class="support-eyebrow">FOLLOW-THROUGH</div>
      <h2>Create or link a Task</h2>
      <p>Keep the customer ticket and the work it needs connected.</p>
      <div class="support-composer-tabs">
        <button
          type="button"
          classList={{ active: !existing() }}
          onClick={() => setExisting(false)}
        >
          Create Task
        </button>
        <button
          type="button"
          classList={{ active: existing() }}
          onClick={() => setExisting(true)}
        >
          Link existing
        </button>
      </div>
      <Show
        when={existing()}
        fallback={
          <>
            <label>
              Task title
              <input
                required
                value={title()}
                onInput={(e) => setTitle(e.currentTarget.value)}
              />
            </label>
            <label>
              Description
              <textarea
                rows="4"
                value={description()}
                onInput={(e) => setDescription(e.currentTarget.value)}
              />
            </label>
          </>
        }
      >
        <label>
          Task document ID
          <input
            required
            value={id()}
            onInput={(e) => setId(e.currentTarget.value)}
            placeholder="Paste the ID of a team-shared Task"
          />
        </label>
      </Show>
      <button class="support-primary" disabled={props.busy()}>
        {existing() ? 'Link Task' : 'Create Task'}
      </button>
    </form>
  );
}
