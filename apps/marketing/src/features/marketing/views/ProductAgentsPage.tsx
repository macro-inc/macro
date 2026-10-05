import ChatGPTIcon from '@icon/openai.svg';
import ClaudeIcon from '@icon/wide-claude.svg';
import CursorIcon from '@icon/wide-cursor-ide.svg';
import { For } from 'solid-js';
import { setPageSeo } from '../../../app/utils/utilSeo';
import HermesIcon from '../assets/hermes.svg';
import OpenClawIcon from '../assets/openclaw.svg';
import {
  AgentMcpDemo,
  AgentMemoryDemo,
  AgentModelsDemo,
  AgentSearchDemo,
} from '../components/agents/AgentStories';
import { FeaturePageFaq, FeaturePageSection } from '../components/FeaturePage';
import { HomepageClosing } from '../components/HomepageClosing';
import {
  ContextGraphic,
  DiffGraphic,
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

/** Clients the app's MCP settings and Bring your own agent card name. */
const existingAgents = [
  { name: 'Claude', icon: ClaudeIcon },
  { name: 'ChatGPT', icon: ChatGPTIcon },
  { name: 'Cursor', icon: CursorIcon },
  { name: 'Hermes', icon: HermesIcon },
  { name: 'OpenClaw', icon: OpenClawIcon },
];

const agentsFaq = [
  {
    q: 'What does Macro’s memory actually remember?',
    a: 'Who works on what, what you’ve promised customers, and who knows the most about a topic. We rebuild it every night from your team’s email, channels, docs, tasks, calls, and CRM. When an agent needs the latest details, it searches for them. It only uses what the person asking is allowed to see.',
  },
  {
    q: 'What can agents do in Macro?',
    a: 'Most of what you can. They search and read email, chat, docs, tasks, and calls. They write and edit docs, create and assign tasks, update customers in the CRM, post in channels, and draft email. The results land in the same workspace your team already uses.',
  },
  {
    q: 'Which models can I use?',
    a: 'The latest from Anthropic, OpenAI, and Google. The model is a dropdown in the composer, and you can switch in the middle of a conversation if you want a second opinion. Memory and tools work the same with every model, so you’re never locked into one lab.',
  },
  {
    q: 'Can an agent see things I can’t?',
    a: 'No. An agent runs with the permissions of the person using it. If a doc, channel, or email isn’t shared with you, your agent can’t read it either.',
  },
  {
    q: 'Will an agent send email without asking me?',
    a: 'No. The agent drafts the email in the conversation, and it only goes out after you’ve checked the recipients and the wording. Other changes, like doc edits and new tasks, happen right away, the same way a teammate’s would.',
  },
  {
    q: 'Can I edit what an agent makes?',
    a: 'Yes. A doc or task an agent creates is an ordinary Macro doc or task. Edit it, reassign it, or ask another agent to pick it up.',
  },
  {
    q: 'Does a doc have to be open for an agent to edit it?',
    a: 'No. Agents edit through the same sync service your teammates use, so the doc can be closed. If you have it open, you’ll see the edits arrive live and can keep typing alongside them.',
  },
  {
    q: 'Can I use Macro from Claude Code, ChatGPT, or Cursor?',
    a: (
      <>
        Yes. Our MCP server gives them the same tools our agents use, with your
        permissions. In Claude Code, run{' '}
        <code>
          claude mcp add --transport http macro https://mcp-server.macro.com/mcp
        </code>
        . In Claude.ai, add it under Settings → Connectors. ChatGPT needs
        Developer mode turned on. Cursor and other IDEs take the JSON config
        from the MCP server page in Macro’s settings.
      </>
    ),
  },
];

export function RouteAgents() {
  setPageSeo({
    title: 'Macro Agents — AI With Your Whole Workspace as Context',
    description:
      'Agents with memory of your team’s email, chat, docs, tasks, and calls. One search across everything, any model, and an MCP server for the agents you already use.',
    path: '/agents',
  });
  return (
    <ProductPage>
      <ProductHero
        product="Agents"
        title={['Agents that know what', 'your team is doing.']}
        description={[
          'Macro remembers your email, chat, docs, tasks, and calls.',
          'Use any model, from any device, and pick up where you left off.',
        ]}
        cta="agents_hero_get_started"
      />
      <WorkspaceDesktopDemo
        view="agents"
        initialAgent="launch-status"
        label="Explore Macro Agents"
        caption="A sample workspace. Ask about the launch or open a linked task."
      />
      <nav class="feature-page-jump-links" aria-label="On this page">
        <a href="#agent-memory">
          <ThreadGraphic />
          <span>Team memory</span>
        </a>
        <a href="#agent-search">
          <ContextGraphic />
          <span>One search</span>
        </a>
        <a href="#agent-models">
          <DiffGraphic />
          <span>Any model</span>
        </a>
        <a href="#existing-agents">
          <LinkedWorkGraphic />
          <span>Bring your agents</span>
        </a>
      </nav>
      <FeaturePageSection
        id="agent-memory"
        title="Memory for the whole team."
        description={
          'ChatGPT remembers your chats. Macro remembers your company.\nAsk who owns something, what you promised a customer, or who to ask.'
        }
      >
        <div class="feature-page-visual">
          <AgentMemoryDemo />
        </div>
        <ProductProse>
          <p>
            ChatGPT and Claude build memory from your conversations with them.
            Macro builds it from everything your team does: email, channels,
            docs, tasks, calls, and the CRM, refreshed every night. It learns
            who works on what, so it can assign a task to the right person,
            route a customer issue, or tell you who knows the most about
            something. It only uses what you’re allowed to see.
          </p>
        </ProductProse>
      </FeaturePageSection>
      <FeaturePageSection
        id="agent-search"
        title="One search across everything."
        description={
          'Agents search email, chat, docs, tasks, and calls with one tool.\nNo stitching together five integrations that each return half the answer.'
        }
      >
        <div class="feature-page-visual">
          <AgentSearchDemo />
        </div>
        <ProductProse>
          <p>
            Plug Claude into Slack, Notion, Linear, and Gmail and it has to
            search each one, dedupe the results, and guess what happened in what
            order. We built Macro’s tools the way we built the app: one search
            across everything, one way to read any item, and links back to the
            source. Your agent spends its time on your question instead of on
            plumbing.
          </p>
        </ProductProse>
      </FeaturePageSection>
      <FeaturePageSection
        id="agent-models"
        title="Any model. Same memory."
        description={
          'Switch between the latest models from Anthropic, OpenAI, and Google.\nYour memory and tools come with you.'
        }
      >
        <div class="feature-page-visual">
          <AgentModelsDemo />
        </div>
        <ProductProse>
          <p>
            Models leapfrog each other every few months, and you shouldn’t have
            to move your company’s memory every time they do. In Macro, the
            model is a dropdown, and everything the agent knows about your team
            works the same whichever one you pick. Agents run in the cloud, too,
            so you can start something on your laptop, close it, and check the
            result on your phone.
          </p>
        </ProductProse>
      </FeaturePageSection>
      <FeaturePageSection
        id="existing-agents"
        title="Bring Claude, ChatGPT, or Cursor."
        description={
          'Connect any MCP client and it gets the same tools our agents use.\nOne command for Claude Code, or a connector for Claude.ai and ChatGPT.'
        }
      >
        <ul
          class="agents-page-providers"
          aria-label="Agents that connect to Macro"
        >
          <For each={existingAgents}>
            {(agent) => (
              <li data-agent={agent.name}>
                <span class="agents-page-provider-icon">
                  <agent.icon aria-hidden="true" />
                </span>
                <span>{agent.name}</span>
              </li>
            )}
          </For>
        </ul>
        <div class="feature-page-visual agents-page-mcp">
          <AgentMcpDemo />
        </div>
        <ProductProse>
          <p>
            Our MCP server gets the same care as the app. Point Claude Code,
            Cursor, Claude.ai, or ChatGPT at it and your agent can search the
            workspace, read and edit docs, and update tasks and customers, all
            with your permissions.
          </p>
        </ProductProse>
      </FeaturePageSection>
      <FeaturePageFaq
        id="agents-faq-title"
        title="Questions about Macro agents"
        introduction={
          <p>
            Agents in Macro use the same permissions you do. Here are the
            details.
          </p>
        }
        items={agentsFaq}
      />
      <HomepageClosing />
    </ProductPage>
  );
}
