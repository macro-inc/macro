import {
  PROPERTY_OPTION_IDS,
  SYSTEM_PROPERTY_IDS,
} from '@property/identifiers';
import { match } from 'ts-pattern';
import {
  type ChoiceDraft,
  type ChooseStepDraft,
  choice,
  chooseStep,
  flattenSteps,
  newStepId,
  type StepDraft,
  type ToolStepDraft,
} from './routine-steps';
import { eventScopeKind, type RoutineTriggerDraft } from './routine-triggers';

/** What the triggering item is, when every activity trigger agrees. */
export type StepSubject = 'email' | 'task' | 'document' | 'channel';

export function triggerSubject(
  triggers: readonly RoutineTriggerDraft[]
): StepSubject | undefined {
  if (!triggers.length || triggers.some((trigger) => trigger.kind !== 'event'))
    return undefined;
  const kinds = new Set(
    triggers.map((trigger) =>
      trigger.kind === 'event' ? eventScopeKind(trigger) : undefined
    )
  );
  if (kinds.size !== 1) return undefined;
  return match([...kinds][0])
    .returnType<StepSubject | undefined>()
    .with('THREAD', () => 'email')
    .with('TASK', () => 'task')
    .with('DOCUMENT', () => 'document')
    .with('CHANNEL', () => 'channel')
    .otherwise(() => undefined);
}

/** The triggering item's id placeholder. */
export const TRIGGER_ID = '{{trigger.entity_id}}';
const SYSTEM_LABELS = ['INBOX', 'UNREAD', 'STARRED', 'IMPORTANT'] as const;

const text = (value: unknown) => (typeof value === 'string' ? value : '');

/** Something steps can act on: the triggering item, or one an earlier step created. */
export type StepItem = {
  /** The id placeholder steps pass, e.g. `{{trigger.entity_id}}`. */
  ref: string;
  subject: StepSubject;
  label: string;
};

/** What a step at one position can use. */
export type StepScope = {
  /** The triggering item's kind, for its insertable fields. */
  subject: StepSubject | undefined;
  /** Items to act on, the triggering one first. */
  items: StepItem[];
  /** Earlier steps' outputs text can include. */
  outputs: { label: string; value: string }[];
};

export function triggerScope(subject: StepSubject | undefined): StepScope {
  return {
    subject,
    items: subject
      ? [{ ref: TRIGGER_ID, subject, label: `The triggering ${subject}` }]
      : [],
    outputs: [],
  };
}

/** The task or document a step creates, for later steps to act on. */
export function createdItem(step: ToolStepDraft): StepItem | undefined {
  if (step.tool !== 'CreateDocument' || !step.output) return undefined;
  const subject = step.arguments.isTask ? 'task' : 'document';
  const title = text(step.arguments.documentName).trim();
  return {
    ref: `{{steps.${step.output}.documentId}}`,
    subject,
    label: title ? `New ${subject} “${title}”` : `New ${subject}`,
  };
}

/**
 * What steps after `step` can use. Only steps in the same branch or an
 * enclosing one count: a branch that did not run created nothing.
 */
export function scopeAfter(scope: StepScope, step: StepDraft): StepScope {
  const item = step.kind === 'tool' ? createdItem(step) : undefined;
  return item
    ? {
        ...scope,
        items: [...scope.items, item],
        outputs: [
          ...scope.outputs,
          { label: `${item.label} id`, value: item.ref },
        ],
      }
    : scope;
}

/** An output name no other step in the routine uses, e.g. `task_2`. */
export function freshOutput(base: string, steps: StepDraft[]): string {
  const taken = new Set(
    flattenSteps(steps).flatMap((step) =>
      step.kind === 'tool' && step.output ? [step.output] : []
    )
  );
  if (!taken.has(base)) return base;
  let index = 2;
  while (taken.has(`${base}_${index}`)) index += 1;
  return `${base}_${index}`;
}

export type StepActionKey =
  | 'add_label'
  | 'remove_label'
  | 'archive'
  | 'mark_read'
  | 'star'
  | 'mark_important'
  | 'sender_policy'
  | 'add_tag'
  | 'set_status'
  | 'set_priority'
  | 'assign'
  | 'move'
  | 'create_task'
  | 'create_document'
  | 'comment'
  | 'send_message'
  | 'reply_in_thread'
  | 'other';

