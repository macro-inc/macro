import { lazy } from 'solid-js';
import { CrmCaptureDemo } from '../../features/marketing/components/crm/CrmCaptureDemo';
import { CrmComparison } from '../../features/marketing/components/crm/CrmComparison';
import { CrmEnrichmentDemo } from '../../features/marketing/components/crm/CrmEnrichmentDemo';
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
import { DEMO_BOOKING_URL } from '../../features/marketing/core/navigation';
import { setPageSeo } from '../utils/utilSeo';
import '../../features/marketing/components/crm/crm-page.css';
import '../../features/marketing/components/homepage-pipeline-demo.css';

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
        <a href="/docs/AI/mcp/overview">connect an AI client through MCP</a>.
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
    q: 'Does CRM share my customer emails with the team?',
    a: 'When Email Sync is on for a company, its threads are visible to your team in CRM. Turn it off to keep the threads private to their participants; the company record stays.',
  },
  {
    q: 'Who can see a pipeline I share?',
    a: 'Share a pipeline with your team, specific people, or a channel. Viewers can read it; editors can update it.',
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
    title: 'Macro CRM — Hands-free CRM',
    description:
      'CRM is built into the core workspace. It updates automatically and is always one block away, alongside email, tasks, docs, and channels.',
    path: '/crm',
  });
  return (
    <ProductPage>
      <ProductHero
        tutorial="crm"
        product="CRM"
        title="CRM that keeps itself up to date."
        description="Macro CRM stays up to date from your email and team chat. No separate tool to maintain."
        cta="crm_hero_get_started"
      />
      <FeaturePageSection
        id="crm-from-email"
        demo={{
          tone: 'crm',
        }}
        title="Tightly integrated with Macro Mail."
        description="Open a customer email right from their record, using the same email client you already use. Mention a company or contact in a channel, document, or task."
      >
        <DemoInteractionBoundary
          class="feature-page-visual"
          render={() => <CrmCaptureDemo />}
        />
      </FeaturePageSection>
      <FeaturePageSection
        id="crm-enrichment"
        demo={{
          tone: 'crm',
        }}
        title="Build customer records from email."
        description="Macro creates records from your team’s email and adds publicly available company information. Agents combine that with your team’s emails and calls to summarize the relationship."
      >
        <DemoInteractionBoundary
          class="feature-page-visual"
          render={() => <CrmEnrichmentDemo />}
        />
      </FeaturePageSection>
      <FeaturePageSection
        id="crm-context"
        demo={{
          tone: 'crm',
        }}
        title="Discuss customers on their records."
        description="Conversations on companies and contacts use the same threading system as your team chat. @mention a teammate and they receive a ping just like in a channel; it all goes into one inbox."
      >
        <DemoInteractionBoundary
          class="feature-page-visual"
          render={() => <CrmRecordDemo />}
        />
      </FeaturePageSection>
      <FeaturePageSection
        id="crm-tasks"
        title="Tightly integrated with Macro Tasks."
        description="Keep follow-ups connected to the customer. Mention a company or contact in a task, assign it to a teammate or agent, and track the work through to completion."
      />
      <FeaturePageSection
        id="crm-agents"
        demo={{
          tone: 'crm',
        }}
        title="Ask agents to update your CRM."
        description="Our MCP support is just as important to us as the user interface. Ask your agent to update a deal or draft a follow-up from the customer’s emails, calls, and notes."
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
        guide={{ href: '/crm#guide', label: 'CRM' }}
        id="crm-faq-title"
        title="Questions about Macro CRM"
        items={faqItems}
      />
      <HomepageClosing />
    </ProductPage>
  );
}
