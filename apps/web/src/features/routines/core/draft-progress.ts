import type { DraftJobProgress } from '@service-scheduled-action/generated/schemas';
import { match } from 'ts-pattern';

/** Where a milestone is: passed, under way, or still to come. */
type MilestoneState = 'done' | 'now' | 'next';

/** The three things drafting does, in order. */
type MilestoneStep = 'find' | 'write' | 'check';

export type DraftMilestone = {
  step: MilestoneStep;
  state: MilestoneState;
  /** What it did, does, or will do. */
  label: string;
  /** More about it, under its label. */
  detail?: string;
};

/** What the check milestone is doing: checking, fixing what failed, or done. */
type CheckActivity = 'checking' | 'fixing' | 'finishing';

/** What a draft is doing now, for a status in a word or two. */
export type DraftActivity = 'finding' | 'writing' | CheckActivity;

type FoundNames = NonNullable<DraftJobProgress['names']>;
type FoundName = FoundNames['found'][number];
type LeftName = FoundNames['left'][number];
type ItemKind = FoundName['kind'];

type KindWords = { one: string; many: string };

/** How a person calls each kind of item, as the app names them. */
const KIND_WORDS: Record<ItemKind, KindWords> = {
  channel: { one: 'channel', many: 'channels' },
  person: { one: 'person', many: 'people' },
  project: { one: 'folder', many: 'folders' },
  initiative: { one: 'project', many: 'projects' },
  document: { one: 'document', many: 'documents' },
  task: { one: 'task', many: 'tasks' },
  database: { one: 'database', many: 'databases' },
  agent: { one: 'agent', many: 'agents' },
  label: { one: 'label', many: 'labels' },
  tag: { one: 'tag', many: 'tags' },
  channel_label: { one: 'channel label', many: 'channel labels' },
};

const ITEM: KindWords = { one: 'item', many: 'items' };

/** A kind's words; a kind a newer server reports reads as an item. */
function kindWords(kind: ItemKind | null | undefined): KindWords {
  if (!kind) return ITEM;
  return (KIND_WORDS as Partial<Record<string, KindWords>>)[kind] ?? ITEM;
}

/** A name as the app shows it: a channel with its #. */
function shownName(kind: ItemKind | null | undefined, name: string) {
  return kind === 'channel' ? `#${name.replace(/^#/, '')}` : name;
}

/** An item found, as the person would say it: "your Finance label". */
function foundPhrase(item: FoundName): string {
  if (item.kind === 'channel' || item.kind === 'person') {
    return shownName(item.kind, item.name);
  }
  return `your ${item.name} ${kindWords(item.kind).one}`;
}

/** Why a name was left for the person: none or several items have it. */
function leftPhrase(left: LeftName): string {
  const words = kindWords(left.kind);
  const name = shownName(left.kind, left.name);
  return left.matches > 1
    ? `${left.matches} ${words.many} are called ${name}`
    : `no ${words.one} is called ${name}`;
}

