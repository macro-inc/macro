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
        title={['A CRM you don’t have', 'to keep updating.']}
        description={[
          'Built from your email. Kept current with agents.',
          'Part of the workspace your team already uses.',
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
        description="The problem with a CRM is keeping it current. Ask your agent to read the latest emails, calls, and discussion, then update the stage, owner, and next steps. The CRM sits beside that work instead of being another system to check."
      >
        <DemoInteractionBoundary
          class="feature-page-visual"
          render={() => <CrmCaptureDemo />}
        />
      </FeaturePageSection>
      <FeaturePageSection
        id="crm-enrichment"
        title={['Automatically add and', 'enrich new contacts.']}
        description="Macro creates companies and contacts from your team’s connected email and adds public company information. Agents can combine that information with your own conversations to summarize the relationship. Less research and data entry before the first meeting."
      >
        <DemoInteractionBoundary
          class="feature-page-visual"
          render={() => <CrmEnrichmentDemo />}
        />
      </FeaturePageSection>
      <FeaturePageSection
        id="crm-context"
        title={['Keep the discussion', 'on the customer record.']}
        description="Emails on the left, properties on the right, a summary at the top. Leave a threaded comment on the company or contact, using the same chat your team already knows. The conversation stays attached to the customer instead of getting lost in a separate app."
      >
        <DemoInteractionBoundary
          class="feature-page-visual"
          render={() => <CrmRecordDemo />}
        />
      </FeaturePageSection>
      <FeaturePageSection
        id="crm-agents"
        title={['Your agent can work', 'in the CRM, too.']}
        description="Ask an agent to research a company, update a record, or draft a follow-up from the latest call. We treat MCP as part of the product, so agents you connect can read customer context and update records, too."
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
