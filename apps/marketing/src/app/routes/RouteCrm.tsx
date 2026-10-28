import { lazy } from 'solid-js';
import { CrmCaptureDemo } from '../../features/marketing/components/crm/CrmCaptureDemo';
import { CrmComparison } from '../../features/marketing/components/crm/CrmComparison';
import { CrmEnrichmentDemo } from '../../features/marketing/components/crm/CrmEnrichmentDemo';
import {
  AgentIllustration,
  CaptureIllustration,
  ContextIllustration,
  EnrichmentIllustration,
} from '../../features/marketing/components/crm/CrmFeatureIllustrations';
import { CrmRecordDemo } from '../../features/marketing/components/crm/CrmRecordDemo';
import {
  DeferredDemo,
  DemoPlaceholder,
} from '../../features/marketing/components/DeferredDemo';
import { DemoInteractionBoundary } from '../../features/marketing/components/DemoInteractionBoundary';
import {
  FeaturePageFaq,
  FeaturePageSection,
} from '../../features/marketing/components/FeaturePage';
import { HomepageClosing } from '../../features/marketing/components/HomepageClosing';
import {
  ProductHero,
  ProductPage,
} from '../../features/marketing/components/product/ProductPage';
import { WorkspaceDesktopDemo } from '../../features/marketing/components/WorkspaceDesktopDemo';
import { DEMO_BOOKING_URL } from '../../features/marketing/core/navigation';
import { setPageSeo } from '../utils/utilSeo';
import '../../features/marketing/components/crm/crm-page.css';
import '../../features/marketing/components/homepage-pipeline-demo.css';

const loadPipeline = () =>
  import('../../features/marketing/components/homepage/CrmPipelineScene');
const PipelineDemo = lazy(loadPipeline);
const loadFollowup = async () => ({
  default: (
    await import('../../features/marketing/components/crm/CrmFollowupDemo')
  ).CrmFollowupDemo,
});
const FollowupDemo = lazy(loadFollowup);

const faqItems = [
  {
    q: 'How do I start using CRM?',
    a: 'Open Customers in Macro. Your team needs CRM enabled; a new team can enable it from CRM settings. You can then add companies, contacts, and pipelines.',
  },
  {
    q: 'How are companies and contacts added?',
    a: 'Macro creates company and contact records from your team’s primary connected email accounts. You can also add records manually or import a CSV. Personal email domains do not become companies.',
  },
  {
    q: 'Can I track deals in a board or table?',
    a: 'Yes. Create a pipeline and use table or kanban views. Drag a card between stages or edit its fields directly. Pipeline stages, owners, and revenue are separate from the company record’s properties.',
  },
  {
    q: 'What does automatic enrichment add?',
    a: 'Macro uses a company’s domain to add public company information. Deal details such as stage, owner, and revenue come from you or your agents.',
  },
  {
    q: 'What customer context can my agent use?',
    a: (
      <>
        Agents can read accessible customer emails, calls, chats, files, and
        tasks to draft follow-ups and identify next steps. They can also update
        CRM fields. See <a href="/agents">Macro Agents</a> or{' '}
        <a href="https://docs.macro.com/AI/mcp/overview">
          connect an AI client through MCP
        </a>
        .
      </>
    ),
  },
  {
    q: 'Where can my team discuss a customer?',
    a: (
      <>
        Use the company’s Discussion to keep notes and replies with the record.
        Mention teammates, files, or tasks, and link the company from a{' '}
        <a href="/channels">channel</a> or <a href="/documents">document</a>.
      </>
    ),
  },
  {
    q: 'Who can see a pipeline I share?',
    a: 'Share a pipeline with your team, specific people, or a channel and choose their access level. Viewers can read it; editors can update it. Review the Share dialog before sharing customer information.',
  },
  {
    q: 'Where can I check pricing and CRM access?',
    a: (
      <>
        See <a href="/pricing">Macro’s current plans and limits</a>. If you need
        help enabling CRM for your team,{' '}
        <a href={DEMO_BOOKING_URL}>talk to us</a>.
      </>
    ),
  },
];

