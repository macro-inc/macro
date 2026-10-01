import type { Component, JSX } from 'solid-js';
import IconAi from '../../assets/icons/icon-ai.svg';
import IconCall from '../../assets/icons/icon-call-solid.svg';
import IconChannels from '../../assets/icons/icon-channels-solid.svg';
import IconCompany from '../../assets/icons/icon-company-solid.svg';
import IconDocuments from '../../assets/icons/icon-documents-solid.svg';
import IconEmail from '../../assets/icons/icon-email-solid.svg';
import IconGithub from '../../assets/icons/icon-github.svg';
import IconTasks from '../../assets/icons/icon-tasks-solid.svg';

export type FeaturePage = {
  Icon: Component<JSX.SvgSVGAttributes<SVGSVGElement>>;
  title: string;
  href: string;
  description: string;
};

// Canonical list of the product's feature pages. Shared by the header's
// Features menu and the "more features" cross-links at the bottom of each page.
export const featurePages: FeaturePage[] = [
  {
    Icon: IconAi,
    title: 'Agents',
    href: '/agents',
    description: 'Agents that search, edit, and remember your work.',
  },
  {
    Icon: IconEmail,
    title: 'Macro Mail',
    href: '/email',
    description: 'Fast email search, shared threads, and agent drafts.',
  },
  {
    Icon: IconDocuments,
    title: 'Documents',
    href: '/documents',
    description: 'CRDT documents with offline sync and live agent edits.',
  },
  {
    Icon: IconChannels,
    title: 'Channels',
    href: '/channels',
    description: 'Inline threads, channel sharing, and agent participants.',
  },
  {
    Icon: IconCall,
    title: 'Calls',
    href: '/calls',
    description: 'Recordings and transcripts your agents can read.',
  },
  {
    Icon: IconCompany,
    title: 'CRM',
    href: '/crm',
    description: 'A CRM that builds itself from email.',
  },
  {
    Icon: IconTasks,
    title: 'Tasks',
    href: '/tasks',
    description: 'Tasks from messages, assigned to people and agents.',
  },
  {
    Icon: IconGithub,
    title: 'Pull Requests',
    href: '/github',
    description: 'Review pull requests in your inbox.',
  },
];
