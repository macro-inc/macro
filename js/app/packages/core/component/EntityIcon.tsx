import type { BlockName } from '@core/block';
import {
  blockAcceptedFileExtensionSet,
  fileTypeToBlockName,
} from '@core/constant/allBlocks';
import {
  USE_PIXEL_BLOCK_ICONS,
  USE_WIDE_ICONS,
} from '@core/constant/featureFlags';
import Building from '@icon/duotone/building-duotone.svg';
import Chat from '@icon/duotone/chat-duotone.svg';
import FileCode from '@icon/duotone/code-duotone.svg';
import Email from '@icon/duotone/envelope-duotone.svg';
import EmailRead from '@icon/duotone/envelope-open-duotone.svg';
import FileArchive from '@icon/duotone/file-archive-duotone.svg';
import FileDoc from '@icon/duotone/file-doc-duotone.svg';
import File from '@icon/duotone/file-duotone.svg';
import FileHtml from '@icon/duotone/file-html-duotone.svg';
import FileMd from '@icon/duotone/file-md-duotone.svg';
import FilePdf from '@icon/duotone/file-pdf-duotone.svg';
import FileVideo from '@icon/duotone/file-video-duotone.svg';
import Channel from '@icon/duotone/hash-duotone.svg';
import FileImage from '@icon/duotone/image-duotone.svg';
import Canvas from '@icon/duotone/pencil-circle-duotone.svg';
import User from '@icon/duotone/user-duotone.svg';
import Users from '@icon/duotone/users-duotone.svg';
import Folder from '@icon/fill/folder-simple-fill.svg';
import FolderUser from '@icon/fill/folder-user-fill.svg';
import PixelChat from '@macro-icons/pixel/ai.svg';
import PixelBuilding from '@macro-icons/pixel/building.svg';
import PixelCanvas from '@macro-icons/pixel/canvas.svg';
import PixelChannel from '@macro-icons/pixel/channel.svg';
import PixelCode from '@macro-icons/pixel/code.svg';
import PixelEmail from '@macro-icons/pixel/email.svg';
import PixelEmailRead from '@macro-icons/pixel/email-read.svg';
import PixelFile from '@macro-icons/pixel/file.svg';
import PixelFolder from '@macro-icons/pixel/folder-alt.svg';
import PixelHtml from '@macro-icons/pixel/html.svg';
import PixelImage from '@macro-icons/pixel/image.svg';
import PixelMd from '@macro-icons/pixel/notes.svg';
import PixelPdf from '@macro-icons/pixel/pdf.svg';
import PixelUnknown from '@macro-icons/pixel/unknown.svg';
import PixelUser from '@macro-icons/pixel/user.svg';
import PixelUsers from '@macro-icons/pixel/users.svg';
import PixelVideo from '@macro-icons/pixel/video.svg';
import PixelWord from '@macro-icons/pixel/write.svg';
import WideBook from '@macro-icons/wide/book.svg';
import WideChannel from '@macro-icons/wide/channel.svg';
import WideChat from '@macro-icons/wide/chat.svg';
import WideDiagram from '@macro-icons/wide/diagram.svg';
import WideEmail from '@macro-icons/wide/email.svg';
import WideFileCode from '@macro-icons/wide/file-code.svg';
import WideFileImage from '@macro-icons/wide/file-image.svg';
import WideFileMd from '@macro-icons/wide/file-md.svg';
import WideFolder from '@macro-icons/wide/folder.svg';
import WideStar from '@macro-icons/wide/star.svg';
import WideUnknown from '@macro-icons/wide/unknown.svg';
import WideUser from '@macro-icons/wide/user.svg';
import { FileTypeMap } from '@service-storage/fileTypeMap';
import type { FileType } from '@service-storage/generated/schemas/fileType';
import type { Component, JSX } from 'solid-js';
import { Dynamic } from 'solid-js/web';

type IconConfig = {
  icon: Component<JSX.SvgSVGAttributes<SVGSVGElement>>;
  foreground: string;
  background: string;
  prettyName: string;
};

export type EntityWithValidIcon =
  | BlockName
  | 'default'
  | 'sharedProject'
  | 'company'
  | 'user'
  | 'directMessage'
  | 'emailRead'
  | 'archive'
  | 'html';

const ARCHIVE_EXTENSIONS = new Set(
  Object.values(FileTypeMap)
    .filter((ft) => ft.app === 'archive')
    .map((ft) => ft.extension)
);

