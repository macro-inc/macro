import type { BlockAlias, BlockName } from '@core/block';
import {
  blockAcceptedFileExtensionSet,
  fileTypeToBlockName,
  isBlockAlias,
  itemToBlockName,
} from '@core/constant/allBlocks';
import type {
  ChannelEntity,
  DocumentEntity,
  EmailEntity,
  EntityData,
  ForeignEntity,
  NamedSubType,
  ReminderEntity,
} from '@entity';
import Spreadsheet from '@icon/wide-spreadsheet.svg';
import SpreadsheetBold from '@icon/wide-spreadsheet-bold.svg';
import AddressBook from '@phosphor/address-book.svg';
import BellSimple from '@phosphor/bell-simple.svg';
import Blueprint from '@phosphor/blueprint.svg';
import BracketsCurly from '@phosphor/brackets-curly.svg';
import Building from '@phosphor/building.svg';
import BuildingOffice from '@phosphor/building-office.svg';
import Calendar from '@phosphor/calendar.svg';
import ClockClockwise from '@phosphor/clock-clockwise.svg';
import Code from '@phosphor/code.svg';
import Email from '@phosphor/envelope.svg';
import EmailRead from '@phosphor/envelope-open.svg';
import File from '@phosphor/file.svg';
import FileArchive from '@phosphor/file-archive.svg';
import FileCsv from '@phosphor/file-csv.svg';
import FileDashed from '@phosphor/file-dashed.svg';
import FileDoc from '@phosphor/file-doc.svg';
import FileHtml from '@phosphor/file-html.svg';
import FilePdf from '@phosphor/file-pdf.svg';
import FileVideo from '@phosphor/file-video.svg';
import Files from '@phosphor/files.svg';
import Folder from '@phosphor/folder-simple.svg';
import FolderUser from '@phosphor/folder-simple-user.svg';
import GitMerge from '@phosphor/git-merge.svg';
import GitPullRequest from '@phosphor/git-pull-request.svg';
import GlobeIcon from '@phosphor/globe.svg';
import HashStraight from '@phosphor/hash-straight.svg';
import FileImage from '@phosphor/image.svg';
import ListChecks from '@phosphor/list-checks.svg';
import PhoneCall from '@phosphor/phone-call.svg';
import Shapes from '@phosphor/shapes.svg';
import Sparkle from '@phosphor/sparkle.svg';
import Users from '@phosphor/users.svg';
import UsersThree from '@phosphor/users-three.svg';
import AddressBookBold from '@phosphor-icons/core/bold/address-book-bold.svg';
import BellSimpleBold from '@phosphor-icons/core/bold/bell-simple-bold.svg';
import BlueprintBold from '@phosphor-icons/core/bold/blueprint-bold.svg';
import BracketsCurlyBold from '@phosphor-icons/core/bold/brackets-curly-bold.svg';
import BuildingBold from '@phosphor-icons/core/bold/building-bold.svg';
import BuildingOfficeBold from '@phosphor-icons/core/bold/building-office-bold.svg';
import CalendarBold from '@phosphor-icons/core/bold/calendar-bold.svg';
import ClockClockwiseBold from '@phosphor-icons/core/bold/clock-clockwise-bold.svg';
import CodeBold from '@phosphor-icons/core/bold/code-bold.svg';
import EmailBold from '@phosphor-icons/core/bold/envelope-bold.svg';
import EmailReadBold from '@phosphor-icons/core/bold/envelope-open-bold.svg';
import FileArchiveBold from '@phosphor-icons/core/bold/file-archive-bold.svg';
import FileBold from '@phosphor-icons/core/bold/file-bold.svg';
import FileCsvBold from '@phosphor-icons/core/bold/file-csv-bold.svg';
import FileDashedBold from '@phosphor-icons/core/bold/file-dashed-bold.svg';
import FileDocBold from '@phosphor-icons/core/bold/file-doc-bold.svg';
import FileHtmlBold from '@phosphor-icons/core/bold/file-html-bold.svg';
import FilePdfBold from '@phosphor-icons/core/bold/file-pdf-bold.svg';
import FileVideoBold from '@phosphor-icons/core/bold/file-video-bold.svg';
import FilesBold from '@phosphor-icons/core/bold/files-bold.svg';
import FolderBold from '@phosphor-icons/core/bold/folder-simple-bold.svg';
import FolderUserBold from '@phosphor-icons/core/bold/folder-simple-user-bold.svg';
import GitMergeBold from '@phosphor-icons/core/bold/git-merge-bold.svg';
import GitPullRequestBold from '@phosphor-icons/core/bold/git-pull-request-bold.svg';
import GlobeIconBold from '@phosphor-icons/core/bold/globe-bold.svg';
import HashStraightBold from '@phosphor-icons/core/bold/hash-straight-bold.svg';
import FileImageBold from '@phosphor-icons/core/bold/image-bold.svg';
import ListChecksBold from '@phosphor-icons/core/bold/list-checks-bold.svg';
import PhoneCallBold from '@phosphor-icons/core/bold/phone-call-bold.svg';
import ShapesBold from '@phosphor-icons/core/bold/shapes-bold.svg';
import SparkleBold from '@phosphor-icons/core/bold/sparkle-bold.svg';
import UsersBold from '@phosphor-icons/core/bold/users-bold.svg';
import UsersThreeBold from '@phosphor-icons/core/bold/users-three-bold.svg';
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
  boldIcon: Component<JSX.SvgSVGAttributes<SVGSVGElement>>;
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
    icon: File,
    boldIcon: FileBold,
    foreground: 'text-default',
    background: 'bg-default/20',
    prettyName: 'Document',
  },
  call: {
    icon: PhoneCall,
    boldIcon: PhoneCallBold,
    foreground: 'text-default',
    background: 'bg-default/20',
    prettyName: 'Call',
  },
  calendar: {
    icon: Calendar,
    boldIcon: CalendarBold,
    foreground: 'text-default',
    background: 'bg-default/20',
    prettyName: 'Calendar',
  },
  canvas: {
    icon: Shapes,
    boldIcon: ShapesBold,
    foreground: 'text-canvas',
    background: 'bg-canvas/20',
    prettyName: 'Canvas',
  },
  spreadsheet: {
    icon: Spreadsheet,
    boldIcon: SpreadsheetBold,
    foreground: 'text-success',
    background: 'bg-success/20',
    prettyName: 'Spreadsheet',
  },
  html: {
    icon: FileHtml,
    boldIcon: FileHtmlBold,
    foreground: 'text-html',
    background: 'bg-html/20',
    prettyName: 'Webpage',
  },
  channel: {
    icon: HashStraight,
    boldIcon: HashStraightBold,
    foreground: 'text-default',
    background: 'bg-default/20',
    prettyName: 'Channel',
  },
  public: {
    icon: GlobeIcon,
    boldIcon: GlobeIconBold,
    foreground: 'text-default',
    background: 'bg-default/20',
    prettyName: 'Public Channel',
  },
  organization: {
    icon: Building,
    boldIcon: BuildingBold,
    foreground: 'text-default',
    background: 'bg-default/20',
    prettyName: 'Organization',
  },
  private: {
    icon: HashStraight,
    boldIcon: HashStraightBold,
    foreground: 'text-default',
    background: 'bg-default/20',
    prettyName: 'Private Channel',
  },
  direct_message: {
    icon: Users,
    boldIcon: UsersBold,
    foreground: 'text-default',
    background: 'bg-default/20',
    prettyName: 'Direct Message',
  },
  team: {
    icon: UsersThree,
    boldIcon: UsersThreeBold,
    foreground: 'text-default',
    background: 'bg-default/20',
    prettyName: 'Team Channel',
  },
  email: {
    icon: Email,
    boldIcon: EmailBold,
    foreground: 'text-email',
    background: 'bg-email/20',
    prettyName: 'Email',
  },
  code: {
    icon: Code,
    boldIcon: CodeBold,
    foreground: 'text-code',
    background: 'bg-code/20',
    prettyName: 'Code',
  },
  csv: {
    icon: FileCsv,
    boldIcon: FileCsvBold,
    foreground: 'text-code',
    background: 'bg-code/20',
    prettyName: 'CSV',
  },
  pdf: {
    icon: FilePdf,
    boldIcon: FilePdfBold,
    foreground: 'text-pdf',
    background: 'bg-pdf/20',
    prettyName: 'PDF',
  },
  md: {
    icon: File,
    boldIcon: FileBold,
    foreground: 'text-note',
    background: 'bg-note/20',
    prettyName: 'Note',
  },
  image: {
    icon: FileImage,
    boldIcon: FileImageBold,
    foreground: 'text-image',
    background: 'bg-image/20',
    prettyName: 'Image',
  },
  write: {
    icon: FileDoc,
    boldIcon: FileDocBold,
    foreground: 'text-write',
    background: 'bg-write/20',
    prettyName: 'Document',
  },
  chat: {
    icon: Sparkle,
    boldIcon: SparkleBold,
    foreground: 'text-chat',
    background: 'bg-chat/20',
    prettyName: 'Chat',
  },
  project: {
    icon: Folder,
    boldIcon: FolderBold,
    foreground: 'text-folder',
    background: 'bg-folder/20',
    prettyName: 'Folder',
  },
  sharedProject: {
    icon: FolderUser,
    boldIcon: FolderUserBold,
    foreground: 'text-folder',
    background: 'bg-folder/20',
    prettyName: 'Shared Folder',
  },
  unknown: {
    icon: FileDashed,
    boldIcon: FileDashedBold,
    foreground: 'text-default',
    background: 'bg-default/20',
    prettyName: 'File',
  },
  files: {
    icon: Files,
    boldIcon: FilesBold,
    foreground: 'text-default',
    background: 'bg-default/20',
    prettyName: 'Files',
  },
  archive: {
    icon: FileArchive,
    boldIcon: FileArchiveBold,
    foreground: 'text-default',
    background: 'bg-default/20',
    prettyName: 'Archive',
  },
  video: {
    icon: FileVideo,
    boldIcon: FileVideoBold,
    foreground: 'text-video',
    background: 'bg-video/20',
    prettyName: 'Video',
  },
  contact: {
    icon: AddressBook,
    boldIcon: AddressBookBold,
    foreground: 'text-default',
    background: 'bg-default/20',
    prettyName: 'Contact',
  },
  default: {
    icon: FileDashed,
    boldIcon: FileDashedBold,
    foreground: 'text-default',
    background: 'bg-default/20',
    prettyName: 'File',
  },
  emailRead: {
    icon: EmailRead,
    boldIcon: EmailReadBold,
    foreground: 'text-default',
    background: 'bg-default/20',
    prettyName: 'Read Email',
  },
  emailInvite: {
    icon: Calendar,
    boldIcon: CalendarBold,
    foreground: 'text-calendar',
    background: 'bg-calendar/20',
    prettyName: 'Calendar Invite',
  },
  githubPullRequest: {
    icon: GitPullRequest,
    boldIcon: GitPullRequestBold,
    foreground: 'text-default',
    background: 'bg-default/20',
    prettyName: 'GitHub Pull Request',
  },
  githubPullRequestOpen: {
    icon: GitPullRequest,
    boldIcon: GitPullRequestBold,
    foreground: 'text-success',
    background: 'bg-success/20',
    prettyName: 'Open Pull Request',
  },
  githubPullRequestMerged: {
    icon: GitMerge,
    boldIcon: GitMergeBold,
    foreground: 'text-note',
    background: 'bg-note/20',
    prettyName: 'Merged Pull Request',
  },
  githubPullRequestClosed: {
    icon: GitPullRequest,
    boldIcon: GitPullRequestBold,
    foreground: 'text-failure',
    background: 'bg-failure/20',
    prettyName: 'Closed Pull Request',
  },
  pr: {
    icon: GitPullRequest,
    boldIcon: GitPullRequestBold,
    foreground: 'text-default',
    background: 'bg-default/20',
    prettyName: 'Pull Request',
  },
  agent: {
    icon: Sparkle,
    boldIcon: SparkleBold,
    foreground: 'text-chat',
    background: 'bg-chat/20',
    prettyName: 'Agent',
  },
  task: {
    icon: ListChecks,
    boldIcon: ListChecksBold,
    foreground: 'text-task',
    background: 'bg-task/20',
    prettyName: 'Task',
  },
  snippet: {
    icon: BracketsCurly,
    boldIcon: BracketsCurlyBold,
    foreground: 'text-snippet',
    background: 'bg-snippet/20',
    prettyName: 'Snippet',
  },
  skill: {
    icon: Blueprint,
    boldIcon: BlueprintBold,
    foreground: 'text-chat',
    background: 'bg-chat/20',
    prettyName: 'Skill',
  },
  automation: {
    icon: ClockClockwise,
    boldIcon: ClockClockwiseBold,
    foreground: 'text-chat',
    background: 'bg-chat/20',
    prettyName: 'Automation',
  },
  crm_company: {
    icon: BuildingOffice,
    boldIcon: BuildingOfficeBold,
    foreground: 'text-default',
    background: 'bg-default/20',
    prettyName: 'Company',
  },
  company: {
    icon: BuildingOffice,
    boldIcon: BuildingOfficeBold,
    foreground: 'text-default',
    background: 'bg-default/20',
    prettyName: 'Company',
  },
  reminder: {
    icon: BellSimple,
    boldIcon: BellSimpleBold,
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
  /** Use the matching icon weight. Defaults to regular. */
  weight?: 'regular' | 'bold';
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
    return props.targetType || 'default';
  };

  const config = () => getIconConfig(getName(), props.weight);
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
    boldIcon?: Component<JSX.SvgSVGAttributes<SVGSVGElement>>;
  }
) {
  const config = () =>
    ENTITY_ICON_CONFIGS[validateEntity(props.targetType || 'default')];
  const sizeClass = () => ICON_SIZE_CLASSES[props.size ?? 'xs'];
  const isMonochrome = () => props.theme === 'monochrome';
  const icon = () => {
    if (props.weight === 'bold') {
      return props.boldIcon ?? props.icon ?? config().boldIcon;
    }
    return props.icon ?? config().icon;
  };
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
      <Dynamic component={icon()} class="size-full" />
    </div>
  );
}

export function getIconConfig(
  targetType: EntityWithValidIcon | FileType | (string & {}),
  weight: NonNullable<EntityIconProps['weight']> = 'regular'
) {
  const key = validateEntity(targetType);
  const config = ENTITY_ICON_CONFIGS[key];
  return {
    ...config,
    icon: weight === 'bold' ? config.boldIcon : config.icon,
  };
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
      if (e.fileType === 'spreadsheet') return 'spreadsheet';
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

export function getEntityIconConfig(
  entity: EntityData,
  weight?: EntityIconProps['weight']
) {
  return getIconConfig(getEntityIconType(entity), weight);
}

export function getPreviewItemIconType(item: PreviewItem): EntityWithValidIcon {
  if (item.loading || item.access !== 'access') {
    return 'default';
  }

  return getEntityIconType(item);
}
