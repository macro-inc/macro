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
      'Context was scattered across Slack, email, docs, and meetings.',
      'We wanted one place to see what needed our attention and pick up work we had already started.',
      'In Home, a document you recently edited shows up next to a customer email or a GitHub review request.',
      'Use J and K to move through the list and open the work beside it, in the same window.',
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
      'We bring your mail into our own database so that search across accounts, including inside attachments, can run without waiting on Gmail’s API.',
      'Share a live email thread in Macro Chat and your team can see the replies that come in after you shared it.',
      'Turn a customer’s email into a linked task, or open the company record in Macro CRM to see the emails and files your team has exchanged with them.',
      'You can also draft, edit, and send an email from an agent chat, using prior conversations to get the details right.',
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
      'The problem we had with Slack was that it was where we talked about the work we did in other apps.',
      'Channels are already the lifeblood of the company, so we built email, docs, tasks, and agents around them.',
      'The first couple of replies show inline and the rest collapse into a thread, so a busy channel stays readable.',
      'Create a task from a message and you can get back to the original discussion from the task.',
      'Share the customer’s email in the same thread and @mention an agent there to take on the work.',
    ],
    tutorial: 'chat',
    screen: chatScreen,
    alt: 'The launch-team channel with a thread showing its first replies inline, and a task created from a message',
    page: { title: 'Chat', path: '/channels' },
  },
  {
    id: 'tasks',
    title: 'Tasks for people and agents.',
    description:
      'Create tasks from email and team chat. Assign people or agents, and keep task status in sync with linked pull requests.',
    caption: [
      'We used Linear and really tried to keep it up to date, but the conversation that moved the work forward was happening in chat.',
      'What worked for us was lightweight issues tightly coupled to channels and DMs, so tracking happens where the conversation happens.',
      'Create a task from a message, a customer email, or a checklist in Macro Docs and the task links back to its source.',
      'Paste it in a channel and your team can see the assignee, priority, and status.',
      'Give it to an agent and it can pick up the original context and take the work through to a pull request.',
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
      'When you and an agent type in the same doc, you can see each other’s cursors as you work.',
      'The whole document lives as a CRDT, so changes merge automatically when you come back online.',
      'A spec can @mention a support email, the task it created, and the call where the team discussed it, and you can follow those links in either direction.',
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
      'We built Calendar so you can manage your week right next to where your work is happening.',
      'Connect your Google and Outlook accounts and check work and personal availability together.',
      'Tools like Calendly solve the scheduling problem.',
      'We wanted personal and team booking links alongside the form someone fills out, their company record, and the emails leading up to the call.',
      'If the discussion is already in Macro Chat, ask an agent in the channel to find a time and send the invite.',
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
      'We run standups right in our engineering channel, where the work we talk about is already linked.',
      'Important decisions get made out loud, and a separate recording and sharing step is easy to forget.',
      'Team and public channel calls share the recording, speaker-labeled transcript, and summary with your team by default, while calls in DMs and private channels start private.',
      'An agent can read the summary afterward and draft a follow-up, update a document, or create the tasks you agreed on.',
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
      'The important conversations about the deal were happening in email and Slack.',
      'In Macro you can @mention a company in the conversation where it comes up, and the record links back to that discussion.',
      'Open the company to see related emails, files, calls, and tasks together.',
      'Agents can enrich the record from public sources and help keep it up to date as the team works.',
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
      'ChatGPT and Claude build memory from your chats.',
      'We wanted agents to remember what the whole team was doing across email, tasks, documents, and calls.',
      'An agent can use one search tool across the workspace, then follow the links back to the original work it can access.',
      'In a customer thread, it can look up earlier emails, read the account’s call notes, and prepare a draft you can review and send.',
      'You can use a model in Macro or bring your own agent through MCP, with the same workspace tools.',
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
      'We wanted GitHub to fit into the workspace we were already using to talk about the work.',
      'A comment or mention on a pull request can show up in Home alongside messages, tasks, and important emails.',
      'Paste the GitHub link in a channel or doc and anyone with access can hover over it to see the status.',
      'From the task, open the linked pull request in a split to read the diff and discussion without leaving the workspace.',
      'As the pull request moves through review and merge, the linked task status can follow it.',
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
        title="One plan for all your work."
        description="Start free. Upgrade for more AI usage and storage."
        more={<HomepageFeatureDetails title="pricing" path="/pricing" />}
      >
        <ul class="homepage-modules" aria-label="Included modules">
          <For each={MODULES}>{(module) => <li>{module}</li>}</For>
        </ul>
        <SectionCaption
          sentences={[
            'At our last startup we used Slack, Linear, Notion, HubSpot, and Superhuman.',
            'We liked those tools, but each new subscription came with another place for work to get stuck.',
            'Macro Pro is $40 per seat per month and includes all AI models, unlimited email accounts, and call recording.',
            'Your team can share a customer email, turn it into a task, and follow it from the company record without buying seats in separate tools.',
            'On the pricing page you can compare what Macro costs against the plans and seats you actually use.',
          ]}
        />
      </FeaturePageSection>
      <FeaturePageSection
        id="open-source"
        title="Fully open source. Not open core."
        description="Macro is fully open source under the AGPLv3. You can read and fork the code or run the workspace yourself."
      >
        <CloneCommand />
        <SectionCaption
          sentences={[
            'If we were choosing a system to run our company on, we would want it to be open source.',
            'You should be able to look at how it works and know you can run it yourself if you need to.',
            'We also wanted the workspace itself to be programmable.',
            'Each block is purpose-built, but they share a Rust backend and a bidirectional graph, so a link from a doc to a task works both ways.',
            'You can extend the system from the code, or use the SDK and MCP to build workflows across the blocks you already use.',
          ]}
        />
      </FeaturePageSection>
      <HomepageClosing />
    </>
  );
}
