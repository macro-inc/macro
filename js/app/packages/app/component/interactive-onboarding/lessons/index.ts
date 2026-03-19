import type { LessonDefinition } from '../types';
import { welcomeLesson } from './welcome';
import { homeLesson } from './home';
import { navigateListLesson } from './navigate-list';
import { commandKLesson } from './command-k';
import { markdownMentionsLesson } from './markdown-mentions';
import { composersPreviewLesson } from './composers-preview';
import { emailInviteLesson } from './email-invite';
import { choosePlanLesson } from './choose-plan';

export const LESSONS: LessonDefinition[] = [
  welcomeLesson,
  homeLesson,
  navigateListLesson,
  commandKLesson,
  markdownMentionsLesson,
  composersPreviewLesson,
  emailInviteLesson,
  choosePlanLesson,
];
