import { homepagePeople } from './homepage-demo-people';

export type DemoMention = {
  id: string;
  label: string;
  kind: 'person' | 'document' | 'task' | 'agent' | 'channel' | 'spreadsheet';
  photo?: string;
  shortName?: string;
  detail?: string;
  status?: 'Not Started' | 'In Progress' | 'In Review';
};

/** The same fictional reference set is available in every writable demo. */
export const demoMentions: DemoMention[] = [
  ...(['julia', 'teo', 'jacob', 'valentina', 'gabriel', 'macro'] as const).map(
    (id) => ({
      id,
      label: homepagePeople[id].name,
      kind: 'person' as const,
      photo: homepagePeople[id].photo,
      shortName: homepagePeople[id].shortName,
    })
  ),
  { id: 'plan', label: 'Q3 launch plan', kind: 'document' },
  {
    id: 'announcement',
    label: 'Write the launch announcement',
    kind: 'task',
    status: 'In Review',
  },
  { id: 'cursor', label: 'Cursor', kind: 'agent' },
  { id: 'rollout', label: 'Team rollout plan', kind: 'document' },
  {
    id: 'checklist',
    label: 'Prepare the launch checklist',
    kind: 'task',
    status: 'Not Started',
  },
  { id: 'claude', label: 'Claude', kind: 'agent' },
  { id: 'notes', label: 'Demo call notes', kind: 'document' },
  {
    id: 'deploy',
    label: 'Fix the deploy pipeline',
    kind: 'task',
    status: 'In Progress',
  },
  { id: 'customers', label: 'Customers to reach', kind: 'spreadsheet' },
  { id: 'metrics', label: 'Launch metrics', kind: 'spreadsheet' },
  { id: 'launch', label: 'launch', kind: 'channel' },
  { id: 'engineers', label: 'engineers', kind: 'channel' },
  { id: 'product', label: 'product', kind: 'channel' },
];

export function mentionAtCaret(text: string, caret: number) {
  const before = text.slice(0, caret);
  const match = /(?:^|[\s(])@([^@\n]{0,64})$/.exec(before);
  if (!match) return undefined;
  return { start: caret - match[1].length - 1, end: caret, query: match[1] };
}

/** Names for task titles and other plain-text surfaces built from a message. */
export function plainDemoMentions(text: string) {
  return text.replace(/@\[([^\]]*)\]\(demo-mention:[\w-]+\)/g, '$1');
}
