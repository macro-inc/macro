import { PROPERTY_OPTION_IDS, SYSTEM_PROPERTY_IDS } from '@property/constants';
import { EntityType } from '@service-storage/generated/schemas/entityType';
import type { PropertyInput } from '@service-storage/generated/schemas/propertyInput';

const LINEAR_CSV_HEADERS = {
  title: 'Title',
  description: 'Description',
  status: 'Status',
  priority: 'Priority',
  assignee: 'Assignee',
  completed: 'Completed',
  canceled: 'Canceled',
  archived: 'Archived',
  id: 'ID',
  uuid: 'UUID',
  team: 'Team',
  updated: 'Updated',
  created: 'Created',
} as const;

type StatusOptionId =
  (typeof PROPERTY_OPTION_IDS.STATUS)[keyof typeof PROPERTY_OPTION_IDS.STATUS];

type PriorityOptionId =
  (typeof PROPERTY_OPTION_IDS.PRIORITY)[keyof typeof PROPERTY_OPTION_IDS.PRIORITY];

function normalizeText(s: string | undefined): string {
  return (s ?? '').trim();
}

function lower(s: string | undefined): string {
  return normalizeText(s).toLowerCase();
}

function hasValue(s: string | undefined): boolean {
  return normalizeText(s).length > 0;
}

function parseLinearPriority(
  value: string | undefined
): PriorityOptionId | null {
  const raw = normalizeText(value);
  if (!raw) return null;

  const asNum = Number(raw);
  if (Number.isFinite(asNum)) {
    // Linear exports priority as 0-4 in some formats:
    // 0 = none, 1 = urgent, 2 = high, 3 = medium, 4 = low
    switch (Math.trunc(asNum)) {
      case 1:
        return PROPERTY_OPTION_IDS.PRIORITY.URGENT;
      case 2:
        return PROPERTY_OPTION_IDS.PRIORITY.HIGH;
      case 3:
        return PROPERTY_OPTION_IDS.PRIORITY.MEDIUM;
      case 4:
        return PROPERTY_OPTION_IDS.PRIORITY.LOW;
      default:
        return null;
    }
  }

  const p = raw.toLowerCase();
  if (p.includes('urgent')) return PROPERTY_OPTION_IDS.PRIORITY.URGENT;
  if (p.includes('high')) return PROPERTY_OPTION_IDS.PRIORITY.HIGH;
  if (p.includes('medium') || p === 'med')
    return PROPERTY_OPTION_IDS.PRIORITY.MEDIUM;
  if (p.includes('low')) return PROPERTY_OPTION_IDS.PRIORITY.LOW;
  if (p.includes('no priority') || p.includes('none')) return null;

  return null;
}

function parseLinearStatusOptionId(args: {
  status: string | undefined;
  completed: string | undefined;
  canceled: string | undefined;
  archived: string | undefined;
}): StatusOptionId {
  // Timestamps override the status label when present.
  if (hasValue(args.archived) || hasValue(args.canceled)) {
    return PROPERTY_OPTION_IDS.STATUS.CANCELED;
  }
  if (hasValue(args.completed)) {
    return PROPERTY_OPTION_IDS.STATUS.COMPLETED;
  }

  const s = lower(args.status);

  if (s.includes('cancel')) return PROPERTY_OPTION_IDS.STATUS.CANCELED;
  if (s.includes('done') || s.includes('complete'))
    return PROPERTY_OPTION_IDS.STATUS.COMPLETED;
  if (s.includes('review')) return PROPERTY_OPTION_IDS.STATUS.IN_REVIEW;
  if (
    s.includes('progress') ||
    s.includes('doing') ||
    s.includes('started') ||
    s.includes('in dev')
  ) {
    return PROPERTY_OPTION_IDS.STATUS.IN_PROGRESS;
  }
  return PROPERTY_OPTION_IDS.STATUS.NOT_STARTED;
}

type MacroTaskDraft = {
  title: string;
  content: string;
  propertyValues: PropertyInput[];
  warnings: readonly string[];
};

export function linearCsvRecordToMacroTaskDraft(args: {
  record: Record<string, string>;
  assigneeUserId?: string | null;
}): MacroTaskDraft {
  const record = args.record;
  const title = normalizeText(record[LINEAR_CSV_HEADERS.title]);
  const description = normalizeText(record[LINEAR_CSV_HEADERS.description]);

  const statusOptionId = parseLinearStatusOptionId({
    status: record[LINEAR_CSV_HEADERS.status],
    completed: record[LINEAR_CSV_HEADERS.completed],
    canceled: record[LINEAR_CSV_HEADERS.canceled],
    archived: record[LINEAR_CSV_HEADERS.archived],
  });

  const priorityOptionId = parseLinearPriority(
    record[LINEAR_CSV_HEADERS.priority]
  );

  const warnings: string[] = [];
  if (!title) warnings.push('Missing Title');

  const propertyValues: PropertyInput[] = [
    {
      propertyId: SYSTEM_PROPERTY_IDS.STATUS,
      value: {
        type: 'select_option',
        option_id: statusOptionId,
      },
    },
  ];

  if (priorityOptionId) {
    propertyValues.push({
      propertyId: SYSTEM_PROPERTY_IDS.PRIORITY,
      value: {
        type: 'select_option',
        option_id: priorityOptionId,
      },
    });
  }

  if (args.assigneeUserId) {
    propertyValues.push({
      propertyId: SYSTEM_PROPERTY_IDS.ASSIGNEES,
      value: {
        type: 'multi_entity_reference',
        references: [
          {
            entity_id: args.assigneeUserId,
            entity_type: EntityType.USER,
          },
        ],
      },
    });
  } else if (hasValue(record[LINEAR_CSV_HEADERS.assignee])) {
    warnings.push(
      `Assignee not mapped: ${record[LINEAR_CSV_HEADERS.assignee]}`
    );
  }

  const meta: string[] = [];
  const id = normalizeText(record[LINEAR_CSV_HEADERS.id]);
  const uuid = normalizeText(record[LINEAR_CSV_HEADERS.uuid]);
  const team = normalizeText(record[LINEAR_CSV_HEADERS.team]);
  const created = normalizeText(record[LINEAR_CSV_HEADERS.created]);
  const updated = normalizeText(record[LINEAR_CSV_HEADERS.updated]);
  const originalStatus = normalizeText(record[LINEAR_CSV_HEADERS.status]);
  const originalPriority = normalizeText(record[LINEAR_CSV_HEADERS.priority]);
  const completed = normalizeText(record[LINEAR_CSV_HEADERS.completed]);
  const canceled = normalizeText(record[LINEAR_CSV_HEADERS.canceled]);
  const archived = normalizeText(record[LINEAR_CSV_HEADERS.archived]);

  if (team) meta.push(`- Team: ${team}`);
  if (id) meta.push(`- Linear ID: ${id}`);
  if (uuid) meta.push(`- Linear UUID: ${uuid}`);
  if (originalStatus) meta.push(`- Linear Status: ${originalStatus}`);
  if (originalPriority) meta.push(`- Linear Priority: ${originalPriority}`);
  if (created) meta.push(`- Linear Created: ${created}`);
  if (updated) meta.push(`- Linear Updated: ${updated}`);
  if (completed) meta.push(`- Linear Completed: ${completed}`);
  if (canceled) meta.push(`- Linear Canceled: ${canceled}`);
  if (archived) meta.push(`- Linear Archived: ${archived}`);

  const content =
    meta.length > 0
      ? `${description}\n\n---\nImported from Linear\n${meta.join('\n')}`.trim()
      : description;

  return { title, content, propertyValues, warnings };
}
