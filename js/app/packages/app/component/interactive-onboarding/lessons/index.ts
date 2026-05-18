import type { LessonDefinition } from '../types';
// import { composersPreviewLesson } from './composers-preview';
import { aboutUsLesson } from './about-us';
import { choosePlanLesson } from './choose-plan';
import { commandKLesson } from './command-k';
import { createEntityLesson } from './create-entity';
import { inviteTeamLesson } from './invite-team';
import { launchLesson } from './launch';
import { markdownMentionsLesson } from './markdown-mentions';
import { reviewPayLesson } from './review-pay';
import { sidebarNavLesson } from './sidebar-nav';
import { teamChoiceLesson } from './team-choice';
import { welcomeLesson } from './welcome';

export const LESSONS: LessonDefinition[] = [
  welcomeLesson,
  sidebarNavLesson,
  commandKLesson,
  createEntityLesson,
  markdownMentionsLesson,
  // composersPreviewLesson,
  aboutUsLesson,
  choosePlanLesson,
  teamChoiceLesson,
  inviteTeamLesson,
  reviewPayLesson,
  launchLesson,
];
