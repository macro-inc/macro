import type { BlockAlias, BlockName } from '@core/block';
import {
  blockAcceptedFileExtensionSet,
  fileTypeToBlockName,
  isBlockAlias,
  itemToBlockName,
} from '@core/constant/allBlocks';
import { USE_WIDE_ICONS } from '@core/constant/featureFlags';
import type {
  ChannelEntity,
  DocumentEntity,
  EmailEntity,
  EntityData,
  ForeignEntity,
  NamedSubType,
  ReminderEntity,
} from '@entity';
import SkillIcon from '@icon/skill.svg';
import WideBook from '@icon/wide-book.svg';
import WideCsv from '@icon/wide-csv.svg';
import WideDiagram from '@icon/wide-diagram.svg';
import WideFileCode from '@icon/wide-file-code.svg';
import WideFileImage from '@icon/wide-file-image.svg';
import WideFiles from '@icon/wide-files.svg';
import WideSnippet from '@icon/wide-snippet.svg';
import WideUnknown from '@icon/wide-unknown.svg';
import WideVideo from '@icon/wide-video.svg';
import AlarmIcon from '@phosphor/alarm.svg';
import ArticleIcon from '@phosphor/article.svg';
import Building from '@phosphor/building.svg';
import BuildingsIcon from '@phosphor/buildings.svg';
import CalendarIcon from '@phosphor/calendar-blank.svg';
import ChatsIcon from '@phosphor/chats-circle.svg';
import FileCode from '@phosphor/code.svg';
import Email from '@phosphor/envelope.svg';
import EmailRead from '@phosphor/envelope-open.svg';
import File from '@phosphor/file.svg';
import FileArchive from '@phosphor/file-archive.svg';
import FileHtml from '@phosphor/file-html.svg';
import FilePdf from '@phosphor/file-pdf.svg';
import FileVideo from '@phosphor/file-video.svg';
import Files from '@phosphor/files.svg';
import Folder from '@phosphor/folder-simple.svg';
import GitMergeIcon from '@phosphor/git-merge.svg';
import GitPullRequestIcon from '@phosphor/git-pull-request.svg';
import HashIcon from '@phosphor/hash.svg';
import FileImage from '@phosphor/image.svg';
import LightningIcon from '@phosphor/lightning.svg';
import ListChecksIcon from '@phosphor/list-checks.svg';
import Canvas from '@phosphor/pencil-circle.svg';
import PhoneIcon from '@phosphor/phone.svg';
import SparkleIcon from '@phosphor/sparkle.svg';
import Users from '@phosphor/users.svg';
import type { PreviewItem } from '@queries/preview';
import type { ChannelType } from '@service-cognition/generated/schemas/channelType';
import { FileTypeMap } from '@service-storage/fileTypeMap';
import type { FileType } from '@service-storage/generated/schemas/fileType';
import { cn } from '@ui';
import type { Component, JSX } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { match } from 'ts-pattern';

type IconConfig = {
  icon: Component<JSX.SvgSVGAttributes<SVGSVGElement>>;
  foreground: string;
  background: string;
  prettyName: string;
};

export type EntityWithValidIcon =
  | BlockName
  | BlockAlias
  | ChannelType
  | 'organization'
  | 'default'
  | 'document'
  | 'sharedProject'
  | 'emailRead'
  | 'emailInvite'
  | 'githubPullRequest'
  | 'githubPullRequestOpen'
  | 'githubPullRequestMerged'
  | 'githubPullRequestClosed'
  | 'archive'
  | 'files'
  | 'crm_company'
  | 'html'
  | 'reminder';

const ARCHIVE_EXTENSIONS = new Set(
  Object.values(FileTypeMap)
    .filter((ft) => ft.app === 'archive')
    .map((ft) => ft.extension)
);