export type StepActionGroup = 'Email' | 'Item' | 'Create' | 'Messages';

type ActionContext = {
  /** The triggering item's kind. */
  subject: StepSubject | undefined;
  /** What the step acts on: the triggering item unless the action says otherwise. */
  item: StepItem;
  /** Names a created item's output so no other step's name clashes. */
  output(base: string): string;
};

export type StepAction = {
  key: StepActionKey;
  label: string;
  group: StepActionGroup;
  description: string;
  /** Kinds of item it acts on; absent when it needs none. */
  subjects?: StepSubject[];
  create(context: ActionContext): Omit<ToolStepDraft, 'id'>;
};

function labelStep(label: string, add: boolean): Omit<ToolStepDraft, 'id'> {
  return {
    kind: 'tool',
    tool: 'UpdateThreadLabels',
    arguments: { thread_id: TRIGGER_ID, label, add },
  };
}

/** How each subject is addressed by `SetEntityProperty`. */
function propertyEntityType(subject: StepSubject): string {
  return match(subject)
    .with('email', () => 'thread')
    .with('channel', () => 'channel')
    .otherwise(() => 'document');
}

function propertyStep(
  item: StepItem,
  definition: string,
  value: Record<string, unknown>
): Omit<ToolStepDraft, 'id'> {
  return {
    kind: 'tool',
    tool: 'SetEntityProperty',
    arguments: {
      entity_id: item.ref,
      entity_type: propertyEntityType(item.subject),
      property_definition_id: definition,
      ...value,
    },
  };
}

