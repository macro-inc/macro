import type { LessonDefinition } from '../types';
import { welcomeLesson } from './welcome';
import { navigateListLesson } from './navigate-list';
import { whatsNextLesson } from './whats-next';

export const LESSONS: LessonDefinition[] = [
  welcomeLesson,
  navigateListLesson,
  whatsNextLesson,
];
