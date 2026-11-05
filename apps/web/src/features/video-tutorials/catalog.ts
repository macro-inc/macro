import { t } from '@app/lib/i18n';
import calendarVideo from './assets/calendar.mp4';
import calendarPoster from './assets/calendar-poster.jpg';
import callsVideo from './assets/calls.mp4';
import callsPoster from './assets/calls-poster.jpg';
import chatVideo from './assets/chat.mp4';
import chatPoster from './assets/chat-poster.jpg';
import crmVideo from './assets/crm.mp4';
import crmPoster from './assets/crm-poster.jpg';
import docsVideo from './assets/docs.mp4';
import docsPoster from './assets/docs-poster.jpg';
import githubVideo from './assets/github.mp4';
import githubPoster from './assets/github-poster.jpg';
import homeVideo from './assets/home.mp4';
import homePoster from './assets/home-poster.jpg';
import mailVideo from './assets/mail.mp4';
import mailPoster from './assets/mail-poster.jpg';
import schedulingVideo from './assets/scheduling.mp4';
import schedulingPoster from './assets/scheduling-poster.jpg';
import tasksVideo from './assets/tasks.mp4';
import tasksPoster from './assets/tasks-poster.jpg';
import type { TutorialId } from './core/tutorial-id';

export type Tutorial = {
  id: TutorialId;
  /** "Learn how to use Macro Mail" */
  readonly title: string;
  /** One line under the title in a row. */
  readonly snippet: string;
  /** The video's length, like "1:27". */
  readonly length: string;
  videoUrl: string;
  posterUrl: string;
};

/**
 * The tutorials that have a video. A block whose video isn't here yet renders
 * no tutorial entry. Vite emits each video as a hashed asset that loads only
 * when its dialog opens and the person presses play.
 */
export const TUTORIALS: Partial<Record<TutorialId, Tutorial>> = {
  mail: {
    id: 'mail',
    get title() {
      return t('tutorials.mailTitle');
    },
    get snippet() {
      return t('tutorials.mailSnippet');
    },
    get length() {
      return t('tutorials.mailLength');
    },
    videoUrl: mailVideo,
    posterUrl: mailPoster,
  },
  crm: {
    id: 'crm',
    get title() {
      return t('tutorials.crmTitle');
    },
    get snippet() {
      return t('tutorials.crmSnippet');
    },
    get length() {
      return t('tutorials.crmLength');
    },
    videoUrl: crmVideo,
    posterUrl: crmPoster,
  },
  github: {
    id: 'github',
    get title() {
      return t('tutorials.githubTitle');
    },
    get snippet() {
      return t('tutorials.githubSnippet');
    },
    get length() {
      return t('tutorials.githubLength');
    },
    videoUrl: githubVideo,
    posterUrl: githubPoster,
  },
  docs: {
    id: 'docs',
    get title() {
      return t('tutorials.docsTitle');
    },
    get snippet() {
      return t('tutorials.docsSnippet');
    },
    get length() {
      return t('tutorials.docsLength');
    },
    videoUrl: docsVideo,
    posterUrl: docsPoster,
  },
  tasks: {
    id: 'tasks',
    get title() {
      return t('tutorials.tasksTitle');
    },
    get snippet() {
      return t('tutorials.tasksSnippet');
    },
    get length() {
      return t('tutorials.tasksLength');
    },
    videoUrl: tasksVideo,
    posterUrl: tasksPoster,
  },
  chat: {
    id: 'chat',
    get title() {
      return t('tutorials.chatTitle');
    },
    get snippet() {
      return t('tutorials.chatSnippet');
    },
    get length() {
      return t('tutorials.chatLength');
    },
    videoUrl: chatVideo,
    posterUrl: chatPoster,
  },
  calls: {
    id: 'calls',
    get title() {
      return t('tutorials.callsTitle');
    },
    get snippet() {
      return t('tutorials.callsSnippet');
    },
    get length() {
      return t('tutorials.callsLength');
    },
    videoUrl: callsVideo,
    posterUrl: callsPoster,
  },
  scheduling: {
    id: 'scheduling',
    get title() {
      return t('tutorials.schedulingTitle');
    },
    get snippet() {
      return t('tutorials.schedulingSnippet');
    },
    get length() {
      return t('tutorials.schedulingLength');
    },
    videoUrl: schedulingVideo,
    posterUrl: schedulingPoster,
  },
  calendar: {
    id: 'calendar',
    get title() {
      return t('tutorials.calendarTitle');
    },
    get snippet() {
      return t('tutorials.calendarSnippet');
    },
    get length() {
      return t('tutorials.calendarLength');
    },
    videoUrl: calendarVideo,
    posterUrl: calendarPoster,
  },
  home: {
    id: 'home',
    get title() {
      return t('tutorials.homeTitle');
    },
    get snippet() {
      return t('tutorials.homeSnippet');
    },
    get length() {
      return t('tutorials.homeLength');
    },
    videoUrl: homeVideo,
    posterUrl: homePoster,
  },
};