export const stepActions: StepAction[] = [
  {
    key: 'add_label',
    label: 'Add label',
    group: 'Email',
    description: 'Apply a Gmail label to the email.',
    subjects: ['email'],
    create: () => labelStep('', true),
  },
  {
    key: 'remove_label',
    label: 'Remove label',
    group: 'Email',
    description: 'Take a Gmail label off the email.',
    subjects: ['email'],
    create: () => labelStep('', false),
  },
  {
    key: 'archive',
    label: 'Archive',
    group: 'Email',
    description: 'Move the email out of the inbox.',
    subjects: ['email'],
    create: () => labelStep('INBOX', false),
  },
  {
    key: 'mark_read',
    label: 'Mark as read',
    group: 'Email',
    description: 'Mark the email as read.',
    subjects: ['email'],
    create: () => labelStep('UNREAD', false),
  },
  {
    key: 'star',
    label: 'Star',
    group: 'Email',
    description: 'Star the email.',
    subjects: ['email'],
    create: () => labelStep('STARRED', true),
  },
  {
    key: 'mark_important',
    label: 'Mark important',
    group: 'Email',
    description: 'Mark the email as important.',
    subjects: ['email'],
    create: () => labelStep('IMPORTANT', true),
  },
  {
    key: 'sender_policy',
    label: 'Mark sender as noise',
    group: 'Email',
    description:
      'Treat future mail from this sender as noise, signal or blocked.',
    subjects: ['email'],
    create: () => ({
      kind: 'tool',
      tool: 'SetSenderPolicy',
      arguments: {
        sender_email: '{{trigger.email.from.email}}',
        policy: 'noise',
      },
    }),
  },
  {
    key: 'add_tag',
    label: 'Add tag',
    group: 'Item',
    description: 'Tag the email, task, document or channel.',
    subjects: ['email', 'task', 'document', 'channel'],
    create: ({ item }) => propertyStep(item, '', { add_option_ids: [] }),
  },
  {
    key: 'set_status',
    label: 'Set status',
    group: 'Item',
    description: 'Change the task’s status.',
    subjects: ['task'],
    create: ({ item }) =>
      propertyStep(item, SYSTEM_PROPERTY_IDS.STATUS, {
        option_id: PROPERTY_OPTION_IDS.STATUS.IN_PROGRESS,
      }),
  },
  {
    key: 'set_priority',
    label: 'Set priority',
    group: 'Item',
    description: 'Change the task’s priority.',
    subjects: ['task'],
    create: ({ item }) =>
      propertyStep(item, SYSTEM_PROPERTY_IDS.PRIORITY, {
        option_id: PROPERTY_OPTION_IDS.PRIORITY.HIGH,
      }),
  },
  {
    key: 'assign',
    label: 'Assign',
    group: 'Item',
    description: 'Assign the task to a person or agent.',
    subjects: ['task'],
    create: ({ item }) =>
      propertyStep(item, SYSTEM_PROPERTY_IDS.ASSIGNEES, {
        entity_refs: [],
      }),
  },
  {
    key: 'move',
    label: 'Move to folder',
    group: 'Item',
    description: 'File the email, task or document in a folder.',
    subjects: ['email', 'task', 'document'],
    create: ({ item }) => ({
      kind: 'tool',
      tool: 'MoveToProject',
      arguments: {
        entityType: item.subject === 'email' ? 'email' : 'document',
        entityId: item.ref,
        projectId: '',
      },
    }),
  },
  {
    key: 'comment',
    label: 'Comment',
    group: 'Item',
    description: 'Leave a comment on the task or document.',
    subjects: ['task', 'document'],
    create: ({ item }) => ({
      kind: 'tool',
      tool: 'CommentOnDocument',
      arguments: { documentId: item.ref, content: '' },
    }),
  },
  {
    key: 'create_task',
    label: 'Create task',
    group: 'Create',
    description:
      'Create a task that later steps can assign, tag or comment on.',
    create: ({ subject, output }) => ({
      kind: 'tool',
      tool: 'CreateDocument',
      output: output('task'),
      arguments: {
        documentName: match(subject)
          .with('email', () => '{{trigger.email.subject}}')
          .with('task', 'document', () => 'Follow up: {{trigger.item.name}}')
          .otherwise(() => ''),
        fileContent: '',
        fileExtension: 'md',
        isTask: true,
      },
    }),
  },
  {
    key: 'create_document',
    label: 'Create document',
    group: 'Create',
    description: 'Write a document, such as a daily brief or meeting notes.',
    create: ({ subject, output }) => ({
      kind: 'tool',
      tool: 'CreateDocument',
      output: output('doc'),
      arguments: {
        documentName: match(subject)
          .with('email', () => 'Notes: {{trigger.email.subject}}')
          .otherwise(() => ''),
        fileContent: '',
        fileExtension: 'md',
      },
    }),
  },
  {
    key: 'send_message',
    label: 'Send message',
    group: 'Messages',
    description: 'Post a message in a channel.',
    create: () => ({
      kind: 'tool',
      tool: 'SendChannelMessage',
      arguments: { channel_id: '', content: '' },
    }),
  },
  {
    key: 'reply_in_thread',
    label: 'Reply in thread',
    group: 'Messages',
    description: 'Reply to the message that triggered the run.',
    subjects: ['channel'],
    create: () => ({
      kind: 'tool',
      tool: 'SendChannelMessage',
      arguments: {
        channel_id: TRIGGER_ID,
        thread_id: '{{trigger.message_id}}',
        content: '',
      },
    }),
  },
];

export const stepActionGroups: StepActionGroup[] = [
  'Email',
  'Item',
  'Create',
  'Messages',
];

/** Items in scope an action can act on, the triggering one first. */
export function actionTargets(
  action: Pick<StepAction, 'subjects'>,
  scope: StepScope
): StepItem[] {
  const subjects = action.subjects;
  return subjects
    ? scope.items.filter((item) => subjects.includes(item.subject))
    : [];
}

/** Actions with something to act on at this point of the routine. */
export function availableActions(scope: StepScope): StepAction[] {
  return stepActions.filter(
    (action) => !action.subjects || actionTargets(action, scope).length > 0
  );
}

/** A new step for `action`, acting on its first target in scope. */
export function createActionStep(
  action: StepAction,
  scope: StepScope,
  steps: StepDraft[] = []
): ToolStepDraft {
  const [
    item = { ref: TRIGGER_ID, subject: scope.subject ?? 'task', label: '' },
  ] = actionTargets(action, scope);
  return {
    id: newStepId(),
    ...action.create({
      subject: scope.subject,
      item,
      output: (base) => freshOutput(base, steps),
    }),
  };
}

