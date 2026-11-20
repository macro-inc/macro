import ListChecksIcon from '@icon/system/regular/list-checks.svg';
import SquaresIcon from '@icon/system/regular/squares-four.svg';
import UserIcon from '@icon/system/regular/user.svg';
import type { TasksTab } from '../types';

/** Shared built-in view glyphs, without importing the sidebar into phone navigation. */
export const TAB_ICONS: Record<TasksTab, typeof UserIcon> = {
  'my-tasks': UserIcon,
  'team-tasks': ListChecksIcon,
  'my-projects': UserIcon,
  projects: SquaresIcon,
};
