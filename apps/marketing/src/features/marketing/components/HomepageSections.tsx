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
import calendarScreen from '../../../assets/homepage/calendar.webp';
import callsScreen from '../../../assets/homepage/calls.webp';
import chatScreen from '../../../assets/homepage/chat-thread.webp';
import crmScreen from '../../../assets/homepage/crm.webp';
import docsScreen from '../../../assets/homepage/docs-split.webp';
import inboxScreen from '../../../assets/homepage/inbox.webp';
import mailScreen from '../../../assets/homepage/mail-thread.webp';
import pullRequestScreen from '../../../assets/homepage/pull-request.webp';
import tasksScreen from '../../../assets/homepage/tasks-board.webp';
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
  fit?: 'bleed' | 'full';
  page?: { title: string; path: ProductPagePath };
};

// Keep each section to 1-2 short sentences above the graphic and 1-2 below:
// what the Block does above, and why we built it or how we use it below.
const SECTIONS: readonly Section[] = [
  {
    id: 'home',
    title: 'One inbox for your work.',
    description:
      'Catch up on email, chat, tasks, docs, and agent replies in one prioritized feed.',
    caption: [
      'At our last startup, every team lived in different apps.',
      'We built Home so nothing gets lost between email, docs, and pull requests.',
    ],
    tutorial: 'home',
    screen: inboxScreen,
    alt: 'Macro Home with a pull request open beside the list: its description, status and a review request',
  },
  {
    id: 'email',
    title: 'Organized and prioritized email.',
    description:
      'Macro Mail brings every account into one inbox. Triage with Superhuman shortcuts and share live threads in chat.',
    caption: [
      'We wanted Superhuman’s speed and Outlook’s multi-account workflow in one place.',
      'Every shared thread stays live in chat as customers reply.',
    ],
    tutorial: 'mail',
    screen: mailScreen,
    alt: 'An email open in Macro Mail, with a task just created from it',
    page: { title: 'Email', path: '/email' },
  },
  {
    id: 'chat',
    title: 'Chat for people and agents.',
    description:
      'Macro Chat puts teammates and agents in the same channels. Tag an agent in any thread and it reads the full history.',
    caption: [
      'Unlike Slack, your chat isn’t isolated from your work.',
      'Share a customer email, talk it through, and turn the message into a task right there.',
    ],
    tutorial: 'chat',
    screen: chatScreen,
    alt: 'The launch-team channel with a thread showing its first replies inline, and a task created from a message',
    page: { title: 'Chat', path: '/channels' },
  },
  {
    id: 'tasks',
    title: 'Turn conversations into tasks.',
    description:
      'Turn any chat message or email into a task. Assign it to a teammate or an agent.',
    caption: [
      'We struggled to keep Linear synced with chat.',
      'Here every task links back to the original thread and updates with its pull request.',
    ],
    tutorial: 'tasks',
    screen: tasksScreen,
    alt: 'Tasks as a board grouped by priority',
    page: { title: 'Tasks', path: '/tasks' },
  },
  {
    id: 'docs',
    title: 'High speed agentic documents.',
    description:
      'Collaborative markdown with full version history and live agent cursors. Mention any task, email, or call inline.',
    caption: [
      'We combined Obsidian’s plain markdown, Notion’s mentions, and real-time CRDT editing for humans and agents alike.',
    ],
    tutorial: 'docs',
    screen: docsScreen,
    alt: 'A requirements doc on the left mentioning a task, with the task open in a split on the right',
    fit: 'full',
    page: { title: 'Docs', path: '/documents' },
  },
  {
    id: 'calendar',
    title: 'A really fast calendar, with agents that do the scheduling.',
    description:
      'View Google and Microsoft calendars together. Ask an agent to find an open slot and send the invite.',
    caption: [
      'Built-in booking links replace Calendly and show each guest’s form answers beside their company record and past emails.',
    ],
    tutorial: 'calendar',
    screen: calendarScreen,
    alt: 'A week view in Macro Calendar with upcoming events in the sidebar',
    page: { title: 'Calendar', path: '/calendar' },
  },
  {
    id: 'calls',
    title: 'Calls that feed into team memory.',
    description:
      'Start a call in any channel or invite guests with a link. Every recording and transcript is searchable.',
    caption: [
      'It feels like a Slack huddle with Google Meet guest links.',
      'After standup, an agent reads the transcript and writes up the tasks.',
    ],
    tutorial: 'calls',
    screen: callsScreen,
    alt: 'A list of recorded calls, each with a one-line summary',
    page: { title: 'Calls', path: '/calls' },
  },
  {
    id: 'crm',
    title: 'CRM that keeps itself up to date.',
    description:
      'Macro CRM builds company and contact records straight from your team’s email, chat, and calls.',
    caption: [
      'No more chasing teammates for updates like in HubSpot or Salesforce.',
      'Open any company record to read the latest emails and call notes.',
    ],
    tutorial: 'crm',
    screen: crmScreen,
    alt: 'Companies grouped into Lead, Demo, Customer and Churned, with owner and revenue',
    page: { title: 'CRM', path: '/crm' },
  },
  {
    id: 'agents',
    title: 'Agents with omniscient context.',
    description:
      'Agents share one memory across your email, chat, docs, and CRM. Message one directly or tag it in a channel.',
    caption: [
      'Ask about any customer and an agent remembers your teammates’ emails and calls before drafting a reply.',
    ],
    tutorial: 'agents',
    screen: agentsScreen,
    alt: 'A channel where a teammate mentions Cursor and the agent replies with the change it made',
    page: { title: 'Agents', path: '/agents' },
  },
  {
    id: 'coding',
    title: 'From bug report to merged pull request.',
    description:
      'Review diffs and merge pull requests right beside the task and thread. GitHub comments land straight in your inbox.',
    caption: [
      'We built this so engineers can go from a bug report in chat to a merged fix without switching tabs.',
    ],
    tutorial: 'github',
    screen: pullRequestScreen,
    alt: 'An engineering channel with a pull request open in a split: description, review comments and a Merge button',
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

function Shortcuts() {
  return (
    <ul class="homepage-shortcuts" aria-label="Keyboard shortcuts">
      <li>
        <kbd>J</kbd>
        <kbd>K</kbd>
        Move
      </li>
      <li>
        <kbd>E</kbd>
        Done
      </li>
      <li>
        <kbd>⌘</kbd>
        <kbd>K</kbd>
        Search
      </li>
    </ul>
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
            more={
              section.page && (
                <HomepageFeatureDetails
                  title={section.page.title}
                  path={section.page.path}
                />
              )
            }
          >
            <HomepageScreen
              tutorial={section.tutorial}
              src={section.screen}
              alt={section.alt}
              fit={section.fit}
            />
            <SectionCaption sentences={section.caption} />
            {section.id === 'home' && <Shortcuts />}
          </FeaturePageSection>
        )}
      </For>
      <FeaturePageSection
        id="pricing"
        aura="home"
        title="One plan for all your work."
        description="Start free and get more AI usage and storage on a paid plan."
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
            'At our last startup we paid for Slack, Linear, Notion, HubSpot, and Superhuman.',
            'Macro brings them together under one subscription.',
          ]}
        />
      </FeaturePageSection>
      <HomepageTestimonials />
      <HomepageBlog />
      <HomepageClosing />
    </>
  );
}