/** The id placeholder of the item a tool step acts on. */
export function stepTarget(step: ToolStepDraft): string | undefined {
  const args = step.arguments;
  return match(step.tool)
    .with('SetEntityProperty', () => text(args.entity_id))
    .with('CommentOnDocument', () => text(args.documentId))
    .with('MoveToProject', () => text(args.entityId))
    .with('UpdateThreadLabels', () => text(args.thread_id))
    .otherwise(() => undefined);
}

/** Items in scope a tool step could act on. */
export function stepTargets(step: ToolStepDraft, scope: StepScope): StepItem[] {
  const action = stepActions.find(
    (action) => action.key === stepActionKey(step)
  );
  return action ? actionTargets(action, scope) : [];
}

/** The same step, acting on `item` instead. */
export function retarget(step: ToolStepDraft, item: StepItem): ToolStepDraft {
  const args = step.arguments;
  const next = match(step.tool)
    .returnType<Record<string, unknown>>()
    .with('SetEntityProperty', () => ({
      ...args,
      entity_id: item.ref,
      entity_type: propertyEntityType(item.subject),
    }))
    .with('CommentOnDocument', () => ({ ...args, documentId: item.ref }))
    .with('MoveToProject', () => ({
      ...args,
      entityId: item.ref,
      entityType: item.subject === 'email' ? 'email' : 'document',
    }))
    .otherwise(() => args);
  return { ...step, arguments: next };
}

/** The catalog action a tool step was built from, or `other` for raw tool calls. */
export function stepActionKey(step: ToolStepDraft): StepActionKey {
  const args = step.arguments;
  return match(step.tool)
    .returnType<StepActionKey>()
    .with('UpdateThreadLabels', () => {
      const label = text(args.label).toUpperCase();
      if (args.label_id !== undefined) return 'other';
      if (label === 'INBOX' && args.add === false) return 'archive';
      if (label === 'UNREAD' && args.add === false) return 'mark_read';
      if (label === 'STARRED' && args.add === true) return 'star';
      if (label === 'IMPORTANT' && args.add === true) return 'mark_important';
      if ((SYSTEM_LABELS as readonly string[]).includes(label)) return 'other';
      return args.add === false ? 'remove_label' : 'add_label';
    })
    .with('SetSenderPolicy', () => 'sender_policy')
    .with('SetEntityProperty', () =>
      match(text(args.property_definition_id))
        .returnType<StepActionKey>()
        .with(SYSTEM_PROPERTY_IDS.STATUS, () => 'set_status')
        .with(SYSTEM_PROPERTY_IDS.PRIORITY, () => 'set_priority')
        .with(SYSTEM_PROPERTY_IDS.ASSIGNEES, () => 'assign')
        .otherwise(() =>
          Array.isArray(args.add_option_ids) ? 'add_tag' : 'other'
        )
    )
    .with('CreateDocument', () =>
      args.isTask ? 'create_task' : 'create_document'
    )
    .with('MoveToProject', () => 'move')
    .with('CommentOnDocument', () => 'comment')
    .with('SendChannelMessage', () =>
      text(args.channel_id) === TRIGGER_ID ? 'reply_in_thread' : 'send_message'
    )
    .otherwise(() => 'other');
}

export const statusOptions = [
  { id: PROPERTY_OPTION_IDS.STATUS.NOT_STARTED, label: 'Not Started' },
  { id: PROPERTY_OPTION_IDS.STATUS.IN_PROGRESS, label: 'In Progress' },
  { id: PROPERTY_OPTION_IDS.STATUS.IN_REVIEW, label: 'In Review' },
  { id: PROPERTY_OPTION_IDS.STATUS.COMPLETED, label: 'Completed' },
  { id: PROPERTY_OPTION_IDS.STATUS.CANCELED, label: 'Canceled' },
];

