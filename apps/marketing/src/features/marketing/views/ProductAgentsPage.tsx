import ChatGPTIcon from '@icon/openai.svg';
import ClaudeIcon from '@icon/wide-claude.svg';
import CursorIcon from '@icon/wide-cursor-ide.svg';
import { For } from 'solid-js';
import { setPageSeo } from '../../../app/utils/utilSeo';
import HermesIcon from '../assets/hermes.svg';
import OpenClawIcon from '../assets/openclaw.svg';
import {
  AgentArtifactDemo,
  AgentContextDemo,
  AgentEmailReviewDemo,
  AgentRequestDemo,
  AgentTaskResultDemo,
} from '../components/agents/AgentStories';
import { FeaturePageFaq, FeaturePageSection } from '../components/FeaturePage';
import { HomepageClosing } from '../components/HomepageClosing';
import {
  ContextGraphic,
  EditingGraphic,
  LinkedWorkGraphic,
  ThreadGraphic,
} from '../components/product/ProductGraphics';
import {
  ProductHero,
  ProductPage,
  ProductProse,
} from '../components/product/ProductPage';
import { WorkspaceDesktopDemo } from '../components/WorkspaceDesktopDemo';
import './agents-page.css';

const existingAgents = [
  { name: 'Hermes', icon: HermesIcon },
  { name: 'OpenClaw', icon: OpenClawIcon },
  { name: 'ChatGPT', icon: ChatGPTIcon },
  { name: 'Claude', icon: ClaudeIcon },
  { name: 'Cursor', icon: CursorIcon },
];

