import IconCompany from '@icon/system/fill/buildings-fill.svg';
import IconChannels from '@icon/system/fill/chats-circle-fill.svg';
import IconEmail from '@icon/system/fill/envelope-fill.svg';
import IconTasks from '@icon/system/fill/list-checks-fill.svg';
import IconCall from '@icon/system/fill/phone-call-fill.svg';
import IconAi from '@icon/system/regular/sparkle.svg';
import type { Component, JSX } from 'solid-js';
import IconDocuments from '../../assets/icons/icon-documents-solid.svg';
import IconGithub from '../../assets/icons/icon-github.svg';

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
    description: 'Unified memory and tools across model providers.',
  },
  {
    Icon: IconEmail,
    title: 'Rox Mail',
    href: '/email',
    description: 'All your email accounts in one inbox.',
  },
  {
    Icon: IconDocuments,
    title: 'Documents',
    href: '/documents',
    description: 'Markdown with live collaboration and offline editing.',
  },
  {
    Icon: IconChannels,
    title: 'Channels',
    href: '/channels',
    description: 'An actual inbox for team chat, with Signal and Noise.',
  },
  {
    Icon: IconCall,
    title: 'Calls',
    href: '/calls',
    description: 'Transcripts and summaries for agents.',
  },
  {
    Icon: IconCompany,
    title: 'CRM',
    href: '/crm',
    description: 'CRM built into the core workspace.',
  },
  {
    Icon: IconTasks,
    title: 'Tasks',
    href: '/tasks',
    description: 'Simple to create, assign, prioritize, and close.',
  },
  {
    Icon: IconGithub,
    title: 'Pull Requests',
    href: '/github',
    description: 'Pull requests in your unified inbox.',
  },
];