export const priorityOptions = [
  { id: PROPERTY_OPTION_IDS.PRIORITY.LOW, label: 'Low' },
  { id: PROPERTY_OPTION_IDS.PRIORITY.MEDIUM, label: 'Medium' },
  { id: PROPERTY_OPTION_IDS.PRIORITY.HIGH, label: 'High' },
  { id: PROPERTY_OPTION_IDS.PRIORITY.URGENT, label: 'Urgent' },
];

export const senderPolicies = [
  { id: 'noise', label: 'Noise' },
  { id: 'signal', label: 'Signal' },
  { id: 'block', label: 'Blocked' },
] as const;

/** A one-line summary of what a tool step does. */
export function describeToolStep(step: ToolStepDraft): string {
  const args = step.arguments;
  return match(stepActionKey(step))
    .with('add_label', () => `Add label “${text(args.label) || '…'}”`)
    .with('remove_label', () => `Remove label “${text(args.label) || '…'}”`)
    .with('archive', () => 'Archive')
    .with('mark_read', () => 'Mark as read')
    .with('star', () => 'Star')
    .with('mark_important', () => 'Mark important')
    .with(
      'sender_policy',
      () =>
        `Mark sender as ${
          senderPolicies
            .find((policy) => policy.id === args.policy)
            ?.label.toLowerCase() ?? 'noise'
        }`
    )
    .with('add_tag', () => 'Add tag')
    .with(
      'set_status',
      () =>
        `Set status to ${
          statusOptions.find((option) => option.id === args.option_id)?.label ??
          '…'
        }`
    )
    .with(
      'set_priority',
      () =>
        `Set priority to ${
          priorityOptions.find((option) => option.id === args.option_id)
            ?.label ?? '…'
        }`
    )
    .with('assign', () => 'Assign')
    .with('move', () => 'Move to folder')
    .with('create_task', () => 'Create task')
    .with('create_document', () => 'Create document')
    .with('comment', () => 'Comment')
    .with('send_message', () => 'Send message')
    .with('reply_in_thread', () => 'Reply in thread')
    .with('other', () => step.tool.replace(/([a-z])([A-Z])/g, '$1 $2'))
    .exhaustive();
}

/** What a tool step must have before it can be saved. */
export function validateToolStep(step: ToolStepDraft): string | null {
  const args = step.arguments;
  return match(stepActionKey(step))
    .returnType<string | null>()
    .with('add_label', 'remove_label', () =>
      text(args.label).trim() ? null : 'Choose a label for each label step.'
    )
    .with('add_tag', () =>
      text(args.property_definition_id) &&
      Array.isArray(args.add_option_ids) &&
      args.add_option_ids.length
        ? null
        : 'Choose a tag for each “Add tag” step.'
    )
    .with('assign', () =>
      Array.isArray(args.entity_refs) && args.entity_refs.length
        ? null
        : 'Choose who each “Assign” step assigns.'
    )
    .with('create_task', 'create_document', () =>
      text(args.documentName).trim()
        ? null
        : 'Give each new task or document a title.'
    )
    .with('move', () =>
      text(args.projectId) ? null : 'Choose a folder for each “Move” step.'
    )
    .with('comment', 'reply_in_thread', () =>
      text(args.content).trim() ? null : 'Write the comment or reply.'
    )
    .with('send_message', () =>
      !text(args.channel_id)
        ? 'Choose a channel for each message.'
        : text(args.content).trim()
          ? null
          : 'Write each message.'
    )
    .otherwise(() => null);
}

/** Actions whose one value AI can pick: a label, tag, status, priority or person. */
export type PickActionKey = Extract<
  StepActionKey,
  'add_label' | 'add_tag' | 'set_status' | 'set_priority' | 'assign'
>;

const pickActionKeys: readonly PickActionKey[] = [
  'add_label',
  'add_tag',
  'set_status',
  'set_priority',
  'assign',
];

/** Properties with one value, where only the best option can apply. */
export function singleValued(key: PickActionKey): boolean {
  return key === 'set_status' || key === 'set_priority' || key === 'assign';
}

/**
 * The action a choice picks a value for: every option starts with a step of
 * that action, so the classifier picks the value; later steps in an option
 * run along with it. Undefined for other choices.
 */