export function RouteAgents() {
  setPageSeo({
    title: 'Macro Agents — AI With Your Whole Workspace as Context',
    description:
      'Team-level memory built from email, chat, documents, tasks, and calls. Bring your existing agents, search your workspace, and edit documents live—even when they aren’t open.',
    path: '/agents',
  });
  return (
    <ProductPage>
      <ProductHero
        product="Agents"
        title={['One memory for your team', 'and all its agents.']}
        description={[
          'Shared memory of what everyone on your team is doing.',
          'Email, chat, docs, tasks, and calls.',
        ]}
        cta="agents_hero_get_started"
      />
      <WorkspaceDesktopDemo
        view="agents"
        label="Explore Macro Agents"
        caption="Ask about the launch tasks or create a task in this local sample workspace."
      />
      <nav class="feature-page-jump-links" aria-label="On this page">
        <a href="#agent-request">
          <ThreadGraphic />
          <span>Team-level memory</span>
        </a>
        <a href="#agent-context">
          <ContextGraphic />
          <span>Full workspace context</span>
        </a>
        <a href="#agent-edits">
          <EditingGraphic />
          <span>Live document editing</span>
        </a>
        <a href="#existing-agents">
          <LinkedWorkGraphic />
          <span>Bring your agents</span>
        </a>
      </nav>
      <FeaturePageSection
        id="agent-request"
        title="Memory of what your whole team is doing."
        description={
          'Who owns this project? What did we promise the customer? Who can help?\nYour agents remember the work, the decisions, and the people involved.'
        }
      >
        <div class="feature-page-visual">
          <AgentRequestDemo />
        </div>
        <ProductProse>
          <p>
            Macro builds memory from your team’s emails, channel conversations,
            documents, tasks, and calls. It develops a shared understanding of
            active projects, who is responsible for what, and the decisions your
            team has made. That understanding carries across people, agents, and
            model providers. An agent can identify the right task owner, find
            the person who knows a customer, or pick up work another agent
            started. Search retrieves the latest details, with your sharing
            permissions determining what each agent can access.
          </p>
        </ProductProse>
      </FeaturePageSection>
      <FeaturePageSection
        id="agent-context"
        title="Your entire workspace is context."
        description={
          'Email, messages, documents, images, PDFs, tasks, and call transcripts.\nOne search tool. Full content. References back to the source.'
        }
      >
        <div class="feature-page-visual">
          <AgentContextDemo />
        </div>
        <ProductProse>
          <p>
            Macro gives agents multimodal context: text, images, files, and the
            transcripts of your team’s calls. Unified search finds related work
            across these sources, and reading tools retrieve the content the
            agent needs to answer or take action. @mention an item to give the
            agent a starting point, or let it find the relevant sources itself.
            Follow the references to inspect the email, document, conversation,
            or task behind its answer.
          </p>
        </ProductProse>
      </FeaturePageSection>
      <FeaturePageSection
        id="existing-agents"
        title="Bring the agents you already use."
        description={
          'Give your agents tools to read, search, and edit your Macro workspace.\nHermes, OpenClaw, ChatGPT, Claude, and Cursor.'
        }
      >
        <ul class="agents-page-providers" aria-label="Existing agents">
          <For each={existingAgents}>
            {(agent) => (
              <li>
                <span class="agents-page-provider-icon">
                  <agent.icon aria-hidden="true" />
                </span>
                <span>{agent.name}</span>
              </li>
            )}
          </For>
        </ul>
        <ProductProse>
          <p>
            Connect an MCP-compatible agent to Macro’s MCP server. It can search
            the workspace, read and edit native documents, and update properties
            using your access permissions. The agent you use for coding can also
            read the brief, check a customer conversation, and update the
            document your team is working on. Macro’s built-in agents also let
            you choose the model. Your team’s memory and workspace tools carry
            across model providers.
          </p>
        </ProductProse>
      </FeaturePageSection>
      <FeaturePageSection
        id="agent-edits"
        title="Agents edit documents—even when they’re closed."
        description={
          'Ask an agent to update any native Markdown document it has access to.\nIt joins the same live collaboration system as your teammates.'
        }
      >
        <div class="feature-page-visual">
          <AgentArtifactDemo />
        </div>
        <ProductProse>
          <p>
            Agents read the current document and apply edits through Macro’s
            CRDT sync service. A CRDT is a data structure that merges concurrent
            changes, so a person and an agent can write in the same document at
            the same time. The editing tool connects to the document on the
            server. You don’t have to open it or keep an editor tab running.
            When you are in the document, you can watch the agent’s edits arrive
            live and keep writing alongside it. Its changes remain editable by
            your team.
          </p>
        </ProductProse>
      </FeaturePageSection>
      <FeaturePageSection
        id="agent-email-review"
        title="Draft from your actual conversations."
        description={
          'Ask for a reply using the email thread, meeting transcript, and relevant files.\nReview the recipient, attachments, and wording before sending.'
        }
      >
        <div class="feature-page-visual">
          <AgentEmailReviewDemo />
        </div>
        <ProductProse>
          <p>
            Agents can search past emails, read the thread, and draft with
            information from your documents and calls. They can prepare the
            recipients, subject, body, and requested attachments. The email
            tools ask for confirmation before sending. You can edit the draft
            and check who will receive it before approving the send.
          </p>
        </ProductProse>
      </FeaturePageSection>
      <FeaturePageSection
        id="agent-result"
        title="Agents create real tasks."
        description={
          'Ask an agent to create a task, assign an owner, or update a brief.\nIts tools make those changes directly in your workspace.'
        }
      >
        <div class="feature-page-visual">
          <AgentTaskResultDemo />
        </div>
        <ProductProse>
          <p>
            Task tools create and update workspace items, including their
            descriptions, status, priority, and assignees. The result opens in
            the task list and can be linked in a document or channel. People and
            agents use the same tasks. Assign the next step, edit the checklist,
            or ask another agent to continue from the brief.
          </p>
        </ProductProse>
      </FeaturePageSection>
      <FeaturePageFaq
        id="agents-faq-title"
        eyebrow="Search, memory, and tools"
        title="How agents work in Macro."
        introduction={
          <p>
            Agents read and change workspace items through tools that follow
            your access permissions.
          </p>
        }
        items={[
          {
            q: 'What does team-level memory include?',
            a: 'Macro builds a shared understanding of projects, responsibilities, and decisions from your team’s email, messages, documents, tasks, and calls. Agents use that memory and search for current details. Access to workspace items still follows your sharing permissions.',
          },
          {
            q: 'What can agents do in Macro?',
            a: 'Agents can search and read your email, chat, docs, tasks, and calls; edit native Markdown documents; create and update tasks; and prepare emails. Available tools and connected accounts determine what each conversation can do.',
          },
          {
            q: 'Can I choose the model?',
            a: 'The agent composer includes a model picker. The available models depend on your account and current product configuration.',
          },
          {
            q: 'Do agents bypass sharing permissions?',
            a: 'No. Workspace tools operate with the permissions of the user who runs the agent.',
          },
          {
            q: 'Does every action require approval?',
            a: 'No. Approval depends on the action and tool. Email tools can ask for confirmation before sending; document edits can appear directly in the working document.',
          },
          {
            q: 'Can I edit the result myself?',
            a: 'Yes. Generated documents and tasks remain ordinary workspace items, and email drafts can be reviewed and edited before sending.',
          },
          {
            q: 'Does a document need to be open for an agent to edit it?',
            a: 'No. Agents edit native Markdown documents through the server’s collaboration service, even when the document is closed. The same CRDT system merges their changes with live edits from people. Uploaded PDFs, images, and other files can be read as sources; direct document editing applies to native Markdown documents.',
          },
          {
            q: 'Can I use Macro with an external agent?',
            a: 'Yes. Macro’s MCP server exposes workspace search, document reading and editing, and property updates to external agents. Tools use your access permissions.',
          },
        ]}
      />
      <HomepageClosing />
    </ProductPage>
  );
}
