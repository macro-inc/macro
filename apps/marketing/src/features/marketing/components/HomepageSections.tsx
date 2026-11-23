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
      'Home is where you check everything in your workspace. Email, channel messages, task assignments, @mentions, and agent responses all land in one place.',
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
      'Macro Mail tags and prioritizes email from all your accounts, with Superhuman shortcuts and frontier intelligence. Email lives in the same workspace as your channels, docs, tasks, and code.',
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
      'Macro Chat brings your people and agents together in channels. Share context and work on the same tasks. We wanted agents to be actual participants in the team.',
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
      'Create tasks from email and team chat. Assign people or agents, and keep task status in sync with linked pull requests.',
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
      'Version-controlled markdown, @linked to your work. Edit alongside agents with live cursors.',
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
      'All your Google and Microsoft calendars in one view. Find time with your team and ask agents to handle the invites.',
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
      'Call from any channel or DM. Give your team and agents context with recordings and transcripts. A lot of the important context in a company is spoken.',
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
      'Macro CRM stays up to date from your email and team chat. No separate tool to maintain.',
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
      'Macro consolidates email, chats, docs, and CRM into one memory system, aggregated across your whole team. DM an agent, @mention one in a channel, or assign it a task.',
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
      'Track a fix as a task, review and merge the linked pull request from chat, and get GitHub comments and @mentions in your inbox. The original discussion stays linked to the code.',
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
        description="Start free. Upgrade for more AI usage and storage."
        more={<HomepageFeatureDetails title="pricing" path="/pricing" />}
      >
        <ul class="homepage-modules" aria-label="Included modules">
          <For each={MODULES}>{(module) => <li>{module}</li>}</For>
        </ul>
        <SectionCaption
          sentences={[
            'At our last startup we paid for Slack, Linear, Notion, HubSpot, and Superhuman.',
            'We liked those tools, but each new subscription came with another place for work to get stuck.',
          ]}
        />
      </FeaturePageSection>
      <FeaturePageSection
        id="open-source"
        aura="github"
        title="Fully open source. Not open core."
        description="Macro is fully open source under the AGPLv3. You can read and fork the code or run the workspace yourself."
      >
        <CloneCommand />
        <SectionCaption
          sentences={[
            'If we were choosing a system to run our company on, we’d want to be able to read the code and run it ourselves.',
            'We’d also want to change it when our team needed something different.',
          ]}
        />
      </FeaturePageSection>
      <HomepageClosing />
    </>
  );
}
