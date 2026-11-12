import ArrowUpRight from '@icon/system/regular/arrow-up-right.svg';
import CaretDown from '@icon/system/regular/caret-down.svg';
import { setPageSeo } from '../../../app/utils/utilSeo';
import { AgentMcpSetup } from '../components/agents/AgentStories';
import {
  AgentDeliverableStory,
  AgentMeetingStory,
  AgentTeamworkStory,
} from '../components/agents/AgentWorkflowStories';
import { DemoInteractionBoundary } from '../components/DemoInteractionBoundary';
import { FeaturePageFaq, FeaturePageSection } from '../components/FeaturePage';
import { HomepageClosing } from '../components/HomepageClosing';
import { ProductHero, ProductPage } from '../components/product/ProductPage';
import { TutorialVideoEmbed } from '../components/TutorialVideoEmbed';
import './agents-page.css';

const agentsFaq = [
  {
    q: 'What can Rox’s agents do?',
    a: 'Search your workspace, draft emails, edit documents, create tasks, and update customer records. Start a conversation in Agents or mention an available agent in a channel.',
  },
  {
    q: 'Can I use my existing AI client?',
    a: (
      <>
        Yes. Connect an MCP-compatible client to your Rox account so it can work
        with your workspace. Follow the{' '}
        <a href="/docs/AI/mcp/overview">MCP setup guide</a>. Running a local
        agent inside Rox is a separate feature; check the{' '}
        <a href="/docs/AI/bring-your-own">local agent guide</a> for
        availability.
      </>
    ),
  },
  {
    q: 'Can I choose the model?',
    a: 'Yes. Use the model picker in an agent conversation. Available models and usage limits depend on your plan. A connected agent uses the models its own runtime supports.',
  },
  {
    q: 'What can an agent access?',
    a: 'Hosted agents use the conversation owner’s access. Someone else prompting a shared session may need the owner’s approval. Connected clients and local agents also follow their own permission settings.',
  },
  {
    q: 'Can I review an email before it is sent?',
    a: (
      <>
        Yes. Ask for a draft, review it, and make edits before sending.
        Connected AI clients have their own approval controls. See{' '}
        <a href="/email">Rox Mail</a>.
      </>
    ),
  },
  {
    q: 'Can agents work while I’m away?',
    a: 'Hosted agents can continue after you close the app, and scheduled routines can run recurring work. Local agents need their computer and runtime to stay online.',
  },
  {
    q: 'How much agent usage is included?',
    a: (
      <>
        Rox has a free plan with limited AI usage. Paid plans offer more usage
        and model options. See{' '}
        <a href="/pricing">current plans and AI limits</a>.
      </>
    ),
  },
];

export function RouteAgents() {
  setPageSeo({
    title: 'Rox Agents — Bring your favorite agents',
    description:
      'Rox develops a shared understanding of what everyone on your team is working on. Unified memory and tools work across model providers.',
    path: '/agents',
  });
  return (
    <ProductPage>
      <div class="agents-hero">
        <ProductHero
          product="Agents"
          title="Agents with omniscient context."
          description="Rox consolidates email, chats, docs, and CRM into one memory system, aggregated across your whole team."
          cta="agents_hero_get_started"
          tutorial="agents"
        />
      </div>
      <FeaturePageSection
        id="agent-sources"
        demo={{
          tone: 'agents',
        }}
        title="Unified memory, across your whole team."
        description="ChatGPT and Claude build up memory from your chats. Rox builds memory from your files, your email, your tasks, everything your team is talking about in channels, and all of your calls. It works across your team too, so agents know what everyone is working on and who is responsible for what."
      >
        <DemoInteractionBoundary
          class="feature-page-visual"
          render={() => <AgentMeetingStory />}
        />
      </FeaturePageSection>
      <FeaturePageSection
        id="agent-collaboration"
        demo={{
          tone: 'agents',
        }}
        title="First-class citizens, just like people."
        description="Agents work right inside your channels. @mention one to get it working on something with the whole conversation as context, or assign it a task in Rox Tasks, just like a teammate. Hosted agents keep working after you close the app; pick up the same conversation on another device."
      >
        <DemoInteractionBoundary
          class="feature-page-visual"
          render={() => <AgentTeamworkStory />}
        />
      </FeaturePageSection>
      <FeaturePageSection
        id="agent-actions"
        demo={{
          tone: 'agents',
        }}
        title="One search tool across everything."
        description="We put the same effort into our tools and MCP as the app itself. Connected to separate apps, an agent has to search each one, then deduplicate and work out what happened. In Rox it uses one search tool across your files, email, tasks, messages, and calls."
      >
        <DemoInteractionBoundary
          class="feature-page-visual"
          render={() => <AgentDeliverableStory />}
        />
      </FeaturePageSection>
      <FeaturePageSection
        id="existing-agents"
        title="Bring your own agents."
        description="Point Claude Code, Codex, or any MCP client at your workspace, or run agents on your own machine with macrod. Your team’s memory and Rox’s tools work with all the latest models from every provider, so you’re never locked into one."
      >
        <div class="agents-connections">
          <div class="agents-connection-paths">
            <div class="agents-connection-path">
              <h3>Your agent, inside Rox</h3>
              <p>
                Bring Claude Code, OpenCode, OpenClaw, or Hermes into your
                workspace. Connect through macrod and keep your agent running on
                your machine.
              </p>
              <a class="agents-setup-link" href="/docs/AI/bring-your-own">
                Connect your agent <ArrowUpRight aria-hidden="true" />
              </a>
              <TutorialVideoEmbed tutorial="macrod" />
            </div>
            <div class="agents-connection-path">
              <h3>Rox, inside your agent</h3>
              <p>
                Use Rox from Claude, ChatGPT, Cursor, or another MCP client.
                Search your workspace and work with its documents and tasks from
                there.
              </p>
              <a class="agents-setup-link" href="/docs/AI/mcp/overview">
                Connect with MCP <ArrowUpRight aria-hidden="true" />
              </a>
            </div>
          </div>
          <details class="agents-mcp-disclosure">
            <summary>
              MCP connection commands <CaretDown aria-hidden="true" />
            </summary>
            <div
              class="agents-mcp-content workspace-demo portal-scope"
              data-theme="dark"
            >
              <AgentMcpSetup />
            </div>
          </details>
        </div>
      </FeaturePageSection>
      <FeaturePageFaq
        guide={{ href: '/agents#guide', label: 'agents' }}
        id="agents-faq-title"
        title="Questions about Rox Agents"
        items={agentsFaq}
      />
      <HomepageClosing />
    </ProductPage>
  );
}
