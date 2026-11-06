import { t } from '@app/lib/i18n';
import agentsVideo from './assets/agents.mp4';
import agentsPoster from './assets/agents-poster.jpg';
import calendarVideo from './assets/calendar.mp4';
import calendarPoster from './assets/calendar-poster.jpg';
import callsVideo from './assets/calls.mp4';
import callsPoster from './assets/calls-poster.jpg';
import canvasVideo from './assets/canvas.mp4';
import canvasPoster from './assets/canvas-poster.jpg';
import chatVideo from './assets/chat.mp4';
import chatPoster from './assets/chat-poster.jpg';
import crmVideo from './assets/crm.mp4';
import crmPoster from './assets/crm-poster.jpg';
import databasesVideo from './assets/databases.mp4';
import databasesPoster from './assets/databases-poster.jpg';
import docsVideo from './assets/docs.mp4';
import docsPoster from './assets/docs-poster.jpg';
import driveVideo from './assets/drive.mp4';
import drivePoster from './assets/drive-poster.jpg';
import githubVideo from './assets/github.mp4';
import githubPoster from './assets/github-poster.jpg';
import homeVideo from './assets/home.mp4';
import homePoster from './assets/home-poster.jpg';
import mailVideo from './assets/mail.mp4';
import mailPoster from './assets/mail-poster.jpg';
import schedulingVideo from './assets/scheduling.mp4';
import schedulingPoster from './assets/scheduling-poster.jpg';
import spreadsheetsVideo from './assets/spreadsheets.mp4';
import spreadsheetsPoster from './assets/spreadsheets-poster.jpg';
import tasksVideo from './assets/tasks.mp4';
import tasksPoster from './assets/tasks-poster.jpg';
import whatsappVideo from './assets/whatsapp.mp4';
import whatsappPoster from './assets/whatsapp-poster.jpg';
import type { TutorialId } from './core/tutorial-id';

export type Tutorial = {
  id: TutorialId;
  /** "Learn how to use Macro Mail" */
  readonly title: string;
  /** The block's name in a sentence, like "Macro Mail". */
  readonly block: string;
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
    get block() {
      return t('tutorials.mailBlock');
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
    get block() {
      return t('tutorials.crmBlock');
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
    get block() {
      return t('tutorials.githubBlock');
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
    get block() {
      return t('tutorials.docsBlock');
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
  spreadsheets: {
    id: 'spreadsheets',
    get title() {
      return t('tutorials.spreadsheetsTitle');
    },
    get block() {
      return t('tutorials.spreadsheetsBlock');
    },
    get snippet() {
      return t('tutorials.spreadsheetsSnippet');
    },
    get length() {
      return t('tutorials.spreadsheetsLength');
    },
    videoUrl: spreadsheetsVideo,
    posterUrl: spreadsheetsPoster,
  },
  databases: {
    id: 'databases',
    get title() {
      return t('tutorials.databasesTitle');
    },
    get block() {
      return t('tutorials.databasesBlock');
    },
    get snippet() {
      return t('tutorials.databasesSnippet');
    },
    get length() {
      return t('tutorials.databasesLength');
    },
    videoUrl: databasesVideo,
    posterUrl: databasesPoster,
  },
  canvas: {
    id: 'canvas',
    get title() {
      return t('tutorials.canvasTitle');
    },
    get block() {
      return t('tutorials.canvasBlock');
    },
    get snippet() {
      return t('tutorials.canvasSnippet');
    },
    get length() {
      return t('tutorials.canvasLength');
    },
    videoUrl: canvasVideo,
    posterUrl: canvasPoster,
  },
  tasks: {
    id: 'tasks',
    get title() {
      return t('tutorials.tasksTitle');
    },
    get block() {
      return t('tutorials.tasksBlock');
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
    get block() {
      return t('tutorials.chatBlock');
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
    get block() {
      return t('tutorials.callsBlock');
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
    get block() {
      return t('tutorials.schedulingBlock');
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
    get block() {
      return t('tutorials.calendarBlock');
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
    get block() {
      return t('tutorials.homeBlock');
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
  whatsapp: {
    id: 'whatsapp',
    get title() {
      return t('tutorials.whatsappTitle');
    },
    get block() {
      return t('tutorials.whatsappBlock');
    },
    get snippet() {
      return t('tutorials.whatsappSnippet');
    },
    get length() {
      return t('tutorials.whatsappLength');
    },
    videoUrl: whatsappVideo,
    posterUrl: whatsappPoster,
  },
  agents: {
    id: 'agents',
    get title() {
      return t('tutorials.agentsTitle');
    },
    get block() {
      return t('tutorials.agentsBlock');
    },
    get snippet() {
      return t('tutorials.agentsSnippet');
    },
    get length() {
      return t('tutorials.agentsLength');
    },
    videoUrl: agentsVideo,
    posterUrl: agentsPoster,
  },
  drive: {
    id: 'drive',
    get title() {
      return t('tutorials.driveTitle');
    },
    get block() {
      return t('tutorials.driveBlock');
    },
    get snippet() {
      return t('tutorials.driveSnippet');
    },
    get length() {
      return t('tutorials.driveLength');
    },
    videoUrl: driveVideo,
    posterUrl: drivePoster,
  },
};
