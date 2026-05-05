import type { LessonDefinition } from '../types';
import { welcomeLesson } from './welcome';
import { sidebarNavLesson } from './sidebar-nav';
import { commandKLesson } from './command-k';
import { createEntityLesson } from './create-entity';
import { markdownMentionsLesson } from './markdown-mentions';
// import { composersPreviewLesson } from './composers-preview';
import { aboutUsLesson } from './about-us';
import { choosePlanLesson } from './choose-plan';
import { teamChoiceLesson } from './team-choice';
import { inviteTeamLesson } from './invite-team';
import { reviewPayLesson } from './review-pay';
import { launchLesson } from './launch';

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
