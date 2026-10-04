import { createSignal, For, Show } from 'solid-js';
import { render } from 'solid-js/web';
import type { Presentation, Workspace } from '../context/contracts';
import type {
  Detail,
  Reply,
  Settings,
  SupportMessage,
  Ticket,
} from '../core/types';
import { SupportWorkspace } from '../views/workspace';
import './sample.css';

const user = 'macro|alex@acme.com';
const now = () => new Date().toISOString();
const id = (n: number) =>
  `019bf405-4800-7000-8000-${String(n).padStart(12, '0')}`;
const customers = [
  ['Jamie Chen', 'jamie@linear.app', 'Linear'],
  ['Priya Shah', 'priya@figma.com', 'Figma'],
  ['Sam Rivera', 'sam@vercel.com', 'Vercel'],
  ['Morgan Lee', 'morgan@linear.app', 'Linear'],
  ['Taylor Kim', 'taylor@notion.so', 'Notion'],
  ['Casey Park', 'casey@figma.com', 'Figma'],
];
const subjects = [
  'Webhook retries are failing',
  'How do I invite my team?',
  'SSO setup for our workspace',
  'Invoice missing billing address',
  'Exporting conversation history',
  'Thanks — that fixed it',
];
const previews = [
  'We’re seeing intermittent 502 responses after upgrading.',
  'Is there a way to invite everyone at once?',
  'Could you help us configure our identity provider?',
  'Can you update the address on our latest invoice?',
  'Where can I download the history for a project?',
  'Everything is working now. Appreciate the help!',
];
const [tickets, setTickets] = createSignal<Ticket[]>(
  subjects.map((subject, n) => ({
    id: id(n + 1),
    team_id: id(90),
    channel_id: id(n + 30),
    subject,
    customer: {
      name: customers[n][0],
      email: customers[n][1],
      company_name: customers[n][2],
      company_id: id(70 + n),
      contact_id: id(80 + n),
    },
    status:
      n === 5
        ? 'resolved'
        : n === 3
          ? 'waiting_on_customer'
          : n === 4
            ? 'waiting_on_team'
            : 'open',
    priority: n === 0 ? 'urgent' : n === 2 || n === 3 ? 'high' : 'medium',
    assignee_id: n === 0 ? user : null,
    source: n % 2 === 0 ? 'widget' : 'email',
    agent_paused: false,
    draft:
      n === 0
        ? {
            content:
              'Thanks for flagging this, Jamie. Webhook delivery retries use exponential backoff. Please check that your endpoint responds within 10 seconds.\n\nIf the 502s continue, share the request IDs and we’ll investigate with engineering.',
            confidence: 0.94,
            handoff: false,
          }
        : null,
    preview: previews[n],
    created_at: new Date(Date.now() - (n + 1) * 3600000).toISOString(),
    updated_at: new Date(Date.now() - n * 120000).toISOString(),
  }))
);
const [messages, setMessages] = createSignal<Record<string, SupportMessage[]>>(
  Object.fromEntries(
    tickets().map((t, n) => [
      t.id,
      [
        {
          id: id(n + 100),
          author_kind: 'customer',
          author_name: t.customer.name,
          content: previews[n],
          public: true,
          created_at: t.created_at,
        },
      ],
    ])
  )
);
const [tasks, setTasks] = createSignal<Record<string, Detail['tasks']>>({});
const [selected, select] = createSignal<string>();
const [settings, setSettings] = createSignal<Settings>({
  widget_key: id(99),
  widget_enabled: true,
  allowed_origins: ['https://acme.com', 'http://localhost:4177'],
  name: 'Acme support agent',
  welcome: 'Hi! How can we help?',
  agent_enabled: true,
  response_mode: 'draft',
  delay_minutes: 5,
  confidence_threshold: 0.85,
  system_prompt:
    'Be clear, kind, and specific. Escalate billing changes and production incidents to a human.',
  knowledge:
    'Invite teammates from Settings → Team. Webhooks retry with exponential backoff. Endpoints must respond within 10 seconds.',
  email_link_id: id(60),
  support_email: 'support@acme.com',
});
const [overlay, setOverlay] = createSignal<
  'website' | 'task' | 'crm' | 'channel'
