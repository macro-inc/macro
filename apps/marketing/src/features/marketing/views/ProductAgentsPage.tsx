import ArrowUpRight from '@phosphor/arrow-up-right.svg';
import CaretDown from '@phosphor/caret-down.svg';
import { setPageSeo } from '../../../app/utils/utilSeo';
import { AgentMcpSetup } from '../components/agents/AgentStories';
import {
  AgentDeliverableStory,
  AgentMeetingStory,
  AgentTeamworkStory,
} from '../components/agents/AgentWorkflowStories';
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
    q: 'Can I choose a different model?',
    a: 'Yes. Choose from the models in Macro’s agent picker when starting or continuing a conversation. A connected agent uses the models supported by its own runtime.',
  },
  {
    q: 'Whose permissions does an agent use?',
    a: 'Hosted agents use the conversation owner’s access. Someone else prompting a shared conversation may need the owner’s approval. Connected agents also follow their own permission settings.',
  },
  {
    q: 'Can I review an email before it goes out?',
    a: 'Yes. Review and edit the draft in the conversation, then send it. In a channel or document discussion, the agent asks for confirmation in the thread. External clients have their own review controls.',
  },
  {
    q: 'Can an agent work while I’m away?',
    a: 'Hosted agents can continue after you close the app. Local agents need your machine to stay online. Routines let you schedule recurring work.',
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
        title="An agent that knows where to look."
        description="Your agent can follow connections across your company’s work and act on what it finds. A question about tomorrow’s calls can draw on your calendar, earlier conversations, and the latest customer messages."
      >
        <div class="feature-page-visual">
          <AgentMeetingStory />
        </div>
      </FeaturePageSection>
      <FeaturePageSection
        id="agent-actions"
        title="Work alongside your agent"
        description="Your team can open the same document, add context, and ask an agent to update it. Changes happen in the shared file."
      >
        <div class="feature-page-visual">
          <AgentDeliverableStory />
        </div>
      </FeaturePageSection>
      <FeaturePageSection
        id="agent-collaboration"
        title="Bring your agents into team chat."
        description="Ask Macro for a mockup, give feedback, then tag Cursor to build it."
      >
        <div class="feature-page-visual">
          <AgentTeamworkStory />
        </div>
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
        title="Models, permissions, and control."
        items={agentsFaq}
      />
      <HomepageClosing />
    </ProductPage>
  );
}
