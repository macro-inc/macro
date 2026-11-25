import CrmIcon from '@icon/system/regular/building-office.svg';
import CalendarIcon from '@icon/system/regular/calendar.svg';
import EmailIcon from '@icon/system/regular/envelope.svg';
import DocsIcon from '@icon/system/regular/file.svg';
import DriveIcon from '@icon/system/regular/folder-simple.svg';
import BookingIcon from '@icon/system/regular/link.svg';
import TasksIcon from '@icon/system/regular/list-checks.svg';
import SearchIcon from '@icon/system/regular/magnifying-glass.svg';
import CallsIcon from '@icon/system/regular/phone-call.svg';
import AgentsIcon from '@icon/system/regular/sparkle.svg';
import SheetsIcon from '@icon/wide-spreadsheet.svg';
import ChatIcon from '@phosphor/chats-circle.svg';
import { For } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import agentsScreen from '../../../assets/homepage/agents.webp';
import agentsScreenLight from '../../../assets/homepage/agents-light.webp';
import calendarScreen from '../../../assets/homepage/calendar.webp';
import calendarScreenLight from '../../../assets/homepage/calendar-light.webp';
import callsScreen from '../../../assets/homepage/calls.webp';
import callsScreenLight from '../../../assets/homepage/calls-light.webp';
import chatScreen from '../../../assets/homepage/chat-thread.webp';
import chatScreenLight from '../../../assets/homepage/chat-thread-light.webp';
import crmScreen from '../../../assets/homepage/crm.webp';
import crmScreenLight from '../../../assets/homepage/crm-light.webp';
import docsScreen from '../../../assets/homepage/docs-split.webp';
import docsScreenLight from '../../../assets/homepage/docs-split-light.webp';
import inboxScreen from '../../../assets/homepage/inbox.webp';
import inboxScreenLight from '../../../assets/homepage/inbox-light.webp';
import mailScreen from '../../../assets/homepage/mail-thread.webp';
import mailScreenLight from '../../../assets/homepage/mail-thread-light.webp';
import pullRequestScreen from '../../../assets/homepage/pull-request.webp';
import pullRequestScreenLight from '../../../assets/homepage/pull-request-light.webp';
import tasksScreen from '../../../assets/homepage/tasks-board.webp';
import tasksScreenLight from '../../../assets/homepage/tasks-board-light.webp';
import type { TutorialVideoId } from '../core/tutorial-videos';
import { FeaturePageSection } from './FeaturePage';
import { HomepageBlog } from './HomepageBlog';
import { HomepageClosing } from './HomepageClosing';
import {
  HomepageFeatureDetails,
  type ProductPagePath,
} from './HomepageFeatureDetails';
import { HomepageTestimonials } from './HomepageTestimonials';
import { HomepageScreen } from './homepage/HomepageScreen';
import { ProductCopy } from './ProductMention';
import './homepage/homepage-sections.css';

type Section = {
  id: string;
  title: string;
  description: string;
  caption: readonly string[];
  tutorial: TutorialVideoId;
  screen: string;
  alt: string;
  /** The light palette's capture, from the website's sample workspace. */
  light: { screen: string; alt: string };
  fit?: 'bleed' | 'full';
  page?: { title: string; path: ProductPagePath | '/docs/product/home' };
};

