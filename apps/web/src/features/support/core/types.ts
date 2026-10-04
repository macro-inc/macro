export type TicketStatus =
  | 'open'
  | 'in_progress'
  | 'waiting_on_customer'
  | 'waiting_on_team'
  | 'resolved';
export type Priority = 'urgent' | 'high' | 'medium' | 'low';
export type ResponseMode = 'draft' | 'automatic' | 'delayed' | 'confident';
export type Customer = {
  email: string;
  name: string;
  contact_id?: string | null;
  company_id?: string | null;
  company_name?: string | null;
};
export type AgentAnswer = {
  content: string;
  confidence: number;
  handoff: boolean;
};
export type Ticket = {
  id: string;
  team_id: string;
  channel_id: string;
  subject: string;
  customer: Customer;
  status: TicketStatus;
  priority: Priority;
  assignee_id: string | null;
  source: 'widget' | 'email' | 'manual';
  agent_paused: boolean;
  draft: AgentAnswer | null;
  preview: string;
  created_at: string;
  updated_at: string;
};
export type SupportMessage = {
  id: string;
  author_kind: 'customer' | 'human' | 'agent';
  author_name: string;
  content: string;
  public: boolean;
  created_at: string;
};
export type LinkedTask = { id: string; title: string; status: string };
export type Detail = {
  ticket: Ticket;
  messages: SupportMessage[];
  tasks: LinkedTask[];
};
export type Settings = {
  widget_key: string;
  widget_enabled: boolean;
  allowed_origins: string[];
  name: string;
  welcome: string;
  agent_enabled: boolean;
  response_mode: ResponseMode;
  delay_minutes: number;
  confidence_threshold: number;
  system_prompt: string;
  knowledge: string;
  email_link_id: string | null;
  support_email: string | null;
};
export type Inbox = { id: string; email: string };
export type NewTicket = {
  subject: string;
  email: string;
  name: string;
  content: string;
};
export type Reply = {
  id: string;
  content: string;
  public: boolean;
  mentions: unknown[];
};
export type TicketPatch = Partial<
  Pick<Ticket, 'status' | 'priority' | 'assignee_id' | 'agent_paused'>
>;
export type TaskInput = {
  task_id?: string;
  title?: string;
  description?: string;
};
export type TicketFilter = {
  company_id?: string;
  contact_id?: string;
  before?: string;
  before_id?: string;
};
export const statusLabels: Record<TicketStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  waiting_on_customer: 'Waiting on customer',
  waiting_on_team: 'Waiting on team',
  resolved: 'Resolved',
};
export const queues = [
  { id: 'open', label: 'Open tickets' },
  { id: 'mine', label: 'Assigned to me' },
  { id: 'unassigned', label: 'Unassigned' },
  { id: 'high', label: 'High priority' },
  { id: 'recent', label: 'Recent activity' },
  { id: 'resolved', label: 'Resolved' },
  { id: 'all', label: 'All tickets' },
] as const;
export type Queue = (typeof queues)[number]['id'];
export function filterTickets(
  tickets: Ticket[],
  queue: Queue,
  search: string,
  user: string
): Ticket[] {
  const query = search.toLowerCase().trim();
  return tickets
    .filter((t) => {
      if (queue === 'resolved' && t.status !== 'resolved') return false;
      if (
        !['resolved', 'all', 'recent'].includes(queue) &&
        t.status === 'resolved'
      )
        return false;
      if (queue === 'mine' && t.assignee_id !== user) return false;
      if (queue === 'unassigned' && t.assignee_id) return false;
      if (queue === 'high' && !['high', 'urgent'].includes(t.priority))
        return false;
      return (
        !query ||
        [
          t.subject,
          t.customer.name,
          t.customer.email,
          t.customer.company_name ?? '',
          t.preview,
        ]
          .join(' ')
          .toLowerCase()
          .includes(query)
      );
    })
    .sort(
      (a, b) =>
        b.updated_at.localeCompare(a.updated_at) || b.id.localeCompare(a.id)
    );
}
