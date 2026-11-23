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
import agentBuilderScreen from '../../../assets/homepage/agent-builder.webp';
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
import { HomepageClosing } from './HomepageClosing';
import {
  HomepageFeatureDetails,
  type ProductPagePath,
} from './HomepageFeatureDetails';
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

// Use the product pages' hero copy above each capture. The captions explain
// why we built each block and how it fits with the others.
const SECTIONS: readonly Section[] = [
  {
    id: 'home',
    title: 'One inbox for your work.',
    description:
      'Home puts the work that needs your attention in one place. Catch up on your email, team chat, tasks, and replies from an agent in the same list.',
    caption: [
      'When our last startup grew to twenty people, engineering, sales, and marketing each had their own tools.',
      'We wanted one place to catch up on a customer email, a doc we’d been editing, or a pull request waiting for review.',
    ],
    tutorial: 'home',
    screen: inboxScreen,
    alt: 'Macro Home with a pull request open beside the list: its description, status and a review request',
  },
  {
    id: 'email',
    title: 'Organized and prioritized email.',
    description:
      'Macro Mail brings all your accounts into one inbox. Use the same keys you use in Superhuman and share a live email thread with your team in chat.',
    caption: [
      'We wanted the speed of Superhuman, the multitasking of Outlook, and a single inbox for all our accounts.',
      'When we share a customer’s email in chat, the next reply shows up there too.',
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
      'Macro Chat puts your team and its agents in the same channels. Tag an agent in a thread and it can read what led up to the task before it gets to work.',
    caption: [
      'Slack was where we talked about the work we did in other apps.',
      'We wanted to share a customer email in a channel, talk it through, and turn the message into a task right there.',
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
      'Create a task from a team chat or a customer email. Pass the task to a teammate or an agent. The linked pull request keeps the task up to date.',
    caption: [
      'We used Linear and really tried to keep it up to date, but the conversation that moved the work forward was happening in chat.',
      'Now we make the task from the message so whoever picks it up can read the original discussion.',
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
      'Docs keep a version history of your markdown and link back to the work you mention. Edit alongside an agent and see its cursor move as you work.',
    caption: [
      'We liked the simplicity of Obsidian, the mentions in Notion, and being able to edit a plain markdown file with our own agents.',
      'We wanted all of that in the same editor with live collaboration.',
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
      'See your calendars from Google and Microsoft together in one place. Ask an agent to find a time that works for your team and put it on the calendar.',
    caption: [
      'We liked being able to send someone a Calendly link.',
      'We wanted to see what they wrote on the booking form alongside their company record and the emails leading up to the call.',
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
      'You can start a call in any channel or DM. Save both the recording and the transcript so you and your agents can find a detail that came up on the call.',
    caption: [
      'We wanted the ease of a Slack huddle and the option to send a guest a link, like Google Meet.',
      'We run standups in our engineering channel so an agent can read the transcript afterward and write up the tasks we agreed on.',
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
      'Macro CRM keeps up with the work your team does in email and chat. Open a company record to see who spoke to the customer last and what they said.',
    caption: [
      'We could open a deal in HubSpot or Salesforce and still have to ask the person working on it what was actually going on.',
      'In Macro we can open the company record and read the emails and call notes ourselves.',
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
      'Agents share one memory of your team’s email, chat, docs, and CRM. Start a chat with an agent, tag one in a thread, or ask it to take on a task.',
    caption: [
      'We wanted to ask an agent about a customer and have it remember the conversations our teammates had with them, too.',
      'It can read the earlier emails and call notes before it drafts a reply.',
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
      'Review the code beside the task and the thread that started it. Read the diff and merge the fix in the same thread. GitHub comments go to your inbox.',
    caption: [
      'We wanted to review a GitHub fix in the channel where someone reported the bug.',
      'You can open the diff beside the original discussion and merge the pull request from there.',
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
      <FeaturePageSection
        id="agent-builder"
        aura="agents"
        title="The Michael Jordan of AI agents."
        description="Give your agent an email address and a job on your team. When an invoice needs a second look, tag your finance agent in the thread where it came up."
      >
        <img
          class="homepage-agent-builder-screen"
          src={agentBuilderScreen}
          alt="The Macro Bot builder shows Ledger’s avatar beside its finance role, computer, and working hours."
          width="3066"
          height="1970"
          loading="lazy"
          decoding="async"
        />
        <SectionCaption
          sentences={[
            'Here we’ve given Ledger a standard computer and a Monday through Friday schedule.',
            'You can see what that setup costs per working hour before you create it.',
          ]}
        />
      </FeaturePageSection>
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
            'We liked those tools, but each new subscription came with another place for work to get stuck.',
          ]}
        />
      </FeaturePageSection>
      <HomepageClosing />
    </>
  );
}