function capitalized(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** What the person picks themselves, before saving. */
function leftDetail(left: LeftName[]): string | undefined {
  const [first, ...rest] = left;
  if (!first) return undefined;
  if (rest.length === 0) {
    const pick = first.matches > 1 ? 'which' : 'one';
    return `${capitalized(leftPhrase(first))}, so you'll pick ${pick}`;
  }
  return `You'll pick ${left.length}: ${left.map(leftPhrase).join('; ')}`;
}

const ORDER: MilestoneStep[] = ['find', 'write', 'check'];

/** The milestone under way at each stage. */
function current(progress: DraftJobProgress): MilestoneStep {
  return (
    match(progress.stage)
      .with('started', () => 'find' as const)
      .with('found', 'writing', () => 'write' as const)
      .with('checked', 'fixing', () => 'check' as const)
      // A stage a newer server reports: the first milestone stays under way.
      .exhaustive(() => 'find' as const)
  );
}

/** What was found, by name: a server that reports only a count says that. */
function foundMilestone(
  progress: DraftJobProgress
): Pick<DraftMilestone, 'label' | 'detail'> {
  const names = progress.names;
  if (!names) {
    const found = progress.found;
    if (!found) return { label: 'Read your request' };
    return {
      label:
        found === 1
          ? 'Found what it names'
          : `Found the ${found} things it names`,
    };
  }
  const phrases = names.found.map(foundPhrase);
  const [first, second, ...rest] = phrases;
  const detail = leftDetail(names.left);
  if (!first) {
    return {
      label: names.left.length
        ? 'Looked up what it names'
        : 'Read your request',
      detail,
    };
  }
  if (!second) return { label: `Found ${first}`, detail };
  if (rest.length === 0)
    return { label: `Found ${first} and ${second}`, detail };
  return {
    label: `Found ${first}, ${second} and ${rest.length} more`,
    detail: detail ?? `Also ${rest.join(', ')}`,
  };
}

function findMilestone(
  state: MilestoneState,
  progress: DraftJobProgress
): Pick<DraftMilestone, 'label' | 'detail'> {
  return match(state)
    .with('next', () => ({ label: 'Look up what it names' }))
    .with('now', () => ({
      label: 'Looking up what it names',
      detail: 'Channels, people, labels and more, by the names you used',
    }))
    .with('done', () => foundMilestone(progress))
    .exhaustive();
}

function writeMilestone(
  state: MilestoneState,
  progress: DraftJobProgress
): Pick<DraftMilestone, 'label' | 'detail'> {
  const steps = progress.check?.steps ?? [];
  return match(state)
    .with('next', () => ({ label: 'Write the steps' }))
    .with('now', () => ({
      label: 'Writing the steps',
      detail: 'Its trigger and every step, in one pass',
    }))
    .with('done', () => {
      if (steps.length === 0) return { label: 'Wrote the steps' };
      const titles = steps.map((step) => step.title).filter(Boolean);
      return {
        label:
          steps.length === 1 ? 'Wrote 1 step' : `Wrote ${steps.length} steps`,
        detail: titles.length ? titles.join(' · ') : undefined,
      };
    })
    .exhaustive();
}

/** What the last milestone is doing once the drafter has reached it. */
function checking(progress: DraftJobProgress): CheckActivity {
  const check = progress.check;
  if (progress.stage === 'fixing' || (check && !check.ok)) return 'fixing';
  // A check that passed: the draft is done but for saving it.
  if (check?.ok) return 'finishing';
  return 'checking';
}

function checkMilestone(
  state: MilestoneState,
  progress: DraftJobProgress
): Pick<DraftMilestone, 'label' | 'detail'> {
  if (state === 'next') return { label: 'Check that it runs' };
  const problems = progress.check?.problems ?? 0;
  return match(checking(progress))
    .with('fixing', () => ({
      label:
        problems > 1
          ? 'Fixing the problems the check found'
          : 'Fixing a problem the check found',
      detail: problems > 1 ? `${problems} problems to fix` : undefined,
    }))
    .with('finishing', () => ({
      label: 'Finishing up',
      detail: progress.check?.name || undefined,
    }))
    .with('checking', () => ({
      label: 'Checking that it runs',
      detail: 'The same checks as saving it',
    }))
    .exhaustive();
}

/**
 * The milestones of a draft still drafting. Each moves on when the drafter
 * reports it, never on a timer, so a draft that takes 10 seconds and one
 * that takes a minute read the same.
 */
export function draftMilestones(progress: DraftJobProgress): DraftMilestone[] {
  const at = ORDER.indexOf(current(progress));
  const stateOf = (step: MilestoneStep): MilestoneState => {
    const index = ORDER.indexOf(step);
    if (index < at) return 'done';
    return index === at ? 'now' : 'next';
  };
  const find = stateOf('find');
  const write = stateOf('write');
  const check = stateOf('check');
  return [
    { step: 'find', state: find, ...findMilestone(find, progress) },
    { step: 'write', state: write, ...writeMilestone(write, progress) },
    { step: 'check', state: check, ...checkMilestone(check, progress) },
  ];
}

/** What a draft still drafting is doing now. */
export function draftActivity(progress: DraftJobProgress): DraftActivity {
  return match(current(progress))
    .with('find', () => 'finding' as const)
    .with('write', () => 'writing' as const)
    .with('check', () => checking(progress))
    .exhaustive();
}
