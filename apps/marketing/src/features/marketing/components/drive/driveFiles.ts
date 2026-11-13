import SkillIcon from '@phosphor/blueprint.svg';
import SnippetIcon from '@phosphor/brackets-curly.svg';
import NoteIcon from '@phosphor/file.svg';
import PdfIcon from '@phosphor/file-pdf.svg';
import SlidesIcon from '@phosphor/file-ppt.svg';
import VideoIcon from '@phosphor/file-video.svg';
import FolderIcon from '@phosphor/folder-simple.svg';
import ImageIcon from '@phosphor/image.svg';
import DesignIcon from '@phosphor/pen-nib.svg';
import SheetIcon from '@phosphor/table.svg';
import type { Component, JSX } from 'solid-js';
import type { EmailTagId } from '../../core/demo-email';
import type { HomepagePersonId } from '../../core/homepage-demo-people';

type Icon = Component<JSX.SvgSVGAttributes<SVGSVGElement>>;

/** File kinds with the icon and name the app's entity icons give them. */
export const driveKinds = {
  note: { icon: NoteIcon, label: 'Note' },
  sheet: { icon: SheetIcon, label: 'Spreadsheet' },
  pdf: { icon: PdfIcon, label: 'PDF' },
  slides: { icon: SlidesIcon, label: 'Presentation' },
  video: { icon: VideoIcon, label: 'Video' },
  design: { icon: DesignIcon, label: 'Figma' },
  image: { icon: ImageIcon, label: 'Image' },
  folder: { icon: FolderIcon, label: 'Folder' },
  skill: { icon: SkillIcon, label: 'Skill' },
  snippet: { icon: SnippetIcon, label: 'Snippet' },
} satisfies Record<string, { icon: Icon; label: string }>;
export type DriveKind = keyof typeof driveKinds;

export type DriveFile = {
  id: string;
  name: string;
  kind: DriveKind;
  /** Where the file came from, when it was not made in Macro. */
  source?: 'email' | 'channel';
  tags?: readonly EmailTagId[];
  owner: HomepagePersonId;
  updated: string;
};

/** One small workspace's files, shared by every Drive graphic. */
export const driveFiles = {
  plan: {
    id: 'plan',
    name: 'Website launch plan',
    kind: 'note',
    tags: ['launch'],
    owner: 'julia',
    updated: '9:12 AM',
  },
  budget: {
    id: 'budget',
    name: 'Launch budget.xlsx',
    kind: 'sheet',
    source: 'email',
    tags: ['launch'],
    owner: 'teo',
    updated: 'Sep 28',
  },
  brand: {
    id: 'brand',
    name: 'Brand guidelines.pdf',
    kind: 'pdf',
    source: 'email',
    tags: ['customers'],
    owner: 'austin',
    updated: '9:41 AM',
  },
  demo: {
    id: 'demo',
    name: 'Customer demo.mp4',
    kind: 'video',
    source: 'channel',
    tags: ['customers', 'product'],
    owner: 'julia',
    updated: '9:38 AM',
  },
  deck: {
    id: 'deck',
    name: 'Launch deck.pptx',
    kind: 'slides',
    source: 'channel',
    tags: ['launch'],
    owner: 'jacob',
    updated: 'Sep 27',
  },
  homepage: {
    id: 'homepage',
    name: 'Homepage.fig',
    kind: 'design',
    tags: ['product'],
    owner: 'gabriel',
    updated: 'Sep 26',
  },
  contract: {
    id: 'contract',
    name: 'Parlor Studio contract.pdf',
    kind: 'pdf',
    source: 'email',
    tags: ['customers'],
    owner: 'jacob',
    updated: 'Sep 25',
  },
} satisfies Record<string, DriveFile>;