export const ENTITY_ICON_CONFIGS: Record<EntityWithValidIcon, IconConfig> = {
  canvas: {
    icon: Canvas,
    foreground: 'text-canvas',
    background: 'bg-canvas-bg',
    prettyName: 'Canvas',
  },
  html: {
    icon: FileHtml,
    foreground: 'text-html',
    background: 'bg-html-bg',
    prettyName: 'Webpage',
  },
  channel: {
    icon: Channel,
    foreground: 'text-default',
    background: 'bg-default-bg',
    prettyName: 'Channel',
  },
  company: {
    icon: Building,
    foreground: 'text-default',
    background: 'bg-default-bg',
    prettyName: 'Company',
  },
  email: {
    icon: Email,
    foreground: 'text-email',
    background: 'bg-email-bg',
    prettyName: 'Email',
  },
  code: {
    icon: FileCode,
    foreground: 'text-code',
    background: 'bg-code-bg',
    prettyName: 'Code',
  },
  pdf: {
    icon: FilePdf,
    foreground: 'text-pdf',
    background: 'bg-pdf-bg',
    prettyName: 'PDF',
  },
  md: {
    icon: FileMd,
    foreground: 'text-note',
    background: 'bg-note-bg',
    prettyName: 'Note',
  },
  image: {
    icon: FileImage,
    foreground: 'text-image',
    background: 'bg-image-bg',
    prettyName: 'Image',
  },
  write: {
    icon: FileDoc,
    foreground: 'text-write',
    background: 'bg-write-bg',
    prettyName: 'Document',
  },
  chat: {
    icon: Chat,
    foreground: 'text-chat',
    background: 'bg-chat-bg',
    prettyName: 'Chat',
  },
  project: {
    icon: Folder,
    foreground: 'text-folder',
    background: 'bg-folder-bg',
    prettyName: 'Folder',
  },
  sharedProject: {
    icon: FolderUser,
    foreground: 'text-folder',
    background: 'bg-folder-bg',
    prettyName: 'Shared Folder',
  },
  unknown: {
    icon: File,
    foreground: 'text-default',
    background: 'bg-default-bg',
    prettyName: 'File',
  },
  archive: {
    icon: FileArchive,
    foreground: 'text-default',
    background: 'bg-default-bg',
    prettyName: 'Archive',
  },
  video: {
    icon: FileVideo,
    foreground: 'text-video',
    background: 'bg-video-bg',
    prettyName: 'Video',
  },
  contact: {
    icon: User,
    foreground: 'text-default',
    background: 'bg-default-bg',
    prettyName: 'Contact',
  },
  default: {
    icon: File,
    foreground: 'text-default',
    background: 'bg-default-bg',
    prettyName: 'File',
  },
  directMessage: {
    icon: Users,
    foreground: 'text-default',
    background: 'bg-default-bg',
    prettyName: 'Direct Message',
  },
  user: {
    icon: User,
    foreground: 'text-default',
    background: 'bg-default-bg',
    prettyName: 'Direct Message',
  },
  emailRead: {
    icon: EmailRead,
    foreground: 'text-default',
    background: 'bg-default-bg',
    prettyName: 'Direct Message',
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
  } else if (isFileType(entity)) {
    return fileTypeToBlockName(entity, true);
  } else if (isArchiveType(entity)) {
    return 'archive';
  } else {
    return 'default';
  }
}

export const PIXEL_ICONS: Record<EntityWithValidIcon, Component> = {
  canvas: PixelCanvas,
  html: PixelHtml,
  channel: PixelChannel,
  company: PixelBuilding,
  email: PixelEmail,
  code: PixelCode,
  pdf: PixelPdf,
  md: PixelMd,
  image: PixelImage,
  write: PixelWord,
  chat: PixelChat,
  project: PixelFolder,
  sharedProject: PixelFolder,
  unknown: PixelUnknown,
  archive: PixelUnknown,
  video: PixelVideo,
  contact: PixelUser,
  default: PixelFile,
  directMessage: PixelUsers,
  user: PixelUser,
  emailRead: PixelEmailRead,
};

export const WIDE_ICONS: Record<EntityWithValidIcon, Component> = {
  canvas: WideDiagram,
  html: WideFileCode,
  channel: WideChannel,
  company: WideUnknown,
  email: WideEmail,
  code: WideFileCode,
  pdf: WideBook,
  md: WideFileMd,
  image: WideFileImage,
  write: WideFileMd,
  chat: WideStar,
  project: WideFolder,
  sharedProject: WideFolder,
  unknown: WideUnknown,
  archive: WideUnknown,
  video: WideUnknown,
  contact: WideUser,
  default: WideUnknown,
  directMessage: WideChat,
  user: WideUser,
  emailRead: WideEmail,
};

export const ICON_SIZES = {
  xs: 'w-4 h-4',
  sm: 'w-4.5 h-4.5',
  md: 'w-8 h-8',
  lg: 'w-12 h-12',
  fill: 'w-full h-full',
  shrinkFill: 'w-full h-full',
} as const;

export const ICON_SIZE_CLASSES = {
  xs: `${ICON_SIZES.xs} flex justify-center overflow-hidden shrink-0`,
  sm: `${ICON_SIZES.sm} flex justify-center overflow-hidden shrink-0`,
  md: `${ICON_SIZES.md} flex justify-center overflow-hidden shrink-0`,
  lg: `${ICON_SIZES.lg} flex justify-center overflow-hidden shrink-0`,
  fill: `${ICON_SIZES.fill} flex justify-center overflow-hidden shrink-0`,
  shrinkFill: `${ICON_SIZES.fill} flex justify-center overflow-hidden`,
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
    if (USE_PIXEL_BLOCK_ICONS) {
      return PIXEL_ICONS[getName()];
    } else if (USE_WIDE_ICONS) {
      return WIDE_ICONS[getName()];
    } else {
      return config().icon;
    }
  };
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
        [`${props.class}`]: !!props.class,
      }}
    >
      <Dynamic component={icon()} />
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
  const sizeClass = () => ICON_SIZE_CLASSES[props.size ?? 'sm'];
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
      <Dynamic component={props.icon || config().icon} />
    </div>
  );
}

export function getIconConfig(
  targetType: EntityWithValidIcon | FileType | string
) {
  const key = validateEntity(targetType);
  const config = { ...ENTITY_ICON_CONFIGS[key] };
  if (USE_PIXEL_BLOCK_ICONS) {
    config.icon = PIXEL_ICONS[key];
  } else if (USE_WIDE_ICONS) {
    config.icon = WIDE_ICONS[key];
  }
  return config;
}