export function pickAction(step: ChooseStepDraft): PickActionKey | undefined {
  const keys = step.options.map((option) => {
    const [first] = option.steps;
    return first?.kind === 'tool' ? stepActionKey(first) : undefined;
  });
  const [first] = keys;
  return pickActionKeys.find(
    (key) => key === first && keys.every((other) => other === key)
  );
}

export type AiPick = {
  action: PickActionKey;
  label: string;
  description: string;
  question: string;
  /** Prefilled options; absent ones start with two blank rows. */
  options?: {
    label: string;
    description: string;
    value: Record<string, unknown>;
  }[];
};

export const aiPicks: AiPick[] = [
  {
    action: 'add_label',
    label: 'Label with AI',
    description: 'Apply every label that fits the email.',
    question: 'Which labels fit this email?',
  },
  {
    action: 'add_tag',
    label: 'Tag with AI',
    description: 'Apply every tag that fits.',
    question: 'Which tags fit?',
  },
  {
    action: 'set_priority',
    label: 'Set priority with AI',
    description: 'Pick the priority that fits the item.',
    question: 'How urgent is this?',
    options: [
      {
        label: 'Urgent',
        description: 'An outage, a blocked customer or teammate, or due today',
        value: { option_id: PROPERTY_OPTION_IDS.PRIORITY.URGENT },
      },
      {
        label: 'High',
        description: 'Important and due this week',
        value: { option_id: PROPERTY_OPTION_IDS.PRIORITY.HIGH },
      },
      {
        label: 'Medium',
        description: 'Planned work without pressure',
        value: { option_id: PROPERTY_OPTION_IDS.PRIORITY.MEDIUM },
      },
      {
        label: 'Low',
        description: 'Nice to have, no deadline',
        value: { option_id: PROPERTY_OPTION_IDS.PRIORITY.LOW },
      },
    ],
  },
  {
    action: 'assign',
    label: 'Assign with AI',
    description: 'Pick who should handle it.',
    question: 'Who should handle this?',
  },
];

function actionFor(key: StepActionKey): StepAction | undefined {
  return stepActions.find((action) => action.key === key);
}

/** AI picks with something to act on at this point of the routine. */
export function availablePicks(scope: StepScope): AiPick[] {
  return aiPicks.filter((pick) => {
    const action = actionFor(pick.action);
    return action && actionTargets(action, scope).length > 0;
  });
}

/** One option of a pick: a value and the step that applies it. */
export function pickOption(
  step: ToolStepDraft,
  label = '',
  description = ''
): ChoiceDraft {
  return {
    ...choice(label),
    description,
    steps: [{ ...step, id: newStepId() }],
  };
}

/** A choice whose options each apply one value of `pick.action`. */
export function createPickStep(
  pick: AiPick,
  scope: StepScope
): ChooseStepDraft {
  const action = actionFor(pick.action);
  if (!action) throw new Error(`Unknown pick action ${pick.action}`);
  const blank = createActionStep(action, scope);
  const options = pick.options?.map((option) =>
    pickOption(
      { ...blank, arguments: { ...blank.arguments, ...option.value } },
      option.label,
      option.description
    )
  ) ?? [pickOption(blank), pickOption(blank)];
  return chooseStep(pick.question, options, !singleValued(pick.action));
}

const blankValues: Record<PickActionKey, Record<string, unknown>> = {
  add_label: { label: '' },
  add_tag: { property_definition_id: '', add_option_ids: [] },
  set_status: { option_id: '' },
  set_priority: { option_id: '' },
  assign: { entity_refs: [] },
};

/** Another option for a pick, applying no value yet. */
export function blankPickOption(
  step: ChooseStepDraft,
  key: PickActionKey
): ChoiceDraft | undefined {
  const [template] = step.options[0]?.steps ?? [];
  if (template?.kind !== 'tool') return undefined;
  return pickOption({
    ...template,
    arguments: { ...template.arguments, ...blankValues[key] },
  });
}

export const pickHints: Record<
  PickActionKey,
  { add: string; placeholder: string }