>();
const [openTask, setOpenTask] = createSignal('');
const delay = async () => {
  await new Promise((resolve) => setTimeout(resolve, 80));
};
const workspace: Workspace = {
  tickets,
  selected,
  select,
  settings,
  inboxes: () => [
    { id: id(60), email: 'support@acme.com' },
    { id: id(61), email: 'alex@acme.com' },
  ],
  loading: () => false,
  error: () => undefined,
  hasMore: () => false,
  loadMore: async () => {},
  detail: () => {
    const ticket = tickets().find((t) => t.id === selected());
    return ticket
      ? {
          ticket,
          messages: messages()[ticket.id] ?? [],
          tasks: tasks()[ticket.id] ?? [],
        }
      : undefined;
  },
  create: async (input) => {
    await delay();
    const ticket: Ticket = {
      id: crypto.randomUUID(),
      team_id: id(90),
      channel_id: crypto.randomUUID(),
      subject: input.subject,
      customer: { email: input.email, name: input.name },
      status: 'open',
      priority: 'medium',
      assignee_id: null,
      source: 'manual',
      agent_paused: false,
      draft: null,
      preview: input.content,
      created_at: now(),
      updated_at: now(),
    };
    setTickets((t) => [ticket, ...t]);
    setMessages((m) => ({
      ...m,
      [ticket.id]: [
        {
          id: crypto.randomUUID(),
          author_kind: 'customer',
          author_name: input.name,
          content: input.content,
          public: true,
          created_at: now(),
        },
      ],
    }));
    select(ticket.id);
    return ticket;
  },
  patch: async (id, input) => {
    await delay();
    setTickets((t) =>
      t.map((ticket) =>
        ticket.id === id
          ? {
              ...ticket,
              ...input,
              assignee_id:
                input.assignee_id === ''
                  ? null
                  : (input.assignee_id ?? ticket.assignee_id),
              updated_at: now(),
            }
          : ticket
      )
    );
  },
  reply: async (id, reply) => {
    await delay();
    if (messages()[id]?.some((m) => m.id === reply.id)) return;
    setMessages((m) => ({
      ...m,
      [id]: [
        ...(m[id] ?? []),
        {
          id: reply.id,
          author_kind: 'human',
          author_name: user,
          content: reply.content,
          public: reply.public,
          created_at: now(),
        },
      ],
    }));
    setTickets((t) =>
      t.map((ticket) =>
        ticket.id === id
          ? {
              ...ticket,
              updated_at: now(),
              ...(reply.public
                ? {
                    status: 'waiting_on_customer' as const,
                    draft: null,
                    preview: reply.content,
                  }
                : {}),
            }
          : ticket
      )
    );
  },
  configure: async (value) => {
    await delay();
    setSettings({ ...value });
  },
  linkTask: async (id, input) => {
    await delay();
    const task = {
      id: input.task_id ?? crypto.randomUUID(),
      title: input.title ?? 'Investigate webhook retry handling',
      status: 'not_started',
    };
    setTasks((t) => ({ ...t, [id]: [...(t[id] ?? []), task] }));
    return task;
  },
  unlinkTask: async (id, task) => {
    await delay();
    setTasks((t) => ({
      ...t,
      [id]: (t[id] ?? []).filter((v) => v.id !== task),
    }));
  },
};
const presentation: Presentation = {
  userId: user,
  canConfigure: () => true,
  apiBase: 'http://localhost:4177',
  Markdown: (props) => (
    <div class="sample-markdown">
      <For each={props.content.split('\n')}>
        {(line) => <p>{line.replaceAll('**', '')}</p>}
      </For>
    </div>
  ),
  Editor: (props) => (
    <textarea
      aria-label="Reply composer"
      rows="5"
      value={props.value}
      onInput={(e) => props.onChange(e.currentTarget.value, [])}
    />
  ),
  openTask: (id) => {
    setOpenTask(id);
    setOverlay('task');
  },
  openCompany: () => setOverlay('crm'),
  openChannel: () => setOverlay('channel'),
};
let visitorTicket: string | undefined;
const sample = {
  settings,
  openWidget: async (input: {
    email: string;
    name: string;
    content: string;
    subject: string;
  }) => {
    const ticket = await workspace.create(input);
    visitorTicket = ticket.id;
    setTickets((t) =>
      t.map((v) =>
        v.id === ticket.id
          ? {
              ...v,
              source: 'widget',
              draft: {
                content:
                  'You can invite teammates from Settings → Team. Choose Invite, then enter their email addresses.',
                confidence: 0.97,
                handoff: false,
              },
            }
          : v
      )
    );
    select(undefined);
    return { token: 'a'.repeat(64) };
  },
  publicMessages: () => ({
    messages: (messages()[visitorTicket ?? ''] ?? []).filter((m) => m.public),
  }),
  visitorReply: async (reply: Reply) => {
    if (!visitorTicket) throw new Error('no session');
    setMessages((m) => ({
      ...m,
      [visitorTicket!]: [
        ...(m[visitorTicket!] ?? []),
        {
          id: reply.id,
          author_kind: 'customer',
          author_name: 'Nina Patel',
          content: reply.content,
          public: true,
          created_at: now(),
        },
      ],
    }));
    setTickets((t) =>
      t.map((v) =>
        v.id === visitorTicket ? { ...v, status: 'open', updated_at: now() } : v
      )
    );
  },
};
(window as unknown as { __supportSample: typeof sample }).__supportSample =
  sample;
