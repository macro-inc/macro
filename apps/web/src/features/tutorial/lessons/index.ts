import type { LessonDefinition } from '../types';
// import { composersPreviewLesson } from './composers-preview';
import { commandKLesson } from './command-k';
import { createEntityLesson } from './create-entity';
import { markdownMentionsLesson } from './markdown-mentions';
import { sidebarNavLesson } from './sidebar-nav';

export const LESSONS: LessonDefinition[] = [
  sidebarNavLesson,
  createEntityLesson,
  commandKLesson,
  markdownMentionsLesson,
  // composersPreviewLesson,
];
