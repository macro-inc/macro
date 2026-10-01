import MacroLogo from '@icon/macro-logo.svg';
import { lazy } from 'solid-js';
import { CrmCaptureDemo } from '../../features/marketing/components/crm/CrmCaptureDemo';
import { CrmComparison } from '../../features/marketing/components/crm/CrmComparison';
import { CrmConnectedWorkDemo } from '../../features/marketing/components/crm/CrmConnectedWorkDemo';
import { CrmEnrichmentDemo } from '../../features/marketing/components/crm/CrmEnrichmentDemo';
import {
  AgentIllustration,
  CaptureIllustration,
  ContextIllustration,
} from '../../features/marketing/components/crm/CrmFeatureIllustrations';
import { CrmRecordDemo } from '../../features/marketing/components/crm/CrmRecordDemo';
import {
  DeferredDemo,
  DemoPlaceholder,
} from '../../features/marketing/components/DeferredDemo';
import {
  FeaturePage,
  FeaturePageCta,
  FeaturePageFaq,
  FeaturePageSection,
} from '../../features/marketing/components/FeaturePage';
import { HomepageClosing } from '../../features/marketing/components/HomepageClosing';
import { HomepageConversation } from '../../features/marketing/components/HomepageConversation';
import { WorkspaceDesktopDemo } from '../../features/marketing/components/WorkspaceDesktopDemo';
import { setPageSeo } from '../utils/utilSeo';
import '../../features/marketing/components/crm/crm-page.css';

const loadPipeline = () =>
  import('../../features/marketing/components/HomepageCrm');
const PipelineDemo = lazy(loadPipeline);

const faqItems = [
  {
    q: 'How are companies and contacts created?',
    a: 'Macro creates contacts from external email conversations and groups them into companies by email domain. Contacts from the same company stay together, with their first and latest interactions.',
  },
  {
    q: 'What is automatic enrichment?',
    a: 'Macro adds public company information such as its website, description, industry, location, and size. Your team can add the details specific to your relationship.',
  },
  {
    q: 'Can I update records myself?',
    a: 'Yes. Change properties such as the deal stage and owner, and add notes directly to the company record.',
  },
  {
    q: 'Where does the team discuss a customer?',
    a: 'Every company and contact has its own discussion thread. Add notes, reply to teammates, and link relevant documents and tasks so the conversation stays with the record.',
  },
  {
    q: 'Can I mention a company in a document or channel?',
    a: 'Yes. Mention a company or contact to create a link to its record. Sharing follows the record’s access rules and your permission to share it.',
  },
  {
    q: 'What can agents do with the CRM?',
    a: 'Agents can use the customer record and available emails, calls, documents, and tasks to answer questions and update properties. Give the agent a specific request, such as updating the pipeline from your latest sales sync.',
  },
  {
    q: 'Is CRM available for my account?',
    a: 'CRM is rolling out. If the Companies view is not visible in your workspace, it may not have reached your account yet. Macro is open source under AGPLv3; the application code being public does not make your customer records public.',
  },
];

