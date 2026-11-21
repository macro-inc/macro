import IconGoogleCalendar from '@icon/import/google-calendar.svg';
import IconGoogleDrive from '@icon/import/google-drive.svg';
import IconJira from '@icon/import/jira.svg';
import IconNotion from '@icon/import/notion.svg';
import IconGithub from '@icon/mcp-github.svg';
import IconLinear from '@icon/mcp-linear.svg';
import IconOutlook from '@icon/outlook-color.svg';
import IconSlack from '@icon/slack-color.svg';
import type { PromotionLogo } from '../components/logo-stack';

type PromotionCopy = {
  /** Dismissal key; changing it shows the card again to everyone. */
  id: string;
  logos: readonly PromotionLogo[];
  headline: string;
  /** Fills one line and most of a second at the default sidebar width. */
  pitch: string;
  action: string;
  secondaryAction?: string;
};

const logo = (name: string, icon: unknown): PromotionLogo => ({
  name,
  icon: icon as PromotionLogo['icon'],
});

export const HOME_SETUP_PROMOTION = {
  id: 'home-setup',
  logos: [
    logo('Slack', IconSlack),
    logo('Notion', IconNotion),
    logo('Linear', IconLinear),
    logo('GitHub', IconGithub),
    logo('Google Drive', IconGoogleDrive),
    logo('Jira', IconJira),
  ],
  headline: 'Make Macro your home base',
  pitch:
    'Connect the tools you use every day and invite teammates to work in Macro.',
  action: 'Connect tools',
  secondaryAction: 'Invite team',
} satisfies PromotionCopy;

const CALENDAR_ACCOUNTS_ID = 'calendar-accounts';

/** The calendar card while an account it names needs attention. */
type AccountCaseCopy = {
  /** Dismissal key for this case. */
  id: string;
  headline: string;
  pitch: (emailAddress: string) => string;
  action: string;
};

export const CALENDAR_ACCOUNTS_PROMOTION = {
  id: CALENDAR_ACCOUNTS_ID,
  logos: [logo('Google Calendar', IconGoogleCalendar)],
  /** Joins the logos while the server offers this user Outlook connections. */
  outlookLogo: logo('Outlook', IconOutlook),
  headline: 'Connect more calendars',
  pitch:
    'Add another account to see your work and personal calendars together.',
  action: 'Connect a calendar',
  /**
   * Shown instead while one of your accounts needs attention, in the words of
   * the calendar view's prompt and the app-wide toast.
   */
  accountCases: {
    /** Calendar access never granted, declined, or turned off. */
    enable: {
      id: CALENDAR_ACCOUNTS_ID,
      headline: 'Enable calendar',
      pitch: (emailAddress: string) =>
        `Grant calendar access for ${emailAddress} to turn it on.`,
      action: 'Turn on calendar',
    },
    /**
     * A calendar that used to sync and lost its access. A new ask, like the
     * toast's: an older dismissal of this card must not hide it.
     */
    stopped: {
      id: `${CALENDAR_ACCOUNTS_ID}:stopped`,
      headline: 'Calendar stopped syncing',
      pitch: (emailAddress: string) =>
        `Reconnect ${emailAddress} to show its events in Macro again.`,
      action: 'Reconnect calendar',
    },
    /** A calendar grant that has expired. */
    reconnect: {
      id: CALENDAR_ACCOUNTS_ID,
      headline: 'Reconnect calendar',
      pitch: (emailAddress: string) =>
        `Reconnect ${emailAddress} to resume calendar sync.`,
      action: 'Reconnect calendar',
    },
  },
} satisfies PromotionCopy & {
  outlookLogo: PromotionLogo;
  accountCases: Record<'enable' | 'stopped' | 'reconnect', AccountCaseCopy>;
};

export const PULL_REQUEST_REPOSITORIES_PROMOTION = {
  id: 'pull-request-repositories',
  logos: [logo('GitHub', IconGithub)],
  headline: 'Bring in more repositories',
  pitch:
    'Add more GitHub orgs and repositories to review their pull requests right here.',
  action: 'Add repositories',
  /** Shown instead while no GitHub account is linked. */
  connectAction: 'Connect GitHub',
  /** Shown instead while the GitHub link has expired. */
  reconnectAction: 'Reconnect GitHub',
} satisfies PromotionCopy & { connectAction: string; reconnectAction: string };
