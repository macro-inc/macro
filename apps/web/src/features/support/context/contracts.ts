import type { Accessor, Component } from 'solid-js';
import type {
  Detail,
  Inbox,
  LinkedTask,
  NewTicket,
  Reply,
  Settings,
  TaskInput,
  Ticket,
  TicketPatch,
} from '../core/types';
export type Workspace = {
  tickets: Accessor<Ticket[]>;
  detail: Accessor<Detail | undefined>;
  settings: Accessor<Settings | undefined>;
  inboxes: Accessor<Inbox[]>;
  selected: Accessor<string | undefined>;
  select: (id: string | undefined) => void;
  loading: Accessor<boolean>;
  error: Accessor<string | undefined>;
  loadMore: () => Promise<void>;
  hasMore: Accessor<boolean>;
  create: (input: NewTicket) => Promise<Ticket>;
  patch: (id: string, input: TicketPatch) => Promise<void>;
  reply: (id: string, input: Reply) => Promise<void>;
  configure: (settings: Settings) => Promise<void>;
  linkTask: (id: string, input: TaskInput) => Promise<LinkedTask>;
  unlinkTask: (id: string, task: string) => Promise<void>;
};
export type Presentation = {
  Markdown: Component<{ content: string }>;
  Editor: Component<{
    value: string;
    onChange: (value: string, mentions: unknown[]) => void;
  }>;
  userId: string;
  canConfigure: Accessor<boolean>;
  apiBase: string;
  openTask: (id: string) => void;
  openChannel: (id: string) => void;
  openCompany: (id: string) => void;
};
