import { createSignal, For } from 'solid-js';
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
import './homepage/homepage-sections.css';

type Section = {
  id: string;
  title: string;
  description: string;
  tutorial: TutorialVideoId;
  screen: string;
  alt: string;
  fit?: 'bleed' | 'full';
  page?: { title: string; path: ProductPagePath };
};

// Each product gets one section: its selling point, one app window on its own
// wallpaper, and a link to its page. "Macro <Product>" names render as links.
const SECTIONS: readonly Section[] = [
  {
    id: 'home',
    title: 'Macro Mail, Macro Chat and Macro Tasks in one list.',
    description:
      'Email, messages, tasks, mentions and agent replies land in one inbox that you clear from the keyboard.',
    tutorial: 'home',
    screen: inboxScreen,
    alt: 'Macro Home with a pull request open beside the list: its description, status and a review request',
  },
  {
    id: 'email',
    title: 'Macro Mail, organized and prioritized.',
    description:
      'Macro Mail tags and prioritizes email from all your accounts, with Superhuman shortcuts and frontier intelligence.',
    tutorial: 'mail',
    screen: mailScreen,
    alt: 'An email open in Macro Mail, with a task just created from it',
    page: { title: 'Email', path: '/email' },
  },
  {
    id: 'chat',
    title: 'Macro Chat that is linked to the work.',
    description:
      'Integrated with your documents, emails, and tasks. Macro Agents at the ready to take on tasks and catch you up.',
    tutorial: 'chat',
    screen: chatScreen,
    alt: 'The launch-team channel with a thread showing its first replies inline, and a task created from a message',
    page: { title: 'Chat', path: '/channels' },
  },
  {
    id: 'tasks',
    title: 'Macro Tasks for people and agents.',
    description:
      'Create tasks from Macro Mail and team Macro Chat. Assign people or agents, and keep status in sync with linked pull requests.',
    tutorial: 'tasks',
    screen: tasksScreen,
    alt: 'Tasks as a board grouped by priority',
    page: { title: 'Tasks', path: '/tasks' },
  },
  {
    id: 'docs',
    title: 'Macro Docs that link both ways.',
    description:
      'Collaborative markdown docs that @link to your Macro Tasks, Macro Mail and calls, and that agents can edit with you.',
    tutorial: 'docs',
    screen: docsScreen,
    alt: 'A requirements doc on the left mentioning a task, with the task open in a split on the right',
    fit: 'full',
    page: { title: 'Docs', path: '/documents' },
  },
  {
    id: 'calendar',
    title: 'Every Macro Calendar in one place.',
    description:
      'All your Google and Microsoft calendars in one view. Find time with your team and ask Macro Agents to handle the invites.',
    tutorial: 'calendar',
    screen: calendarScreen,
    alt: 'A week view in Macro Calendar with upcoming events in the sidebar',
    page: { title: 'Calendar', path: '/calendar' },
  },
  {
    id: 'calls',
    title: 'Macro Calls that become team memory.',
    description:
      'Every call is recorded, transcribed, and summarized into shared memory your team and your Macro Agents can search.',
    tutorial: 'calls',
    screen: callsScreen,
    alt: 'A list of recorded calls, each with a one-line summary',
    page: { title: 'Calls', path: '/calls' },
  },
  {
    id: 'crm',
    title: 'Macro CRM that keeps itself up to date.',
    description:
      'Macro CRM stays up to date from your Macro Mail and team Macro Chat. No separate tool to maintain.',
    tutorial: 'crm',
    screen: crmScreen,
    alt: 'Companies grouped into Lead, Demo, Customer and Churned, with owner and revenue',
    page: { title: 'CRM', path: '/crm' },
  },
  {
    id: 'agents',
    title: 'Macro Agents are teammates, not a sidebar.',
    description:
      'AI that works from everything you have — email, messages, tasks, docs, and calls — with your exact permissions.',
    tutorial: 'agents',
    screen: agentsScreen,
    alt: 'A channel where a teammate mentions Cursor and the agent replies with the change it made',
    page: { title: 'Agents', path: '/agents' },
  },
  {
    id: 'coding',
    title: 'Merge Macro GitHub pull requests from chat.',
    description:
      'GitHub pull requests in your inbox beside email and chat, @mentionable anywhere, with comments synced both ways.',
    tutorial: 'github',
    screen: pullRequestScreen,
    alt: 'An engineering channel with a pull request open in a split: description, review comments and a Merge button',
    page: { title: 'pull requests', path: '/github' },
  },
];

const MODULES = [
  'Email',
  'Chat',
  'Docs',
  'Tasks',
  'Calendar',
  'Calls',
  'CRM',
  'Agents',
  'Booking links',
  'Search',
  'Drive',
  'Sheets',
];

const CLONE_COMMAND = 'git clone https://github.com/macro-inc/macro';

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

function CloneCommand() {
  const [label, setLabel] = createSignal('Copy');
  let command!: HTMLElement;

  // Clipboard access can be refused; select the command so it can be copied by hand.
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(CLONE_COMMAND);
      setLabel('Copied');
    } catch {
      const range = document.createRange();
      range.selectNodeContents(command);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
      setLabel('Selected');
    }
    setTimeout(() => setLabel('Copy'), 1600);
  };

  return (
    <div class="homepage-clone">
      <code ref={command}>{CLONE_COMMAND}</code>
      <button type="button" onClick={copy}>
        {label()}
      </button>
    </div>
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
            {section.id === 'home' && <Shortcuts />}
          </FeaturePageSection>
        )}
      </For>
      <FeaturePageSection
        id="pricing"
        title="$40 a seat, every module included."
        description="For comparison, Notion, Slack, Linear and Superhuman add up to $84 a seat a month on their business plans, billed annually. List prices checked September 2026."
        more={<HomepageFeatureDetails title="pricing" path="/pricing" />}
      >
        <ul class="homepage-modules" aria-label="Included modules">
          <For each={MODULES}>{(module) => <li>{module}</li>}</For>
        </ul>
      </FeaturePageSection>
      <FeaturePageSection
        id="open-source"
        title="Fully open source. Not open core."
        description="Macro is released under the AGPLv3: a Rust backend and a SolidJS app you can read, fork and host yourself."
      >
        <CloneCommand />
      </FeaturePageSection>
      <HomepageClosing />
    </>
  );
}
