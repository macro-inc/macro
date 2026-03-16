import type { LessonDefinition } from '../types';
import { choosePlanLesson } from './choose-plan';
import { createEntityLesson } from './create-entity';
import { navigateListLesson } from './navigate-list';
import { welcomeLesson } from './welcome';
import { whatsNextLesson } from './whats-next';

export const LESSONS: LessonDefinition[] = [
  welcomeLesson,
  navigateListLesson,
  createEntityLesson,
  whatsNextLesson,
  choosePlanLesson,
];
