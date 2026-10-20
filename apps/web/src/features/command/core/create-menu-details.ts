import { type TranslationKey, t } from '@app/lib/i18n';
import type { CreatableBlock } from '../types';
import { creatableDescription, creatableId } from './creatable';

export type CreateMenuGroupId =
  | 'docs'
  | 'organization'
  | 'design'
  | 'data'
  | 'comms'
  | 'tasks'
  | 'ai'
  | 'other';

export type CreateMenuGroup = {
  id: CreateMenuGroupId | 'recent';
  label: string;
  tagline: string;
};

/** Group headings; ids stay English, the getters translate on read. */
export const CREATE_MENU_GROUPS: readonly CreateMenuGroup[] = [
  group('docs', 'create.groupDocsLabel', 'create.groupDocsTagline'),
  group(
    'organization',
    'create.groupOrganizationLabel',
    'create.groupOrganizationTagline'
  ),
  group('design', 'create.groupDesignLabel', 'create.groupDesignTagline'),
  group('data', 'create.groupDataLabel', 'create.groupDataTagline'),
  group('comms', 'create.groupCommsLabel', 'create.groupCommsTagline'),
  group('tasks', 'create.groupTasksLabel', 'create.groupTasksTagline'),
  group('ai', 'create.groupAiLabel', 'create.groupAiTagline'),
  group('other', 'create.groupOtherLabel', 'create.groupOtherTagline'),
];

function group(
  id: CreateMenuGroup['id'],
  label: TranslationKey,
  tagline: TranslationKey
): CreateMenuGroup {
  return {
    id,
    get label() {
      return t(label);
    },
    get tagline() {
      return t(tagline);
    },
  };
}

export type CreateMenuDetails = {
  group: CreateMenuGroupId;
  /** One line under the title: what the thing actually is. */
  tagline: string;
  /** A 10–20-word description for the detailed launcher. */
  details: string;
  /** Things people typically make with it. */
  examples: readonly string[];
};

/** Catalog entry whose display text is translated each time it is read. */
function details(
  groupId: CreateMenuGroupId,
  tagline: TranslationKey,
  description: TranslationKey,
  examples: readonly TranslationKey[]
): CreateMenuDetails {
  return {
    group: groupId,
    get tagline() {
      return t(tagline);
    },
    get details() {
      return t(description);
    },
    get examples() {
      return examples.map((key) => t(key));
    },
  };
}

/**
 * Keyed by the creatable's stable English id ({@link creatableId}) rather
 * than block name: Message and Channel share the `channel` block, and the two
 * Agent entries (one per agents flag) are never both shown.
 */
const DETAILS: Record<string, CreateMenuDetails> = {
  Document: details(
    'docs',
    'create.documentTagline',
    'create.documentDetails',
    [
      'create.documentExample1',
      'create.documentExample2',
      'create.documentExample3',
    ]
  ),
  Snippet: details('docs', 'create.snippetTagline', 'create.snippetDetails', [
    'create.snippetExample1',
    'create.snippetExample2',
    'create.snippetExample3',
  ]),
  Code: details('other', 'create.codeTagline', 'create.codeDetails', [
    'create.codeExample1',
    'create.codeExample2',
    'create.codeExample3',
  ]),
  Folder: details(
    'organization',
    'create.folderTagline',
    'create.folderDetails',
    ['create.folderExample1', 'create.folderExample2', 'create.folderExample3']
  ),
  Canvas: details('design', 'create.canvasTagline', 'create.canvasDetails', [
    'create.canvasExample1',
    'create.canvasExample2',
    'create.canvasExample3',
  ]),
  Design: details('design', 'create.designTagline', 'create.designDetails', [
    'create.designExample1',
    'create.designExample2',
    'create.designExample3',
  ]),
  Database: details(
    'data',
    'create.databaseTagline',
    'create.databaseDetails',
    [
      'create.databaseExample1',
      'create.databaseExample2',
      'create.databaseExample3',
    ]
  ),
  Spreadsheet: details(
    'data',
    'create.spreadsheetTagline',
    'create.spreadsheetDetails',
    [
      'create.spreadsheetExample1',
      'create.spreadsheetExample2',
      'create.spreadsheetExample3',
    ]
  ),
  Form: details('data', 'create.formTagline', 'create.formDetails', [
    'create.formExample1',
    'create.formExample2',
    'create.formExample3',
  ]),
  'Photoshop file': details(
    'design',
    'create.photoshopTagline',
    'create.photoshopDetails',
    [
      'create.photoshopExample1',
      'create.photoshopExample2',
      'create.photoshopExample3',
    ]
  ),
  'Illustrator file': details(
    'design',
    'create.illustratorTagline',
    'create.illustratorDetails',
    [
      'create.illustratorExample1',
      'create.illustratorExample2',
      'create.illustratorExample3',
    ]
  ),
  Email: details('comms', 'create.emailTagline', 'create.emailDetails', [
    'create.emailExample1',
    'create.emailExample2',
    'create.emailExample3',
  ]),
  Message: details('comms', 'create.messageTagline', 'create.messageDetails', [
    'create.messageExample1',
    'create.messageExample2',
    'create.messageExample3',
  ]),
  Channel: details('comms', 'create.channelTagline', 'create.channelDetails', [
    'create.channelExample1',
    'create.channelExample2',
    'create.channelExample3',
  ]),
  Call: details('comms', 'create.callTagline', 'create.callDetails', [
    'create.callExample1',
    'create.callExample2',
    'create.callExample3',
  ]),
  Task: details('tasks', 'create.taskTagline', 'create.taskDetails', [
    'create.taskExample1',
    'create.taskExample2',
    'create.taskExample3',
  ]),
  Project: details('tasks', 'create.projectTagline', 'create.projectDetails', [
    'create.projectExample1',
    'create.projectExample2',
    'create.projectExample3',
  ]),
  Reminder: details(
    'tasks',
    'create.reminderTagline',
    'create.reminderDetails',
    [
      'create.reminderExample1',
      'create.reminderExample2',
      'create.reminderExample3',
    ]
  ),
  Agent: details('ai', 'create.agentTagline', 'create.agentDetails', [
    'create.agentExample1',
    'create.agentExample2',
    'create.agentExample3',
  ]),
  Routine: details('ai', 'create.routineTagline', 'create.routineDetails', [
    'create.routineExample1',
    'create.routineExample2',
    'create.routineExample3',
  ]),
  Skill: details('ai', 'create.skillTagline', 'create.skillDetails', [
    'create.skillExample1',
    'create.skillExample2',
    'create.skillExample3',
  ]),
};