export function RouteCrm() {
  setPageSeo({
    title: 'Macro CRM — The Self-Building CRM',
    description:
      'Build your CRM from email, enrich company records, and keep customer conversations connected to your team’s work. Let agents help update the pipeline.',
    path: '/crm',
  });
  return (
    <FeaturePage>
      <div class="crm-feature-page">
        <header class="crm-page-hero">
          <p class="crm-page-label">
            <MacroLogo aria-hidden="true" />
            <span>Macro CRM</span>
          </p>
          <h1>
            <span>CRM that makes money</span>
            <span>and updates itself.</span>
          </h1>
          <p class="crm-page-description">
            <span>Companies and contacts created from your email.</span>{' '}
            <span>Enriched automatically. Updated by agents.</span>
          </p>
          <FeaturePageCta name="crm_hero_get_started" />
        </header>
        <WorkspaceDesktopDemo
          view="crm"
          label="Try Macro CRM"
          caption="Explore the pipeline. Open a company, update its stage, or add a note."
        />
        <nav class="crm-feature-links" aria-label="On this page">
          <a href="#crm-from-email">
            <span class="crm-feature-illustration">
              <CaptureIllustration />
            </span>
            <span>Updates from conversation</span>
          </a>
          <a href="#crm-context">
            <span class="crm-feature-illustration">
              <ContextIllustration />
            </span>
            <span>Emails and customer records</span>
          </a>
          <a href="#crm-agents">
            <span class="crm-feature-illustration">
              <AgentIllustration />
            </span>
            <span>Agents keep it current</span>
          </a>
        </nav>
        <FeaturePageSection
          id="crm-from-email"
          title="Agents update your customer records."
          description={
            'Tell an agent what changed in a customer conversation.\nIt can update the owner, deal stage, and notes directly.'
          }
        >
          <div class="feature-page-visual crm-scene">
            <CrmCaptureDemo />
          </div>
          <div class="crm-feature-prose">
            <p>
              CRM tools let agents read company records and update their
              properties. Ask Claude to assign an owner, save rollout notes, or
              move a deal to the next stage. The changes appear in the customer
              record and pipeline board. Open the record to review the values or
              edit them yourself.
            </p>
          </div>
        </FeaturePageSection>
        <FeaturePageSection
          id="crm-enrichment"
          title="Company enrichment, automatically."
          description={
            'Email domains become company records.\nMacro adds available company information from public sources.'
          }
        >
          <div class="feature-page-visual crm-scene">
            <CrmEnrichmentDemo />
          </div>
          <div class="crm-feature-prose">
            <p>
              Macro creates contacts and companies from your email. The sender’s
              domain identifies the company, and enrichment adds available
              details such as its website, industry, location, and size. Your
              team can add its own properties, including deal stage, owner, and
              revenue. Those fields are available in the customer view and to
              agents through CRM tools.
            </p>
          </div>
        </FeaturePageSection>
        <FeaturePageSection
          id="crm-context"
          title="Customer emails in the customer record."
          description={
            'Open the company to see its contacts, emails, and team discussion.\nRead the original conversation before replying or joining a call.'
          }
        >
          <div class="feature-page-visual crm-scene">
            <CrmRecordDemo />
          </div>
          <div class="crm-feature-prose">
            <p>
              Customer records link the company’s contacts and email
              conversations. Each record has a discussion where your team can
              leave notes and @mention related work. An agent can read the
              record and available conversations before answering a question or
              updating a property. People can follow the same links to check its
              sources.
            </p>
          </div>
        </FeaturePageSection>
        <FeaturePageSection
          id="crm-connected-work"
          title="@mention customers in docs and chat."
          description={
            'A customer’s name becomes a link to its record.\nReference the company in a proposal, task, or channel message.'
          }
        >
          <div class="feature-page-visual crm-scene">
            <CrmConnectedWorkDemo />
          </div>
          <div class="crm-feature-prose">
            <p>
              Companies and contacts are workspace items you can @mention. Link
              the customer record in a rollout plan, a support request, or a
              team conversation. Opening the reference shows the customer’s
              details and related work. Your team can navigate from the request
              to the relationship it concerns.
            </p>
          </div>
        </FeaturePageSection>
        <FeaturePageSection
          id="crm-agents"
          title="Update the pipeline with a message."
          description={
            'Ask an agent to change deal stages from your latest sales conversation.\nThe updates appear directly in the pipeline board.'
          }
        >
          <div class="feature-page-visual crm-scene crm-agent-scene">
            <HomepageConversation
              messages={[
                {
                  person: 'valentina',
                  text: (
                    <>
                      <span class="homepage-person-mention">@Claude</span>,
                      update the pipeline from our sales sync. Northwind asked
                      for a proposal, and Lumen signed.
                    </>
                  ),
                },
              ]}
            />
            <div class="crm-pipeline-frame glass-input">
              <DeferredDemo
                preload={loadPipeline}
                fallback={
                  <DemoPlaceholder label="Agent updates the customer pipeline" />
                }
              >
                <PipelineDemo playbackControls={false} />
              </DeferredDemo>
            </div>
          </div>
          <div class="crm-feature-prose">
            <p>
              Tell the agent which customer asked for a proposal and which
              signed. Its CRM tools can read the records and set their stage
              properties. Macro’s MCP tools also expose company records and
              property updates to external agents. The pipeline and customer
              views read those same values.
            </p>
          </div>
        </FeaturePageSection>
        <FeaturePageFaq
          id="crm-faq-title"
          eyebrow="Email, enrichment, and agent tools"
          title="How Macro CRM works."
          introduction={
            <p>
              Company records built from email, enriched from public
              information, and editable by your team and agents.
            </p>
          }
          items={faqItems}
        />
        <CrmComparison />
        <HomepageClosing />
      </div>
    </FeaturePage>
  );
}
