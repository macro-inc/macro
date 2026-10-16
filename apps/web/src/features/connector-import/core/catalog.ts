import IconAirtable from '@icon/import/airtable.svg';
import IconAsana from '@icon/import/asana.svg';
import IconBox from '@icon/import/box.svg';
import IconClose from '@icon/import/close.svg';
import IconConfluence from '@icon/import/confluence.svg';
import IconDropbox from '@icon/import/dropbox.svg';
import IconGoogleDrive from '@icon/import/google-drive.svg';
import IconHubSpot from '@icon/import/hubspot.svg';
import IconJira from '@icon/import/jira.svg';
import IconMonday from '@icon/import/monday.svg';
import IconNotion from '@icon/import/notion.svg';
import IconOneDrive from '@icon/import/onedrive.svg';
import IconSalesforce from '@icon/import/salesforce.svg';
import IconTrello from '@icon/import/trello.svg';
import IconGithub from '@icon/mcp-github.svg';
import IconLinear from '@icon/mcp-linear.svg';
import IconSlack from '@icon/slack-color.svg';
import type {
  ImportCategory,
  ImportCategoryConfig,
  ImportIcon,
} from './providers';

// Order is promotion order: the sidebar card shows these left to right and
// its copy names the first few. Natively imported sources lead.
// Each pitch fills one line and most of a second at the default sidebar width.
export const IMPORT_CATEGORIES: Record<ImportCategory, ImportCategoryConfig> = {
  files: {
    category: 'files',
    headline: 'Bring your files to Macro',
    pitch:
      'Import docs and files from Notion, Google Drive, Dropbox, OneDrive, and more.',
    action: 'Import files',
    dialogDescription:
      'Connect an app, then pick what to bring into your Drive.',
    items: 'documents and files',
    destination: 'my Macro Drive',
    providers: [
      {
        appSlug: 'notion',
        name: 'Notion',
        detail: 'Pages and wikis',
        icon: IconNotion as ImportIcon,
        native: 'notion',
      },
      {
        appSlug: 'google_drive',
        name: 'Google Drive',
        detail: 'Docs, PDFs, and files',
        icon: IconGoogleDrive as ImportIcon,
      },
      {
        appSlug: 'dropbox',
        name: 'Dropbox',
        detail: 'Files and folders',
        icon: IconDropbox as ImportIcon,
      },
      {
        appSlug: 'microsoft_onedrive',
        name: 'OneDrive',
        detail: 'Files and folders',
        icon: IconOneDrive as ImportIcon,
      },
      {
        appSlug: 'box',
        name: 'Box',
        detail: 'Files and folders',
        icon: IconBox as ImportIcon,
      },
      {
        appSlug: 'confluence',
        name: 'Confluence',
        detail: 'Spaces and pages',
        icon: IconConfluence as ImportIcon,
      },
    ],
  },
  tasks: {
    category: 'tasks',
    headline: 'Bring your tasks to Macro',
    pitch:
      'Import your issues and tasks from Linear, Jira, Asana, GitHub, Trello, and more.',
    action: 'Import tasks',
    dialogDescription: 'Connect an app, then pick which tasks to bring over.',
    items: 'issues and tasks',
    destination: 'Macro tasks',
    providers: [
      {
        appSlug: 'linear',
        name: 'Linear',
        detail: 'Issues',
        icon: IconLinear as ImportIcon,
        native: 'linear',
      },
      {
        appSlug: 'jira',
        name: 'Jira',
        detail: 'Issues',
        icon: IconJira as ImportIcon,
      },
      {
        appSlug: 'asana',
        name: 'Asana',
        detail: 'Tasks',
        icon: IconAsana as ImportIcon,
      },
      {
        appSlug: 'github',
        name: 'GitHub',
        detail: 'Issues',
        icon: IconGithub as ImportIcon,
      },
      {
        appSlug: 'trello',
        name: 'Trello',
        detail: 'Cards',
        icon: IconTrello as ImportIcon,
      },
      {
        appSlug: 'monday',
        name: 'monday.com',
        detail: 'Items',
        icon: IconMonday as ImportIcon,
      },
    ],
  },
  crm: {
    category: 'crm',
    headline: 'Bring your customers to Macro',
    pitch:
      'Import your companies and contacts from HubSpot, Salesforce, Close, and more.',
    action: 'Import customers',
    dialogDescription:
      'Connect an app, then bring its companies and contacts into your CRM.',
    items: 'companies and contacts',
    destination: 'the Macro CRM',
    providers: [
      {
        appSlug: 'hubspot',
        name: 'HubSpot',
        detail: 'Companies and contacts',
        icon: IconHubSpot as ImportIcon,
      },
      {
        appSlug: 'salesforce_rest_api',
        name: 'Salesforce',
        detail: 'Accounts and contacts',
        icon: IconSalesforce as ImportIcon,
      },
      {
        appSlug: 'close',
        name: 'Close',
        detail: 'Leads and contacts',
        icon: IconClose as ImportIcon,
      },
      {
        appSlug: 'airtable_oauth',
        name: 'Airtable',
        detail: 'Records from a base',
        icon: IconAirtable as ImportIcon,
      },
    ],
  },
  channels: {
    category: 'channels',
    headline: 'Bring Slack to Macro',
    pitch:
      'Import Slack channels and members, with or without your full message history.',
    action: 'Import from Slack',
    dialogDescription:
      'Connect Slack to pick channels, or upload an export to bring history.',
    items: 'channels',
    destination: 'Macro channels',
    providers: [
      {
        appSlug: 'slack',
        name: 'Slack',
        detail: 'Channels',
        icon: IconSlack as ImportIcon,
        native: 'slack',
      },
    ],
  },
};
