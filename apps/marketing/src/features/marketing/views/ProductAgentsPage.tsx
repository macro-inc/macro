import ArrowUpRight from '@icon/system/regular/arrow-up-right.svg';
import CaretDown from '@icon/system/regular/caret-down.svg';
import { setPageSeo } from '../../../app/utils/utilSeo';
import { AgentMcpSetup } from '../components/agents/AgentMcpSetup';
import { FeaturePageFaq, FeaturePageSection } from '../components/FeaturePage';
import { HomepageClosing } from '../components/HomepageClosing';
import { ProductHero, ProductPage } from '../components/product/ProductPage';
import { TutorialVideoEmbed } from '../components/TutorialVideoEmbed';
import './agents-page.css';
import { FeaturePhoneScreens } from '../components/FeatureScreenshot';
import { featureScreens, phoneScreens } from '../core/feature-screens';

const agentsFaq = [
  {
    q: 'What can Macro’s agents do?',
    a: 'Search your workspace, draft emails, edit documents, create tasks, and update customer records. Start a conversation in Agents or mention an available agent in a channel.',
  },
  {
    q: 'Can I use my existing AI client?',
    a: (
      <>
        Yes. Connect an MCP-compatible client to your Macro account so it can
        work with your workspace. Follow the{' '}
        <a href="/docs/AI/mcp/overview">MCP setup guide</a>. Running a local
        agent inside Macro is a separate feature; check the{' '}
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
        <a href="/email">Macro Mail</a>.
      </>
    ),
  },
  {
    q: 'Can agents work while I’m away?',
    a: 'Hosted agents can continue after you close the app and scheduled routines can run recurring work. Local agents need their computer and runtime to stay online.',
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
  setPageSeo({
    title: 'Macro Agents — Bring your favorite agents',
    description:
      'Macro develops a shared understanding of what everyone on your team is working on. Unified memory and tools work across model providers.',
    path: '/agents',
  });
  return (
    <ProductPage>
      <div class="agents-hero">
        <ProductHero
          product="Agents"
          title="Agents with omniscient context."
          description="Agents work inside your workspace with shared team memory, live editing tools, and your choice of built-in models or external coding agents."
          cta="agents_hero_get_started"
          tutorial="agents"
        />
      </div>
      <FeaturePageSection
        id="agent-sources"
        title="Unified memory across your whole team."
        description="ChatGPT and Claude only remember your own prompts. Macro builds shared memory from your team’s Macro Mail, Macro Chat, Macro Docs, Macro Tasks, and Macro Calls—so agents know who owns what."
        screen={featureScreens['agent-sources']}
      />
      <FeaturePageSection
        id="agent-collaboration"
        title="First-class citizens just like people."
        description="Tag an agent in Macro Chat or assign it a ticket in Macro Tasks like any teammate. Hosted agents keep running after you close your laptop and sync across devices."
        screen={featureScreens['agent-collaboration']}
      />
      <FeaturePageSection
        id="agent-actions"
        title="One search tool across everything."
        description="Agents get one fast search tool across every email, thread, doc, file, and call transcript instead of burning calls across rate-limited SaaS connectors."
        screen={featureScreens['agent-actions']}
      />
      <FeaturePageSection
        id="existing-agents"
        title="Bring your own agents."
        description="Point Claude Code, Codex, or any MCP client at your workspace—or run agents on your own machine with macrod. Your team’s memory and Macro’s tools work with all the latest models from every provider so you’re never locked into one."
        screen={featureScreens['existing-agents']}
      >
        <div class="agents-connections">
          <div class="agents-connection-paths">
            <div class="agents-connection-path">
              <h3>Your agent inside Macro</h3>
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
              <h3>Macro inside your agent</h3>
              <p>
                Use Macro from Claude, ChatGPT, Cursor, or another MCP client.
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
      <FeaturePhoneScreens screens={phoneScreens['agents']} product="Agents" />
      <FeaturePageFaq
        guide={{ href: '/agents#guide', label: 'agents' }}
        id="agents-faq-title"
        title="Questions about Macro Agents"
        items={agentsFaq}
      />
      <HomepageClosing />
    </ProductPage>
  );
}