export const ENTITY_ICON_CONFIGS: Record<EntityWithValidIcon, IconConfig> = {
  document: {
    icon: ArticleIcon,
    foreground: 'text-default',
    background: 'bg-default/20',
    prettyName: 'Document',
  },
  call: {
    icon: PhoneIcon,
    foreground: 'text-default',
    background: 'bg-default/20',
    prettyName: 'Call',
  },
  calendar: {
    icon: CalendarIcon,
    foreground: 'text-default',
    background: 'bg-default/20',
    prettyName: 'Calendar',
  },
  canvas: {
    icon: Canvas,
    foreground: 'text-canvas',
    background: 'bg-canvas/20',
    prettyName: 'Canvas',
  },
  html: {
    icon: FileHtml,
    foreground: 'text-html',
    background: 'bg-html/20',
    prettyName: 'Webpage',
  },
  channel: {
    icon: HashIcon,
    foreground: 'text-default',
    background: 'bg-default/20',
    prettyName: 'Channel',
  },
  public: {
    icon: HashIcon,
    foreground: 'text-default',
    background: 'bg-default/20',
    prettyName: 'Public Channel',
  },
  organization: {
    icon: Building,
    foreground: 'text-default',
    background: 'bg-default/20',
    prettyName: 'Organization',
  },
  private: {
    icon: HashIcon,
    foreground: 'text-default',
    background: 'bg-default/20',
    prettyName: 'Private Channel',
  },
  direct_message: {
    icon: ChatsIcon,
    foreground: 'text-default',
    background: 'bg-default/20',
    prettyName: 'Direct Message',
  },
  team: {
    icon: HashIcon,
    foreground: 'text-default',
    background: 'bg-default/20',
    prettyName: 'Team Channel',
  },
  email: {
    icon: Email,
    foreground: 'text-email',
    background: 'bg-email/20',
    prettyName: 'Email',
  },
  code: {
    icon: FileCode,
    foreground: 'text-code',
    background: 'bg-code/20',
    prettyName: 'Code',
  },
  csv: {
    icon: WideCsv,
    foreground: 'text-code',
    background: 'bg-code/20',
    prettyName: 'CSV',
  },
  pdf: {
    icon: FilePdf,
    foreground: 'text-pdf',
    background: 'bg-pdf/20',
    prettyName: 'PDF',
  },
  md: {
    icon: ArticleIcon,
    foreground: 'text-note',
    background: 'bg-note/20',
    prettyName: 'Note',
  },
  image: {
    icon: FileImage,
    foreground: 'text-image',
    background: 'bg-image/20',
    prettyName: 'Image',
  },
  write: {
    icon: ArticleIcon,
    foreground: 'text-write',
    background: 'bg-write/20',
    prettyName: 'Document',
  },
  chat: {
    icon: SparkleIcon,
    foreground: 'text-chat',
    background: 'bg-chat/20',
    prettyName: 'Chat',
  },
  project: {
    icon: Folder,
    foreground: 'text-folder',
    background: 'bg-folder/20',
    prettyName: 'Folder',
  },
  sharedProject: {
    icon: Folder,
    foreground: 'text-folder',
    background: 'bg-folder/20',
    prettyName: 'Shared Folder',
  },
  unknown: {
    icon: File,
    foreground: 'text-default',
    background: 'bg-default/20',
    prettyName: 'File',
  },
  files: {
    icon: Files,
    foreground: 'text-default',
    background: 'bg-default/20',
    prettyName: 'Files',
  },
  archive: {
    icon: FileArchive,
    foreground: 'text-default',
    background: 'bg-default/20',
    prettyName: 'Archive',
  },
  video: {
    icon: FileVideo,
    foreground: 'text-video',
    background: 'bg-video/20',
    prettyName: 'Video',
  },
  contact: {
    icon: Users,
    foreground: 'text-default',
    background: 'bg-default/20',
    prettyName: 'Contact',
  },
  default: {
    icon: File,
    foreground: 'text-default',
    background: 'bg-default/20',
    prettyName: 'File',
  },
  emailRead: {
    icon: EmailRead,
    foreground: 'text-default',
    background: 'bg-default/20',
    prettyName: 'Read Email',
  },
  emailInvite: {
    icon: CalendarIcon,
    foreground: 'text-calendar',
    background: 'bg-calendar/20',
    prettyName: 'Calendar Invite',
  },
  githubPullRequest: {
    icon: GitPullRequestIcon,
    foreground: 'text-default',
    background: 'bg-default/20',
    prettyName: 'GitHub Pull Request',
  },
  githubPullRequestOpen: {
    icon: GitPullRequestIcon,
    foreground: 'text-success',
    background: 'bg-success/20',
    prettyName: 'Open Pull Request',
  },
  githubPullRequestMerged: {
    icon: GitMergeIcon,
    foreground: 'text-note',
    background: 'bg-note/20',
    prettyName: 'Merged Pull Request',
  },
  githubPullRequestClosed: {
    icon: GitPullRequestIcon,
    foreground: 'text-failure',
    background: 'bg-failure/20',
    prettyName: 'Closed Pull Request',
  },
  pr: {
    icon: GitPullRequestIcon,
    foreground: 'text-default',
    background: 'bg-default/20',
    prettyName: 'Pull Request',
  },
  agent: {
    icon: SparkleIcon,
    foreground: 'text-chat',
    background: 'bg-chat/20',
    prettyName: 'Agent',
  },
  task: {
    icon: ListChecksIcon,
    foreground: 'text-task',
    background: 'bg-task/20',
    prettyName: 'Task',
  },
  snippet: {
    icon: WideSnippet,
    foreground: 'text-snippet',
    background: 'bg-snippet/20',
    prettyName: 'Snippet',
  },
  skill: {
    icon: SkillIcon,
    foreground: 'text-chat',
    background: 'bg-chat/20',
    prettyName: 'Skill',
  },
  automation: {
    icon: LightningIcon,
    foreground: 'text-chat',
    background: 'bg-chat/20',
    prettyName: 'Automation',
  },
  crm_company: {
    icon: BuildingsIcon,
    foreground: 'text-default',
    background: 'bg-default/20',
    prettyName: 'Company',
  },
  company: {
    icon: BuildingsIcon,
    foreground: 'text-default',
    background: 'bg-default/20',
    prettyName: 'Company',
  },
  reminder: {
    icon: AlarmIcon,
    foreground: 'text-default',
    background: 'bg-default/20',
    prettyName: 'Reminder',
  },
};