// Above each graphic: one simple sentence that fills nearly two lines on desktop.
// Below each graphic: 1-2 sentences showing how the Block connects to other Blocks.
const SECTIONS: readonly Section[] = [
  {
    id: 'home',
    title: 'One inbox for everything.',
    description:
      'Home pulls what needs your attention into one prioritized feed with keyboard triage, AI summaries, and instant workspace search.',
    caption: [
      'Catch up on Macro Mail, Macro Chat, Macro Tasks, Macro Docs, and Macro Agents in one list or jump straight into a Macro GitHub pull request.',
    ],
    tutorial: 'home',
    screen: inboxScreen,
    alt: 'Macro Home with a pull request open beside the list: its description, status and a review request',
    light: {
      screen: inboxScreenLight,
      alt: 'Macro Home with an email open beside the list of chats, channels, emails and tasks',
    },
    page: { title: 'Home', path: '/docs/product/home' },
  },
  {
    id: 'email',
    title: 'Organized and prioritized email.',
    description:
      'Mail brings your Google and Microsoft accounts into one inbox with Superhuman shortcuts, AI prioritization, autotagging, and team collaboration.',
    caption: [
      'Mail feeds into Macro CRM to keep records up to date.',
      'And you can create Macro Tasks from any email in one click.',
    ],
    tutorial: 'mail',
    screen: mailScreen,
    alt: 'An email open in Macro Mail, with a task just created from it',
    light: {
      screen: mailScreenLight,
      alt: 'An email thread open in Macro Mail, with its participants and a reply box',
    },
    page: { title: 'Email', path: '/email' },
  },
  {
    id: 'chat',
    title: 'Chat for people and agents.',
    description:
      'Chat puts your teammates and AI agents in the same channels and DMs with inline threads, Signal and Noise filtering, and workspace mentions.',
    caption: [
      'Unlike Slack, your chat isn’t isolated from your work.',
      'Share a customer email from Macro Mail, talk it through, and create Macro Tasks right there.',
    ],
    tutorial: 'chat',
    screen: chatScreen,
    alt: 'The launch-team channel with a thread showing its first replies inline, and a task created from a message',
    light: {
      screen: chatScreenLight,
      alt: 'The launch channel in Macro Chat with a thread’s replies inline and a reply being written',
    },
    page: { title: 'Chat', path: '/channels' },
  },
  {
    id: 'tasks',
    title: 'Turn conversations into tasks.',
    description:
      'Tasks gives your team fast boards, lists, priorities, and due dates without the manual overhead of keeping a separate issue tracker synced.',
    caption: [
      'Create tasks from Macro Chat or Macro Mail, link them inside Macro Docs, and hand them to Macro Agents while Macro GitHub keeps status synced.',
    ],
    tutorial: 'tasks',
    screen: tasksScreen,
    alt: 'Tasks as a board grouped by priority',
    light: {
      screen: tasksScreenLight,
      alt: 'Macro Tasks as a board grouped by priority, each card showing its project and assignee',
    },
    page: { title: 'Tasks', path: '/tasks' },
  },
  {
    id: 'docs',
    title: 'High speed agentic documents.',
    description:
      'Docs gives you collaborative plain markdown with full version history, real-time multiplayer cursors, and live editing alongside AI agents.',
    caption: [
      'Type @ to mention Macro Tasks, Macro Mail, and Macro Calls inline with bidirectional links and organize specs alongside Macro Spreadsheets in Macro Drive.',
    ],
    tutorial: 'docs',
    screen: docsScreen,
    alt: 'A requirements doc on the left mentioning a task, with the task open in a split on the right',
    light: {
      screen: docsScreenLight,
      alt: 'A rollout plan in Macro Docs with tags, next steps and a discussion below',
    },
    fit: 'full',
    page: { title: 'Docs', path: '/documents' },
  },
  {
    id: 'calendar',
    title: 'A really fast calendar with agents that do the scheduling.',
    description:
      'Calendar unifies your Google and Microsoft schedules in one fast week view with instant keyboard navigation and built-in scheduling links.',
    caption: [
      'Ask Macro Agents to find a time and send invites or share Macro Booking Links that connect guest answers straight to Macro CRM and Macro Mail.',
    ],
    tutorial: 'calendar',
    screen: calendarScreen,
    alt: 'A week view in Macro Calendar with upcoming events in the sidebar',
    light: {
      screen: calendarScreenLight,
      alt: 'Macro Calendar: a week view with upcoming events in the sidebar',
    },
    page: { title: 'Calendar', path: '/calendar' },
  },
  {
    id: 'calls',
    title: 'Calls feed into team memory.',
    description:
      'Calls lets you start instant video meetings in any channel or invite external guests with a link—with recordings and transcripts included.',
    caption: [
      'Launch a huddle from Macro Chat and let Macro Agents turn the transcript into Macro Tasks, update Macro CRM, and attach notes to Macro Docs.',
    ],
    tutorial: 'calls',
    screen: callsScreen,
    alt: 'A list of recorded calls, each with a one-line summary',
    light: {
      screen: callsScreenLight,
      alt: 'A channel’s Calls tab in Macro listing recorded calls with their summaries and attendees',
    },
    page: { title: 'Calls', path: '/calls' },
  },
  {
    id: 'crm',
    title: 'CRM that keeps itself up to date.',
    description:
      'CRM automatically tracks your companies, contacts, owners, and deal stages so you never have to manually log updates in a separate tool.',
    caption: [
      'Every company record pulls live threads from Macro Mail, transcripts from Macro Calls, and answers from Macro Booking Links while Macro Agents update stages.',
    ],
    tutorial: 'crm',
    screen: crmScreen,
    alt: 'Companies grouped into Lead, Demo, Customer and Churned, with owner and revenue',
    light: {
      screen: crmScreenLight,
      alt: 'A company record in Macro CRM with its description and a team discussion',
    },
    page: { title: 'CRM', path: '/crm' },
  },
  {
    id: 'agents',
    title: 'Agents with omniscient context.',
    description:
      'Agents work inside your workspace with shared team memory, live editing tools, and your choice of built-in models or external coding agents.',
    caption: [
      'Tag an agent in Macro Chat to draft Macro Mail replies, edit Macro Docs, update Macro CRM, or ship fixes through Macro Tasks and Macro GitHub.',
    ],
    tutorial: 'agents',
    screen: agentsScreen,
    alt: 'A channel where a teammate mentions Cursor and the agent replies with the change it made',
    light: {
      screen: agentsScreenLight,
      alt: 'A channel where a teammate mentions the Cursor agent and it replies in the thread',
    },
    page: { title: 'Agents', path: '/agents' },
  },
  {
    id: 'coding',
    title: 'From bug report to merged PR.',
    description:
      'Review diffs, read review comments, and merge pull requests right inside Macro so engineering work stays beside the thread that started it.',
    caption: [
      'Link pull requests to Macro Tasks, discuss fixes in Macro Chat, and let Macro Agents open branches while Macro GitHub comments land in your inbox.',
    ],
    tutorial: 'github',
    screen: pullRequestScreen,
    alt: 'An engineering channel with a pull request open in a split: description, review comments and a Merge button',
    light: {
      screen: pullRequestScreenLight,
      alt: 'A pull request in Macro with its description and discussion beside the changed files',
    },
    page: { title: 'pull requests', path: '/github' },
  },
];

