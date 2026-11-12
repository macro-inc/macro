import Asana from '@assets/icons/logo-asana.svg';
import ClickUp from '@assets/icons/logo-clickup.svg';
import Confluence from '@assets/icons/logo-confluence.svg';
import Discord from '@assets/icons/logo-discord.svg';
import GoogleDocs from '@assets/icons/logo-google-docs.svg';
import Jira from '@assets/icons/logo-jira.svg';
import Linear from '@assets/icons/logo-linear.svg';
import Teams from '@assets/icons/logo-microsoft-teams.svg';
import Notion from '@assets/icons/logo-notion.svg';
import Outlook from '@assets/icons/logo-outlook.svg';
import Slack from '@assets/icons/logo-slack.svg';
import Superhuman from '@assets/icons/logo-superhuman.svg';
import Airtable from '@assets/icons/replacements/airtable.svg';
import Cal from '@assets/icons/replacements/caldotcom.svg';
import Dropbox from '@assets/icons/replacements/dropbox.svg';
import GoogleCalendar from '@assets/icons/replacements/googlecalendar.svg';
import GoogleDrive from '@assets/icons/replacements/googledrive.svg';
import GoogleSheets from '@assets/icons/replacements/googlesheets.svg';
import Lucid from '@assets/icons/replacements/lucid.svg';
import Make from '@assets/icons/replacements/make.svg';
import Excel from '@assets/icons/replacements/microsoftexcel.svg';
import Word from '@assets/icons/replacements/microsoftword.svg';
import Miro from '@assets/icons/replacements/miro.svg';
import Raycast from '@assets/icons/replacements/raycast.svg';
import Salesforce from '@assets/icons/replacements/salesforce.svg';
import Zapier from '@assets/icons/replacements/zapier.svg';
import Google from '@icon/macro-google.svg';
import GitHub from '@icon/mcp-github.svg';
import Calendly from '@icon/onboarding-calendly.svg';
import Figma from '@icon/onboarding-figma.svg';
import GoogleMeet from '@icon/onboarding-googlemeet.svg';
import HubSpot from '@icon/onboarding-hubspot.svg';
import Zoom from '@icon/onboarding-zoom.svg';
import OpenAI from '@icon/openai.svg';
import Claude from '@icon/wide-claude.svg';
import { Dynamic } from 'solid-js/web';
import './replacement-app-icon.css';

const appIcons = {
  Asana,
  ClickUp,
  Confluence,
  Discord,
  'Google Docs': GoogleDocs,
  'Google Workspace': Google,
  Jira,
  Linear,
  Teams,
  Notion,
  Outlook,
  Slack,
  Superhuman,
  Airtable,
  'Cal.com': Cal,
  Dropbox,
  'Google Calendar': GoogleCalendar,
  'Google Drive': GoogleDrive,
  'Google Sheets': GoogleSheets,
  Lucidchart: Lucid,
  Make,
  Excel,
  Word,
  Miro,
  'Raycast snippets': Raycast,
  Salesforce,
  Zapier,
  'GitHub review tabs': GitHub,
  Calendly,
  FigJam: Figma,
  'Google Meet': GoogleMeet,
  HubSpot,
  Zoom,
  ChatGPT: OpenAI,
  'Custom GPTs': OpenAI,
  Claude,
  'Claude Projects': Claude,
  'Notion databases': Notion,
};
export type ReplacementApp = keyof typeof appIcons;

export function ReplacementAppIcon(props: { name: ReplacementApp }) {
  return (
    <span
      class="replacement-app-icon"
      role="img"
      aria-label={props.name}
      title={props.name}
    >
      <Dynamic
        component={appIcons[props.name]}
        class="replacement-app-icon-logo"
        aria-hidden="true"
      />
    </span>
  );
}