export function RouteCrm() {
  setPageSeo({
    title: 'Macro CRM — The Self-Building CRM',
    description:
      'Companies and contacts built from your email, enriched automatically, and kept current by agents. Right in your workspace, so there’s no separate tool to check.',
    path: '/crm',
  });
  return (
    <ProductPage>
      <ProductHero
        product="CRM"
        title={['The CRM connected', 'to your team’s work.']}
        description={[
          'Agents update customer records',
          'from emails, calls, chats, and tasks.',
        ]}
        cta="crm_hero_get_started"
      />
      <WorkspaceDesktopDemo
        heroFrame
        windowChrome={false}
        view="crm"
        label="Explore Macro CRM"
        render={() => (
          <DeferredDemo
            preload={loadPipeline}
            fallback={<DemoPlaceholder label="Sales pipeline" />}
          >
            <PipelineDemo hero />
          </DeferredDemo>
        )}
      />
      <nav
        class="feature-page-jump-links crm-feature-links"
        aria-label="On this page"
      >
        <a href="#crm-from-email">
          <span class="crm-feature-illustration">
            <CaptureIllustration />
          </span>
          <span>Updated by agents</span>
        </a>
        <a href="#crm-enrichment">
          <span class="crm-feature-illustration">
            <EnrichmentIllustration />
          </span>
          <span>Auto-enriched</span>
        </a>
        <a href="#crm-context">
          <span class="crm-feature-illustration">
            <ContextIllustration />
          </span>
          <span>The whole relationship</span>
        </a>
        <a href="#crm-agents">
          <span class="crm-feature-illustration">
            <AgentIllustration />
          </span>
          <span>Agents and MCP</span>
        </a>
      </nav>
      <FeaturePageSection
        id="crm-from-email"
        title={['Keep your CRM', 'up to date with agents.']}
        description="Your agent can read customer emails, calls, and chats, then update stages, owners, and next steps in your CRM."
      >
        <DemoInteractionBoundary
          class="feature-page-visual"
          render={() => <CrmCaptureDemo />}
        />
      </FeaturePageSection>
      <FeaturePageSection
        id="crm-enrichment"
        title={['Automatically add and', 'enrich new contacts.']}
        description="When you email someone new, Macro creates the contact and company from their domain. Public company details fill in the record, so you have a starting point before the first meeting."
      >
        <DemoInteractionBoundary
          class="feature-page-visual"
          render={() => <CrmEnrichmentDemo />}
        />
      </FeaturePageSection>
      <FeaturePageSection
        id="crm-context"
        title={['Connect calls, emails, and', 'tasks to each customer.']}
        description="Open a company to see the people, emails, calls, files, and tasks behind the relationship. Keep notes on the record so your team understands what happened and what comes next."
      >
        <DemoInteractionBoundary
          class="feature-page-visual"
          render={() => <CrmRecordDemo />}
        />
      </FeaturePageSection>
      <FeaturePageSection
        id="crm-agents"
        title={['Draft follow-ups and plan', 'next steps with your agent.']}
        description="Your agent can read the full customer relationship across emails, calls, chats, files, tasks, and GitHub pull requests. Use that context to draft better follow-up emails and move deals forward."
      >
        <DemoInteractionBoundary
          class="feature-page-visual crm-agent-scene"
          render={() => (
            <DeferredDemo
              preload={loadFollowup}
              fallback={<DemoPlaceholder label="Customer follow-up" />}
            >
              <FollowupDemo />
            </DeferredDemo>
          )}
        />
      </FeaturePageSection>
      <CrmComparison />
      <FeaturePageFaq
        id="crm-faq-title"
        title="Questions about Macro CRM"
        items={faqItems}
      />
      <HomepageClosing />
    </ProductPage>
  );
}