render(
  () => (
    <div class="sample-shell">
      <nav class="sample-app-nav">
        <div class="sample-brand">
          M<span>macro</span>
        </div>
        <div class="sample-workspace">
          A
          <span>
            Acme workspace<small>Sample workspace</small>
          </span>
        </div>
        <For
          each={[
            'Home',
            'Drive',
            'Email',
            'Chat',
            'Tasks',
            'Calendar',
            'Agents',
            'Customers',
            'Support',
          ]}
        >
          {(label) => (
            <button classList={{ active: label === 'Support' }}>
              <span>
                {label === 'Support'
                  ? '◉'
                  : label === 'Email'
                    ? '✉'
                    : label === 'Tasks'
                      ? '☑'
                      : '▧'}
              </span>
              {label}
            </button>
          )}
        </For>
        <div class="sample-nav-bottom">
          <button onClick={() => setOverlay('website')}>
            ↗ Customer website
          </button>
          <div class="sample-person">
            AL
            <span>
              Alex Lee<small>alex@acme.com</small>
            </span>
          </div>
        </div>
      </nav>
      <div class="sample-app-main">
        <header class="sample-topbar">
          <span>
            Acme workspace <span class="sample-slash">/</span> Support
          </span>
          <span class="sample-demo-label">SAMPLE WORKSPACE</span>
        </header>
        <SupportWorkspace workspace={workspace} presentation={presentation} />
      </div>
      <Show when={overlay()}>
        <div class="sample-overlay">
          <section
            class="sample-preview"
            classList={{ website: overlay() === 'website' }}
          >
            <header>
              <strong>
                {overlay() === 'website'
                  ? 'Customer website · embedded Macro chat'
                  : overlay() === 'task'
                    ? 'Macro Task'
                    : overlay() === 'crm'
                      ? 'CRM company · Linear'
                      : 'Canonical Macro conversation'}
              </strong>
              <button
                aria-label="Close preview"
                onClick={() => setOverlay(undefined)}
              >
                ×
              </button>
            </header>
            <Show
              when={overlay() === 'website'}
              fallback={
                <div class="sample-record">
                  <Show
                    when={overlay() === 'task'}
                    fallback={
                      <>
                        <h1>
                          {overlay() === 'crm'
                            ? 'Linear'
                            : 'Support conversation'}
                        </h1>
                        <p>
                          Customer conversations stay connected to your Macro
                          workspace.
                        </p>
                        <For
                          each={
                            overlay() === 'crm'
                              ? tickets().filter(
                                  (t) => t.customer.company_name === 'Linear'
                                )
                              : tickets().filter((t) => t.id === selected())
                          }
                        >
                          {(t) => (
                            <button
                              onClick={() => {
                                select(t.id);
                                setOverlay(undefined);
                              }}
                            >
                              {t.subject} ↗
                            </button>
                          )}
                        </For>
                      </>
                    }
                  >
                    <h1>
                      {
                        Object.values(tasks())
                          .flat()
                          .find((t) => t.id === openTask())?.title
                      }
                    </h1>
                    <p>Linked from Support · Engineering</p>
                    <label>
                      Task status
                      <select
                        aria-label="Task status"
                        value={
                          Object.values(tasks())
                            .flat()
                            .find((t) => t.id === openTask())?.status
                        }
                        onChange={(e) => {
                          const status = e.currentTarget.value;
                          setTasks((current) =>
                            Object.fromEntries(
                              Object.entries(current).map(([id, items]) => [
                                id,
                                items.map((t) =>
                                  t.id === openTask() ? { ...t, status } : t
                                ),
                              ])
                            )
                          );
                        }}
                      >
                        <option value="not_started">Not started</option>
                        <option value="in_progress">In progress</option>
                        <option value="completed">Completed</option>
                      </select>
                    </label>
                    <p>
                      Ticket status: {workspace.detail()?.ticket.status}. Tasks
                      and tickets have independent lifecycles.
                    </p>
                  </Show>
                </div>
              }
            >
              <iframe
                title="Customer website"
                src="/src/features/support/browser-test/website.html"
              />
            </Show>
          </section>
        </div>
      </Show>
    </div>
  ),
  document.getElementById('root')!
);