export function createMenuDetails(
  item: CreatableBlock
): CreateMenuDetails | undefined {
  return DETAILS[creatableId(item)];
}

/** The one-line description a variant shows under the title. */
export function createMenuTagline(item: CreatableBlock): string {
  return (
    createMenuDetails(item)?.tagline ??
    item.launcherHint ??
    creatableDescription(item)
  );
}

/** Extra text that search should match on, beyond the block's own fields. */
export function createMenuSearchText(item: CreatableBlock): string[] {
  const details = createMenuDetails(item);
  if (!details) return [];
  const group = CREATE_MENU_GROUPS.find((g) => g.id === details.group);
  return [
    details.tagline,
    details.details,
    ...details.examples,
    group?.label,
  ].filter((text): text is string => !!text);
}

export type CreateMenuSection = {
  group: CreateMenuGroup;
  items: CreatableBlock[];
};

/** Splits items into the fixed groups, keeping each group's catalog order. */
export function groupCreateMenuItems(
  items: readonly CreatableBlock[]
): CreateMenuSection[] {
  const order = Object.keys(DETAILS);
  const rank = (item: CreatableBlock) => {
    const index = order.indexOf(creatableId(item));
    return index === -1 ? order.length : index;
  };

  const sections = CREATE_MENU_GROUPS.map((group) => ({
    group,
    items: items
      .filter(
        (item) => (createMenuDetails(item)?.group ?? 'other') === group.id
      )
      .sort((a, b) => rank(a) - rank(b)),
  }));
  return sections.filter((section) => section.items.length > 0);
}

/** Recent choices appear first and remain available in their categories. */
export function groupRecentCreateMenuItems(
  items: CreatableBlock[],
  recentItems: CreatableBlock[]
): CreateMenuSection[] {
  const recent = recentItems.filter((item) => items.includes(item));
  const categories = groupCreateMenuItems(items);
  return recent.length
    ? [
        {
          group: {
            id: 'recent',
            label: t('create.groupRecentLabel'),
            tagline: t('create.groupRecentTagline'),
          },
          items: recent,
        },
        ...categories,
      ]
    : categories;
}

/** Two-to-four word captions for compact cards. */
const SHORT_TAGLINES: Record<string, TranslationKey> = {
  Document: 'create.documentShortTagline',
  Snippet: 'create.snippetShortTagline',
  Code: 'create.codeShortTagline',
  Folder: 'create.folderShortTagline',
  Canvas: 'create.canvasShortTagline',
  Design: 'create.designShortTagline',
  Spreadsheet: 'create.spreadsheetShortTagline',
  Database: 'create.databaseShortTagline',
  Email: 'create.emailShortTagline',
  Message: 'create.messageShortTagline',
  Channel: 'create.channelShortTagline',
  Call: 'create.callShortTagline',
  Task: 'create.taskShortTagline',
  Project: 'create.projectShortTagline',
  Reminder: 'create.reminderShortTagline',
  Agent: 'create.agentShortTagline',
  Routine: 'create.routineShortTagline',
  Skill: 'create.skillShortTagline',
  Form: 'create.formTagline',
  'Photoshop file': 'create.photoshopTagline',
  'Illustrator file': 'create.illustratorTagline',
};

export function createMenuShortTagline(item: CreatableBlock): string {
  const key = SHORT_TAGLINES[creatableId(item)];
  return key ? t(key) : createMenuTagline(item);
}
