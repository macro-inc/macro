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
  NamedSubType,
  ReminderEntity,
} from '@entity';
import GithubIcon from '@icon/mcp-github.svg';
import SkillIcon from '@icon/skill.svg';
import WideAutomation from '@icon/wide-automation.svg';
import WideBook from '@icon/wide-book.svg';
import WideCalendar from '@icon/wide-calendar.svg';
import PhoneCall from '@icon/wide-call.svg';
import WideChannel from '@icon/wide-channel.svg';
import WideChat from '@icon/wide-chat.svg';
import { AnimatedCompanyIcon } from '@icon/wide-company';
import { AnimatedContactIcon } from '@icon/wide-contact';
import WideCsv from '@icon/wide-csv.svg';
import WideDiagram from '@icon/wide-diagram.svg';
import WideDocx from '@icon/wide-docx.svg';
import WideEmail from '@icon/wide-email.svg';
import WideFileCode from '@icon/wide-file-code.svg';
import WideFileImage from '@icon/wide-file-image.svg';
import WideFileMd from '@icon/wide-file-md.svg';
import WideFiles from '@icon/wide-files.svg';
import WideFolder from '@icon/wide-folder.svg';
import WideGlobe from '@icon/wide-globe.svg';
import WideSnippet from '@icon/wide-snippet.svg';
import WideStar from '@icon/wide-star.svg';
import WideTask from '@icon/wide-task.svg';
import WideUnknown from '@icon/wide-unknown.svg';
import WideVideo from '@icon/wide-video.svg';
import BellSimple from '@phosphor/bell-simple.svg';
import Building from '@phosphor/building.svg';
import Chat from '@phosphor/chat.svg';
import Check from '@phosphor/check-fat.svg';
import FileCode from '@phosphor/code.svg';
import Email from '@phosphor/envelope.svg';
import EmailRead from '@phosphor/envelope-open.svg';
import File from '@phosphor/file.svg';
import FileArchive from '@phosphor/file-archive.svg';
import FileDoc from '@phosphor/file-doc.svg';
import FileHtml from '@phosphor/file-html.svg';
import FileMd from '@phosphor/file-md.svg';
import FilePdf from '@phosphor/file-pdf.svg';
import FileVideo from '@phosphor/file-video.svg';
import Files from '@phosphor/files.svg';
import Folder from '@phosphor/folder-simple.svg';
import FolderUser from '@phosphor/folder-user.svg';
import GlobeIcon from '@phosphor/globe.svg';
import FileImage from '@phosphor/image.svg';
import Canvas from '@phosphor/pencil-circle.svg';
import Robot from '@phosphor/robot.svg';
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
  | 'sharedProject'
  | 'emailRead'
  | 'emailInvite'
  | 'githubPullRequest'
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
  call: {
    icon: PhoneCall,
    foreground: 'text-default',
    background: 'bg-default/20',
    prettyName: 'Call',
  },
  calendar: {
    icon: WideCalendar,
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
    icon: WideChannel,
    foreground: 'text-default',
    background: 'bg-default/20',
    prettyName: 'Channel',
  },
  public: {
    icon: GlobeIcon,
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
    icon: WideChannel,
    foreground: 'text-default',
    background: 'bg-default/20',
    prettyName: 'Private Channel',
  },
  direct_message: {
    icon: Users,
    foreground: 'text-default',
    background: 'bg-default/20',
    prettyName: 'Direct Message',
  },
  team: {
    icon: Users,
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
    icon: FileMd,
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
    icon: FileDoc,
    foreground: 'text-write',
    background: 'bg-write/20',
    prettyName: 'Document',
  },
  chat: {
    icon: Chat,
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
    icon: FolderUser,
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
    icon: AnimatedContactIcon,
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
    icon: WideCalendar,
    foreground: 'text-calendar',
    background: 'bg-calendar/20',
    prettyName: 'Calendar Invite',
  },
  githubPullRequest: {
    icon: GithubIcon,
    foreground: 'text-default',
    background: 'bg-default/20',
    prettyName: 'GitHub Pull Request',
  },
  pr: {
    icon: GithubIcon,
    foreground: 'text-default',
    background: 'bg-default/20',
    prettyName: 'Pull Request',
  },
  agent: {
    icon: Robot,
    foreground: 'text-default',
    background: 'bg-default/20',
    prettyName: 'Agent',
  },
  task: {
    icon: Check,
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
    icon: WideAutomation,
    foreground: 'text-chat',
    background: 'bg-chat/20',
    prettyName: 'Automation',
  },
  crm_company: {
    icon: AnimatedCompanyIcon,
    foreground: 'text-default',
    background: 'bg-default/20',
    prettyName: 'Company',
  },
  company: {
    icon: AnimatedCompanyIcon,
    foreground: 'text-default',
    background: 'bg-default/20',
    prettyName: 'Company',
  },
  reminder: {
    icon: BellSimple,
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

const WIDE_ICONS: Record<
  EntityWithValidIcon,
  Component<JSX.SvgSVGAttributes<SVGSVGElement>>
> = {
  call: PhoneCall,
  calendar: WideCalendar,
  canvas: WideDiagram,
  html: WideFileCode,
  channel: WideChannel,
  public: WideGlobe,
  organization: Building,
  private: WideChannel,
  direct_message: WideChat,
  team: WideChannel,
  email: WideEmail,
  code: WideFileCode,
  csv: WideCsv,
  pdf: WideBook,
  md: WideFileMd,
  image: WideFileImage,
  write: WideDocx,
  chat: WideStar,
  project: WideFolder,
  sharedProject: WideFolder,
  unknown: WideUnknown,
  files: WideFiles,
  archive: WideUnknown,
  video: WideVideo,
  contact: AnimatedContactIcon,
  default: WideUnknown,
  emailRead: WideEmail,
  emailInvite: WideCalendar,
  githubPullRequest: GithubIcon,
  pr: GithubIcon,
  agent: Robot,
  task: WideTask,
  snippet: WideSnippet,
  skill: SkillIcon,
  automation: WideAutomation,
  crm_company: AnimatedCompanyIcon,
  company: AnimatedCompanyIcon,
  // No wide bell asset exists; the phosphor one carries over, as it does for
  // `organization` and the github icons.
  reminder: BellSimple,
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

  const config = () => ENTITY_ICON_CONFIGS[getName()];
  const icon = () => {
    if (USE_WIDE_ICONS) {
      return WIDE_ICONS[getName()];
    } else {
      return config().icon;
    }
  };
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
      <Dynamic component={icon()} class="size-full" />
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
    config.icon = WIDE_ICONS[key];
  }
  return config;
}

