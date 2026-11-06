import IconGoogleCalendar from '@icon/import/google-calendar.svg';
import IconGoogleDrive from '@icon/import/google-drive.svg';
import IconJira from '@icon/import/jira.svg';
import IconNotion from '@icon/import/notion.svg';
import IconGithub from '@icon/mcp-github.svg';
import IconLinear from '@icon/mcp-linear.svg';
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

export const CALENDAR_ACCOUNTS_PROMOTION = {
  id: 'calendar-accounts',
  logos: [logo('Google Calendar', IconGoogleCalendar)],
  headline: 'Connect more calendars',
  pitch:
    'Add another Google account to see work and personal calendars together.',
  action: 'Connect a calendar',
  /** Shown instead while one of your accounts lacks calendar access. */
  enableAction: 'Turn on calendar',
  /** Shown instead while a calendar grant has expired. */
  reconnectAction: 'Reconnect calendar',
} satisfies PromotionCopy & { enableAction: string; reconnectAction: string };

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
