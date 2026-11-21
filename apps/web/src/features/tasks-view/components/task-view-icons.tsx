import ListChecksIcon from '@icon/system/regular/list-checks.svg';
import NoteIcon from '@icon/system/regular/note-pencil.svg';
import SquaresIcon from '@icon/system/regular/squares-four.svg';
import UserIcon from '@icon/system/regular/user.svg';
import type { TasksTab } from '../types';

/** Shared built-in view glyphs, without importing the sidebar into phone navigation. */
export const TAB_ICONS: Record<TasksTab, typeof NoteIcon> = {
  'my-tasks': UserIcon,
  'team-tasks': ListChecksIcon,
  'created-by-me': NoteIcon,
  'my-projects': UserIcon,
  projects: SquaresIcon,
  'created-projects': NoteIcon,
};
