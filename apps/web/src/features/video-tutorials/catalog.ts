import { t } from '@app/lib/i18n';
import crmVideo from './assets/crm.mp4';
import crmPoster from './assets/crm-poster.jpg';
import githubVideo from './assets/github.mp4';
import githubPoster from './assets/github-poster.jpg';
import mailVideo from './assets/mail.mp4';
import mailPoster from './assets/mail-poster.jpg';
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
};
