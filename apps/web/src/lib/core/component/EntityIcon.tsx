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
} from '@entity';
import AddressBookBold from '@icon/system/bold/address-book-bold.svg';
import BellSimpleBold from '@icon/system/bold/bell-simple-bold.svg';
import BlueprintBold from '@icon/system/bold/blueprint-bold.svg';
import BracketsCurlyBold from '@icon/system/bold/brackets-curly-bold.svg';
import BuildingBold from '@icon/system/bold/building-bold.svg';
import BuildingOfficeBold from '@icon/system/bold/building-office-bold.svg';
import CalendarBold from '@icon/system/bold/calendar-bold.svg';
import ClipboardTextBold from '@icon/system/bold/clipboard-text-bold.svg';
import ClockClockwiseBold from '@icon/system/bold/clock-clockwise-bold.svg';
import CodeBold from '@icon/system/bold/code-bold.svg';
import DatabaseBold from '@icon/system/bold/database-bold.svg';
import EmailBold from '@icon/system/bold/envelope-bold.svg';
import EmailReadBold from '@icon/system/bold/envelope-open-bold.svg';
import FileArchiveBold from '@icon/system/bold/file-archive-bold.svg';
import FileBold from '@icon/system/bold/file-bold.svg';
import FileCsvBold from '@icon/system/bold/file-csv-bold.svg';
import FileDashedBold from '@icon/system/bold/file-dashed-bold.svg';
import FileDocBold from '@icon/system/bold/file-doc-bold.svg';
import FileHtmlBold from '@icon/system/bold/file-html-bold.svg';
import FilePdfBold from '@icon/system/bold/file-pdf-bold.svg';
import PresentationBold from '@icon/system/bold/file-ppt-bold.svg';
import FileVideoBold from '@icon/system/bold/file-video-bold.svg';
import FilesBold from '@icon/system/bold/files-bold.svg';
import FolderBold from '@icon/system/bold/folder-simple-bold.svg';
import FolderUserBold from '@icon/system/bold/folder-simple-user-bold.svg';
import GitMergeBold from '@icon/system/bold/git-merge-bold.svg';
import GitPullRequestBold from '@icon/system/bold/git-pull-request-bold.svg';
import GlobeIconBold from '@icon/system/bold/globe-bold.svg';
import HashStraightBold from '@icon/system/bold/hash-straight-bold.svg';
import FileImageBold from '@icon/system/bold/image-bold.svg';
import ListChecksBold from '@icon/system/bold/list-checks-bold.svg';
import PaintBrushBroadBold from '@icon/system/bold/paint-brush-broad-bold.svg';
import PenNibBold from '@icon/system/bold/pen-nib-bold.svg';
import PhoneCallBold from '@icon/system/bold/phone-call-bold.svg';
import ShapesBold from '@icon/system/bold/shapes-bold.svg';
import SparkleBold from '@icon/system/bold/sparkle-bold.svg';
import StackBold from '@icon/system/bold/stack-bold.svg';
import TableBold from '@icon/system/bold/table-bold.svg';
import SpreadsheetBold from '@icon/system/bold/table-bold.svg';
import UsersBold from '@icon/system/bold/users-bold.svg';
import UsersThreeBold from '@icon/system/bold/users-three-bold.svg';
import AddressBook from '@icon/system/regular/address-book.svg';
import BellSimple from '@icon/system/regular/bell-simple.svg';
import Blueprint from '@icon/system/regular/blueprint.svg';
import BracketsCurly from '@icon/system/regular/brackets-curly.svg';
import Building from '@icon/system/regular/building.svg';
import BuildingOffice from '@icon/system/regular/building-office.svg';
import Calendar from '@icon/system/regular/calendar.svg';
import ClipboardText from '@icon/system/regular/clipboard-text.svg';
import ClockClockwise from '@icon/system/regular/clock-clockwise.svg';
import Code from '@icon/system/regular/code.svg';
import Database from '@icon/system/regular/database.svg';
import Email from '@icon/system/regular/envelope.svg';
import EmailRead from '@icon/system/regular/envelope-open.svg';
import File from '@icon/system/regular/file.svg';
import FileArchive from '@icon/system/regular/file-archive.svg';
import FileCsv from '@icon/system/regular/file-csv.svg';
import FileDashed from '@icon/system/regular/file-dashed.svg';
import FileDoc from '@icon/system/regular/file-doc.svg';
import FileHtml from '@icon/system/regular/file-html.svg';
import FilePdf from '@icon/system/regular/file-pdf.svg';
import Presentation from '@icon/system/regular/file-ppt.svg';
import FileVideo from '@icon/system/regular/file-video.svg';
import Files from '@icon/system/regular/files.svg';
import Folder from '@icon/system/regular/folder-simple.svg';
import FolderUser from '@icon/system/regular/folder-simple-user.svg';
import GitMerge from '@icon/system/regular/git-merge.svg';
import GitPullRequest from '@icon/system/regular/git-pull-request.svg';
import GlobeIcon from '@icon/system/regular/globe.svg';
import HashStraight from '@icon/system/regular/hash-straight.svg';
import FileImage from '@icon/system/regular/image.svg';
import ListChecks from '@icon/system/regular/list-checks.svg';
import PaintBrushBroad from '@icon/system/regular/paint-brush-broad.svg';
import PenNib from '@icon/system/regular/pen-nib.svg';
import PhoneCall from '@icon/system/regular/phone-call.svg';
import Shapes from '@icon/system/regular/shapes.svg';
import Sparkle from '@icon/system/regular/sparkle.svg';
import Stack from '@icon/system/regular/stack.svg';
import Table from '@icon/system/regular/table.svg';
import Spreadsheet from '@icon/system/regular/table.svg';
import Users from '@icon/system/regular/users.svg';
import UsersThree from '@icon/system/regular/users-three.svg';
import FigmaLogo from '@phosphor/figma-logo.svg';
import FigmaLogoBold from '@phosphor-icons/core/bold/figma-logo-bold.svg';
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
  | 'initiative'
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
    foreground: 'text-note',
    background: 'bg-note/20',
    prettyName: 'Document',
  },
  call: {
    icon: PhoneCall,
    boldIcon: PhoneCallBold,
    foreground: 'text-communication',
    background: 'bg-communication/20',
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
  pptx: {
    icon: Presentation,
    boldIcon: PresentationBold,
    foreground: 'text-orange',
    background: 'bg-orange/20',
    prettyName: 'Presentation',
  },
  psd: {
    icon: PaintBrushBroad,
    boldIcon: PaintBrushBroadBold,
    foreground: 'text-blue',
    background: 'bg-blue/20',
    prettyName: 'Photoshop file',
  },
  fig: {
    icon: FigmaLogo,
    boldIcon: FigmaLogoBold,
    foreground: 'text-violet',
    background: 'bg-violet/20',
    prettyName: 'Figma file',
  },
  ai: {
    icon: PenNib,
    boldIcon: PenNibBold,
    foreground: 'text-amber',
    background: 'bg-amber/20',
    prettyName: 'Illustrator file',
  },
  database: {
    icon: Database,
    boldIcon: DatabaseBold,
    foreground: 'text-code',
    background: 'bg-code/20',
    prettyName: 'Database',
  },
  form: {
    icon: ClipboardText,
    boldIcon: ClipboardTextBold,
    foreground: 'text-form',
    background: 'bg-form/20',
    prettyName: 'Form',
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
    foreground: 'text-communication',
    background: 'bg-communication/20',
    prettyName: 'Channel',
  },
  public: {
    icon: GlobeIcon,
    boldIcon: GlobeIconBold,
    foreground: 'text-communication',
    background: 'bg-communication/20',
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
    foreground: 'text-communication',
    background: 'bg-communication/20',
    prettyName: 'Private Channel',
  },
  direct_message: {
    icon: Users,
    boldIcon: UsersBold,
    foreground: 'text-communication',
    background: 'bg-communication/20',
    prettyName: 'Direct Message',
  },
  team: {
    icon: UsersThree,
    boldIcon: UsersThreeBold,
    foreground: 'text-communication',
    background: 'bg-communication/20',
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
    foreground: 'text-ink-extra-muted',
    background: 'bg-ink-extra-muted/20',
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
  initiative: {
    icon: Stack,
    boldIcon: StackBold,
    foreground: 'text-task',
    background: 'bg-task/20',
    prettyName: 'Project',
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
  routine: {
    icon: ClockClockwise,
    boldIcon: ClockClockwiseBold,
    foreground: 'text-chat',
    background: 'bg-chat/20',
    prettyName: 'Routine',
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
  pipeline: {
    icon: Table,
    boldIcon: TableBold,
    foreground: 'text-default',
    background: 'bg-default/20',
    prettyName: 'Pipeline',
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
  if (entity === 'automation') return 'routine';
  if (entity === 'ics') return 'calendar';
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
};

/** The shared entity-to-icon mapping used by lists, previews, and drag images. */
export function getEntityIconType(entity: EntityIconData): EntityWithValidIcon {
  return match<EntityIconData, EntityWithValidIcon>(entity)
    .with({ type: 'document' }, (e) => {
      if (e.subType?.type === 'task') return 'task';
      if (e.fileType === 'spreadsheet') return 'spreadsheet';
      if (e.fileType === 'ics') return 'calendar';
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
    .with({ type: 'initiative' }, () => 'initiative')
    .with({ type: 'project' }, () => 'project')
    .with({ type: 'calendar_event' }, () => 'calendar')
    .with({ type: 'call' }, () => 'call')
    .with({ type: 'routine' }, () => 'routine')
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
    .with({ type: 'database' }, () => 'database')
    .with({ type: 'form' }, () => 'form')
    .exhaustive();
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
  // A pipeline previews like an entity but is not one.
  const { type } = item;
  if (type === 'crm_pipeline') return 'pipeline';

  return getEntityIconType({ ...item, type });
}