> = {
  add_label: {
    add: 'Another label',
    placeholder: 'What belongs here, e.g. invoices and receipts',
  },
  add_tag: {
    add: 'Another tag',
    placeholder: 'What it’s for, e.g. customer feedback',
  },
  set_status: { add: 'Another status', placeholder: 'When it applies' },
  set_priority: { add: 'Another priority', placeholder: 'When it applies' },
  assign: {
    add: 'Another person',
    placeholder: 'What they handle, e.g. billing questions',
  },
};

/** What a choice is called in the editor. */
export function describeChoice(step: ChooseStepDraft): string {
  const key = pickAction(step);
  const pick = aiPicks.find((pick) => pick.action === key);
  if (pick) return pick.label;
  if (key === 'set_status') return 'Set status with AI';
  return step.multiple ? 'Choose all that fit' : 'Choose';
}

/** An action's name without its value, e.g. "Set priority". */
export function actionLabel(step: ToolStepDraft): string {
  const key = stepActionKey(step);
  return (
    stepActions.find((action) => action.key === key)?.label ??
    describeToolStep(step)
  );
}

/** A short line on what a collapsed step does, after its title. */
export function summarizeStep(step: StepDraft): string {
  return match(step)
    .returnType<string>()
    .with(
      { kind: 'agent' },
      (step) => step.instructions.trim().split('\n')[0] ?? ''
    )
    .with({ kind: 'if' }, (step) => step.condition.trim())
    .with({ kind: 'choose' }, (step) =>
      step.options
        .map((option) => option.label.trim())
        .filter(Boolean)
        .join(' · ')
    )
    .with({ kind: 'tool' }, (step) =>
      match(stepActionKey(step))
        .returnType<string>()
        .with('comment', 'reply_in_thread', 'send_message', () =>
          text(step.arguments.content).trim()
        )
        .with('create_task', 'create_document', () =>
          text(step.arguments.documentName).trim()
        )
        .otherwise(() => '')
    )
    .exhaustive();
}

/** Whether a step, or one nested in it, still needs something filled in. */
export function stepNeedsInput(step: StepDraft): boolean {
  return flattenSteps([step]).some((step) =>
    match(step)
      .with({ kind: 'agent' }, (step) => !step.instructions.trim())
      .with({ kind: 'if' }, (step) => !step.condition.trim())
      .with({ kind: 'choose' }, (step) =>
        step.options.some((option) => !option.label.trim())
      )
      .with({ kind: 'tool' }, (step) => validateToolStep(step) !== null)
      .exhaustive()
  );
}

/** Fields of the triggering item that text can include. */
export function triggerFields(
  subject: StepSubject | undefined
): { label: string; value: string }[] {
  return match(subject)
    .with('email', () => [
      { label: 'Email subject', value: '{{trigger.email.subject}}' },
      { label: 'Sender name', value: '{{trigger.email.from.name}}' },
      { label: 'Sender email', value: '{{trigger.email.from.email}}' },
      { label: 'Email body', value: '{{trigger.email.body}}' },
    ])
    .with('channel', () => [
      { label: 'Channel name', value: '{{trigger.channel.name}}' },
      { label: 'Message text', value: '{{trigger.message.text}}' },
      { label: 'Message sender', value: '{{trigger.message.sender}}' },
    ])
    .with('task', 'document', () => [
      { label: 'Item name', value: '{{trigger.item.name}}' },
      { label: 'Item content', value: '{{trigger.item.content}}' },
    ])
    .otherwise(() => []);
}

/** What a step is called: its action, its kind of decision, or Ask AI. */
export function stepTitle(step: StepDraft): string {
  return match(step)
    .with({ kind: 'agent' }, () => 'Ask AI')
    .with({ kind: 'if' }, () => 'If')
    .with({ kind: 'choose' }, (step) => describeChoice(step))
    .with({ kind: 'tool' }, (step) => describeToolStep(step))
    .exhaustive();
}

/** A routine's steps in a line: its first step, and how many follow. */
export function describeSteps(steps: StepDraft[]): string {
  const [first] = steps;
  if (!first) return 'No steps';
  const more = flattenSteps(steps).length - 1;
  return more ? `${stepTitle(first)} · ${more} more` : stepTitle(first);
}