// this will match fall-through cases like code files which match multiple extensions
// or docx files which no longer have their own block
function isFileType(ext: string): boolean {
  return blockAcceptedFileExtensionSet.has(ext);
}

// this lets us show a archive icon for certain files which still get mapped to block-unknown
export function isArchiveType(ext: string): boolean {
  return ARCHIVE_EXTENSIONS.has(ext as any);
}

function validateEntity(entity: string): EntityWithValidIcon {
  if (entity in ENTITY_ICON_CONFIGS) {
    return entity as EntityWithValidIcon;
  } else if (isBlockAlias(entity)) {
    return entity as EntityWithValidIcon;
  } else if (isFileType(entity)) {
    return fileTypeToBlockName(entity, true);
  } else if (isArchiveType(entity)) {
    return 'archive';
  } else {
    return 'default';
  }
}

// File-format icons retain their wide variants; entity glyphs live in the
// shared registry above so the feature flag cannot replace their mapping.
const WIDE_ICONS: Partial<
  Record<EntityWithValidIcon, Component<JSX.SvgSVGAttributes<SVGSVGElement>>>
> = {
  canvas: WideDiagram,
  html: WideFileCode,
  code: WideFileCode,
  pdf: WideBook,
  image: WideFileImage,
  unknown: WideUnknown,
  files: WideFiles,
  archive: WideUnknown,
  video: WideVideo,
  default: WideUnknown,
};

const ICON_SIZES = {
  xs: 'w-4 h-4',
  sm: 'w-4.5 h-4.5',
  md: 'w-8 h-8',
  lg: 'w-12 h-12',
  fill: 'w-full h-full',
  shrinkFill: 'w-full h-full',
} as const;

