import ArrowUpRight from '@phosphor/arrow-up-right.svg';
import CaretDown from '@phosphor/caret-down.svg';
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
import {
  ContextGraphic,
  EditingGraphic,
  LinkedWorkGraphic,
  ThreadGraphic,
} from '../components/product/ProductGraphics';
import { ProductHero, ProductPage } from '../components/product/ProductPage';
import { WorkspaceDesktopDemo } from '../components/WorkspaceDesktopDemo';
import './agents-page.css';

const agentsFaq = [
  {
    q: 'What can Macro’s agents do?',
    a: 'Search workspace context, draft emails, edit documents, create tasks, and update customer records. Start a conversation in Agents or mention an available agent in a team channel.',
  },
  {
    q: 'Can I use my existing AI client?',
    a: (
      <>
        Yes. Connect an MCP-compatible client to your Macro account so it can
        work with your workspace. Follow the{' '}
        <a href="https://docs.macro.com/AI/mcp/overview">MCP setup guide</a>.
        Running a local agent inside Macro is a separate feature; check the{' '}
        <a href="https://docs.macro.com/AI/bring-your-own">local agent guide</a>{' '}
        for availability.
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
        <a href="/email">Macro Mail</a>.
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
        Macro has a free plan with limited AI usage. Paid plans offer more usage
        and model options. See{' '}
        <a href="/pricing">current plans and AI limits</a>.
      </>
    ),
  },
];

export function RouteAgents() {
  // The router coalesces a click on the current hash. Still scroll back to it
  // when the visitor has moved elsewhere on this long page.
  const revisitSection = (
    event: MouseEvent & { currentTarget: HTMLAnchorElement }
  ) => {
    if (
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      event.button !== 0
    )
      return;
    const hash = event.currentTarget.hash;
    if (hash !== window.location.hash) return;
    event.preventDefault();
    document.getElementById(hash.slice(1))?.scrollIntoView({
      block: 'start',
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'auto'
        : 'smooth',
    });
  };
  setPageSeo({
    title: 'Macro Agents | Agents That Know What Your Team Is Doing',
    description:
      'Give agents native access to the context and tools behind your work. Use workspace permissions, choose a model, mention agents in chat, or bring your own agent.',
    path: '/agents',
  });
  return (
    <ProductPage>
      <div class="agents-hero">
        <ProductHero
          product="Agents"
          title={['Agents that know', 'what your team is doing.']}
          description={[
            'Give agents your company’s context',
            'to get things done alongside your team.',
          ]}
          cta="agents_hero_get_started"
        />
      </div>
      <WorkspaceDesktopDemo
        heroFrame
        view="messages"
        agentShowcase
        desktopWidth={1000}
        label="Delegate work from a team conversation"
      />
      <nav class="feature-page-jump-links" aria-label="On this page">
        <a onClick={revisitSection} href="#agent-sources">
          <ContextGraphic />
          <span>Your personal agent</span>
        </a>
        <a onClick={revisitSection} href="#agent-actions">
          <EditingGraphic />
          <span>Tools to act</span>
        </a>
        <a onClick={revisitSection} href="#agent-collaboration">
          <ThreadGraphic />
          <span>Agents on your team</span>
        </a>
        <a onClick={revisitSection} href="#existing-agents">
          <LinkedWorkGraphic />
          <span>Bring your own agent</span>
        </a>
      </nav>
      <FeaturePageSection
        id="agent-sources"
        title={['Give your agent the full', 'context of your team’s work.']}
        description="Macro gives your agent access to your team’s calendar, conversations, and files, so it can use the full context of your work to help you get more done."
      >
        <DemoInteractionBoundary
          class="feature-page-visual"
          render={() => <AgentMeetingStory />}
        />
      </FeaturePageSection>
      <FeaturePageSection
        id="agent-actions"
        title={['Work with your agent', 'across the workspace.']}
        description="Work with your agent in the chats and documents your team already uses. Add context, ask for updates, and review the result without leaving your workspace."
      >
        <DemoInteractionBoundary
          class="feature-page-visual"
          render={() => <AgentDeliverableStory />}
        />
      </FeaturePageSection>
      <FeaturePageSection
        id="agent-collaboration"
        title={['Turn conversations', 'into finished work.']}
        description="Bring design and implementation into the team conversation. Ask Macro for a mockup, give feedback together, then tag Cursor to build it using the context already in the channel."
      >
        <DemoInteractionBoundary
          class="feature-page-visual"
          render={() => <AgentTeamworkStory />}
        />
      </FeaturePageSection>
      <FeaturePageSection
        id="existing-agents"
        title="Bring your own agent."
        description="Give the agent you already use access to the context and tools in Macro."
      >
        <div class="agents-connections">
          <div class="agents-connection-paths">
            <div class="agents-connection-path">
              <h3>Your agent, inside Macro</h3>
              <p>
                Bring Claude Code, OpenCode, OpenClaw, or Hermes into your
                workspace. Connect through macrod and keep your agent running on
                your machine.
              </p>
              <a
                class="agents-setup-link"
                href="https://docs.macro.com/AI/bring-your-own"
              >
                Connect your agent <ArrowUpRight aria-hidden="true" />
              </a>
            </div>
            <div class="agents-connection-path">
              <h3>Macro, inside your agent</h3>
              <p>
                Use Macro from Claude, ChatGPT, Cursor, or another MCP client.
                Search your workspace and work with its documents and tasks from
                there.
              </p>
              <a
                class="agents-setup-link"
                href="https://docs.macro.com/AI/mcp/overview"
              >
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
        id="agents-faq-title"
        title="Questions about Macro Agents"
        items={agentsFaq}
      />
      <HomepageClosing />
    </ProductPage>
  );
}