const MODULES = [
  { label: 'Email', href: '/email', icon: EmailIcon },
  { label: 'Chat', href: '/channels', icon: ChatIcon },
  { label: 'Docs', href: '/documents', icon: DocsIcon },
  { label: 'Tasks', href: '/tasks', icon: TasksIcon },
  { label: 'Calendar', href: '/calendar', icon: CalendarIcon },
  { label: 'Calls', href: '/calls', icon: CallsIcon },
  { label: 'CRM', href: '/crm', icon: CrmIcon },
  { label: 'Agents', href: '/agents', icon: AgentsIcon },
  { label: 'Booking links', href: '/booking-links', icon: BookingIcon },
  { label: 'Search', href: '/docs/product/search', icon: SearchIcon },
  { label: 'Drive', href: '/drive', icon: DriveIcon },
  { label: 'Sheets', href: '/spreadsheets', icon: SheetsIcon },
];

function SectionCaption(props: { sentences: readonly string[] }) {
  return (
    <p class="homepage-section-caption">
      <ProductCopy text={props.sentences.join(' ')} />
    </p>
  );
}

/** Everything below the homepage introduction: one section per product. */
export function HomepageSections() {
  return (
    <>
      <For each={SECTIONS}>
        {(section) => (
          <FeaturePageSection
            id={section.id}
            aura={section.tutorial}
            title={section.title}
            description={section.description}
          >
            <HomepageScreen
              tutorial={section.tutorial}
              src={section.screen}
              alt={section.alt}
              light={{ src: section.light.screen, alt: section.light.alt }}
              fit={section.fit}
              page={section.page}
            />
            <SectionCaption sentences={section.caption} />
          </FeaturePageSection>
        )}
      </For>
      <FeaturePageSection
        id="pricing"
        aura="home"
        title="One plan for all your work."
        description="Start free with every module included and upgrade anytime for higher AI usage and workspace storage."
        more={<HomepageFeatureDetails title="pricing" path="/pricing" />}
      >
        <ul class="homepage-modules" aria-label="Included modules">
          <For each={MODULES}>
            {(module) => (
              <li>
                <a href={module.href}>
                  <Dynamic component={module.icon} aria-hidden="true" />
                  {module.label}
                </a>
              </li>
            )}
          </For>
        </ul>
        <SectionCaption
          sentences={[
            'Replace Slack, Linear, Notion, HubSpot, and Superhuman with Macro Mail, Macro Chat, Macro Docs, Macro Tasks, and Macro CRM under one subscription.',
          ]}
        />
      </FeaturePageSection>
      <HomepageTestimonials />
      <HomepageBlog />
      <HomepageClosing />
    </>
  );
}
