import type { LessonDefinition } from '../types';
import { welcomeLesson } from './welcome';
import { sidebarNavLesson } from './sidebar-nav';
import { navigateListLesson } from './navigate-list';
import { commandKLesson } from './command-k';
import { createEntityLesson } from './create-entity';
import { markdownMentionsLesson } from './markdown-mentions';
// import { composersPreviewLesson } from './composers-preview';
import { emailInviteLesson } from './email-invite';
import { choosePlanLesson } from './choose-plan';

export const LESSONS: LessonDefinition[] = [
  welcomeLesson,
  sidebarNavLesson,
  navigateListLesson,
  commandKLesson,
  createEntityLesson,
  markdownMentionsLesson,
  // composersPreviewLesson,
  emailInviteLesson,
  choosePlanLesson,
];