export const ICON_SIZE_CLASSES = {
  xs: `${ICON_SIZES.xs} flex items-center justify-center overflow-hidden shrink-0`,
  sm: `${ICON_SIZES.sm} flex items-center justify-center overflow-hidden shrink-0`,
  md: `${ICON_SIZES.md} flex items-center justify-center overflow-hidden shrink-0`,
  lg: `${ICON_SIZES.lg} flex items-center justify-center overflow-hidden shrink-0`,
  fill: `${ICON_SIZES.fill} flex items-center justify-center overflow-hidden shrink-0`,
  shrinkFill: `${ICON_SIZES.fill} flex items-center justify-center overflow-hidden`,
} as const;

export type EntityIconProps = {
  /**
   * Either the name of a block itself – like 'chat' or 'write' – or a file
   * type opened by a block – like 'py', 'pdf', etc. Or a set of known types
   * like 'directMessage; If an unrecognized type or no type at all is passed,
   * a default gray file icon will be used.
   */
  targetType?: FileType | EntityWithValidIcon;
  /**
   * The size of the Icon.
   * sm = "w-4 h-4"
   * md = "w-5 h-5"
   * lg = "w-8 h-8"
   * xl = "w-12 h-12"
   * fill = "w-fill h-fill"
   */
  size?: keyof typeof ICON_SIZE_CLASSES;
  theme?: 'monochrome';
  /**
   * Whether the item is shared. If true, certain icons will be rendered differently.
   */
  shared?: boolean;
  /**
   * Render the icon with a subtle background color?
   */
  useBackground?: boolean;
  class?: string;
};

export type EntityIconSelector = EntityIconProps['targetType'];

/**
 * Render one of a fixed set of style icons per entity type. Here Entity refers
 * to a union of block names, file types, and other soup-adjacent entities.
 */
export function EntityIcon(props: EntityIconProps) {
  const getName = () => {
    // Special cases:
    if (props.targetType === 'project' && props.shared) return 'sharedProject';
    return validateEntity(props.targetType || 'default');
  };

  const config = () => getIconConfig(getName());
  const sizeClass = () => ICON_SIZE_CLASSES[props.size ?? 'xs'];
  const isMonochrome = () => props.theme === 'monochrome';

  return (
    <div
      class={cn(
        sizeClass(),
        isMonochrome() ? 'text-current' : config().foreground,
        props.useBackground && config().background,
        props.useBackground && 'p-[20%]',
        props.class
      )}
    >
      {/* size-full: Safari needs a CSS size, not the SVG's % attributes. */}
      <Dynamic component={config().icon} class="size-full" />
    </div>
  );
}

export function CustomEntityIcon(
  props: EntityIconProps & {
    icon?: Component<JSX.SvgSVGAttributes<SVGSVGElement>>;
  }
) {
  const config = () =>
    ENTITY_ICON_CONFIGS[validateEntity(props.targetType || 'default')];
  const sizeClass = () => ICON_SIZE_CLASSES[props.size ?? 'xs'];
  const isMonochrome = () => props.theme === 'monochrome';
  return (
    <div
      class={sizeClass()}
      classList={{
        'text-current': isMonochrome(),
        [config().foreground]: !isMonochrome(),
        [config().background]: props.useBackground && !isMonochrome(),
        [config().background]: props.useBackground && isMonochrome(),
        'p-[20%]': props.useBackground,
      }}
    >
      {/* size-full: see EntityIcon (Safari). */}
      <Dynamic component={props.icon || config().icon} class="size-full" />
    </div>
  );
}

export function getIconConfig(
  targetType: EntityWithValidIcon | FileType | (string & {})
) {
  const key = validateEntity(targetType);
  const config = { ...ENTITY_ICON_CONFIGS[key] };
  if (USE_WIDE_ICONS) {
    config.icon = WIDE_ICONS[key] ?? config.icon;
  }
  return config;
}