type EntityIconData = Pick<EntityData, 'type'> & {
  channelType?: ChannelEntity['channelType'];
  fileType?: DocumentEntity['fileType'] | null;
  subType?: DocumentEntity['subType'];
  isRead?: EmailEntity['isRead'];
  /** Reminders icon as the entity they reference. */
  referencedEntity?: ReminderEntity['referencedEntity'];
};

export function getEntityIconType(entity: EntityIconData): EntityWithValidIcon {
  const typeString = match(entity)
    .with({ type: 'channel' }, (e) => e.channelType || 'channel')
    .with({ type: 'channel_message' }, (e) => e.channelType || 'channel')
    .with({ type: 'document' }, (e) => itemToBlockName(e, true) ?? 'default')
    .with({ type: 'email', isRead: true }, () => 'emailRead')
    .with({ type: 'email' }, () => 'email')
    // Always the bell, never the referenced entity's icon: a reminder is a
    // reminder first, and what it points at is iconed beside its name instead
    // — see `reminderReferenceIconType`.
    .with({ type: 'reminder' }, () => 'reminder')
    .with({ type: 'calendar_event' }, () => 'calendar')
    .otherwise((e) => e.type);

  return validateEntity(typeString);
}

/** What the block resolvers return when they cannot place something. */
const UNRESOLVED_ICONS: ReadonlySet<string> = new Set(['default', 'unknown']);

/**
 * The icon for what a reminder is about, shown beside the reminder's name.
 *
 * Synchronous by design: the referenced entity's `fileType`/`subType` are
 * resolved server-side precisely so this costs no fetch per row.
 *
 * A reference that resolves to nothing gets the bell, not the unknown-file
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