type EntityIconData = Pick<EntityData, 'type'> & {
  channelType?: ChannelEntity['channelType'];
  fileType?: DocumentEntity['fileType'] | null;
  subType?: DocumentEntity['subType'];
  isRead?: EmailEntity['isRead'];
  hasIcsAttachment?: EmailEntity['hasIcsAttachment'];
  foreignSource?: ForeignEntity['foreignSource'];
  metadata?: ForeignEntity['metadata'];
  /** Reference metadata carried by reminder entities. */
  referencedEntity?: ReminderEntity['referencedEntity'];
};

/** The shared entity-to-icon mapping used by lists, previews, and drag images. */
export function getEntityIconType(entity: EntityIconData): EntityWithValidIcon {
  return match<EntityIconData, EntityWithValidIcon>(entity)
    .with({ type: 'document' }, (e) => {
      if (e.subType?.type === 'task') return 'task';
      if (e.fileType && isArchiveType(e.fileType)) return 'archive';
      const blockName = itemToBlockName(e, true);
      return blockName === 'unknown' ? 'document' : blockName;
    })
    .with(
      { type: 'channel' },
      { type: 'channel_message' },
      { type: 'channel_thread' },
      (e) => (e.channelType === 'direct_message' ? 'direct_message' : 'channel')
    )
    .with({ type: 'email' }, (e) =>
      e.hasIcsAttachment ? 'emailInvite' : e.isRead ? 'emailRead' : 'email'
    )
    .with({ type: 'chat' }, () => 'chat')
    .with({ type: 'agent_session' }, () => 'agent')
    .with({ type: 'project' }, () => 'project')
    .with({ type: 'calendar_event' }, () => 'calendar')
    .with({ type: 'reminder' }, () => 'reminder')
    .with({ type: 'call' }, () => 'call')
    .with({ type: 'automation' }, () => 'automation')
    .with({ type: 'foreign' }, (e) => {
      if (e.foreignSource !== 'github_pull_request') return 'default';
      return match<unknown, EntityWithValidIcon>(e.metadata?.status)
        .with('open', () => 'githubPullRequestOpen')
        .with('merged', () => 'githubPullRequestMerged')
        .with('closed', () => 'githubPullRequestClosed')
        .otherwise(() => 'githubPullRequest');
    })
    .with({ type: 'crm_company' }, () => 'crm_company')
    .with({ type: 'crm_contact' }, () => 'contact')
    .exhaustive();
}

/** What the block resolvers return when they cannot place something. */
const UNRESOLVED_ICONS: ReadonlySet<string> = new Set(['default', 'unknown']);

/**
 * The icon for what a reminder is about, shown beside the reminder's name.
 *
 * Synchronous by design: the referenced entity's `fileType`/`subType` are
 * resolved server-side precisely so this costs no fetch per row.
 *
 * A reference that resolves to nothing gets the reminder icon, not the unknown-file
 * glyph, which on a reminder row reads as breakage rather than as a reminder.
 * That needs both sentinels and neither is falsy: `fileTypeToBlockName`
 * returns the literal `unknown`, and `validateEntity` returns `default`.
 */
export function reminderReferenceIconType(
  reference: NonNullable<ReminderEntity['referencedEntity']>
): EntityWithValidIcon {
  const blockName = itemToBlockName(
    {
      type: reference.type,
      fileType: reference.fileType,
      subType: reference.subType
        ? { type: reference.subType as NamedSubType }
        : undefined,
    },
    true
  );

  const iconType = blockName ? validateEntity(blockName) : 'default';
  return UNRESOLVED_ICONS.has(iconType) ? 'reminder' : iconType;
}

export function getEntityIconConfig(entity: EntityData) {
  return getIconConfig(getEntityIconType(entity));
}

export function getPreviewItemIconType(item: PreviewItem): EntityWithValidIcon {
  if (item.loading || item.access !== 'access') {
    return 'default';
  }

  return getEntityIconType(item);
}
