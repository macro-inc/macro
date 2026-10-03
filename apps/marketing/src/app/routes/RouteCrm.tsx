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
import {
  FeaturePageFaq,
  FeaturePageSection,
} from '../../features/marketing/components/FeaturePage';
import { HomepageClosing } from '../../features/marketing/components/HomepageClosing';
import { HomepageConversation } from '../../features/marketing/components/HomepageConversation';
import {
  ProductHero,
  ProductPage,
  ProductProse,
} from '../../features/marketing/components/product/ProductPage';
import { WorkspaceDesktopDemo } from '../../features/marketing/components/WorkspaceDesktopDemo';
import { setPageSeo } from '../utils/utilSeo';
import '../../features/marketing/components/crm/crm-page.css';

const loadPipeline = () =>
  import('../../features/marketing/components/HomepageCrm');
const PipelineDemo = lazy(loadPipeline);

const faqItems = [
  {
    q: 'How are companies and contacts created?',
    a: 'From your email. When someone on your team emails a person at a new domain, Macro creates the contact and the company, and groups everyone from that domain under it. Personal addresses like Gmail don’t become companies. You can also add companies by hand or import a CSV.',
  },
  {
    q: 'What is automatic enrichment?',
    a: 'When Macro creates a company, it looks up the domain and adds a short description from public sources, so you know who they are without opening another tab. Stage, owner, revenue, and everything else you know about the deal are yours to fill in.',
  },
  {
    q: 'Can I update records myself?',
    a: 'Yes. Drag a company to a new stage on the board, or open it and change Stage, Owner, Revenue, or any custom property you’ve added. Agents edit the same properties, so their changes and yours end up in the same place.',
  },
  {
    q: 'Where does the team discuss a customer?',
    a: 'On the company. Every company has a Discussion that works like a thread in a channel: reply, react, and @mention people, docs, or tasks. The pricing conversation stays with the customer instead of scrolling away in #sales.',
  },
  {
    q: 'Can I mention a company in a document or channel?',
    a: 'Yes. Type @ and pick it from Companies. The mention links to the company’s record, and opening it follows the record’s normal access rules.',
  },
  {
    q: 'What can agents do with the CRM?',
    a: 'Agents can list companies, read a record with its contacts and properties, and set Stage, Owner, Revenue, or your custom properties. @mention Claude in a company’s Discussion, or ask in a channel after your sales sync. The same tools are on our MCP server, so Claude, ChatGPT, and Cursor can use them too.',
  },
  {
    q: 'Is CRM available for my account?',
    a: 'We’re rolling it out. If you don’t see Customers in your sidebar yet, it hasn’t reached your account. And being open source doesn’t make your data public: Macro’s code is AGPLv3, but your companies, contacts, and emails stay private to your team.',
  },
];

export function RouteCrm() {
  setPageSeo({
    title: 'Macro CRM — The CRM That Updates Itself',
    description:
      'Companies and contacts built from your email, enriched automatically, and kept current by agents. Right in your workspace, so there’s no separate tool to check.',
    path: '/crm',
  });
  return (
    <ProductPage>
      <ProductHero
        product="CRM"
        title={['The CRM that', 'updates itself.']}
        description={[
          'Built from your email and calls, kept current by agents.',
          'Right in your workspace, so there’s no separate tool to check.',
        ]}
        cta="crm_hero_get_started"
      />
      <WorkspaceDesktopDemo
        view="crm"
        label="Explore Macro CRM"
        caption="A sample pipeline. Drag a company to a new stage or open its record."
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
        title="Nobody has to update the CRM."
        description={
          'Tell @Claude what happened on the call and it updates the stage, owner, and notes.\nOr let it read the email thread and work it out.'
        }
      >
        <div class="feature-page-visual">
          <CrmCaptureDemo />
        </div>
        <ProductProse>
          <p>
            Every CRM is useful when it’s up to date, and every keystroke it
            takes to get there is a chore. That’s why most of them go stale.
            Auto-updating CRMs like Attio and Lightfield help, but they’re still
            another tool someone has to check. Macro’s CRM lives in the same
            workspace as your email, calls, and chat, and agents keep it current
            from those conversations.
          </p>
        </ProductProse>
      </FeaturePageSection>
      <FeaturePageSection
        id="crm-enrichment"
        title="Every company, already researched."
        description={
          'New companies show up from your email with a description from public sources.\nYour team adds what only you know.'
        }
      >
        <div class="feature-page-visual">
          <CrmEnrichmentDemo />
        </div>
        <ProductProse>
          <p>
            When you email someone new, Macro creates the contact and the
            company from their domain and fills in what’s publicly known about
            them. You don’t start from a blank record, and you don’t need a
            separate enrichment tool to do it.
          </p>
        </ProductProse>
      </FeaturePageSection>
      <FeaturePageSection
        id="crm-context"
        title="The whole relationship in one record."
        description={
          'Emails, calls, files, and tasks for every company, one tab away.\nComments are threaded like chat, so notes don’t get lost in Slack.'
        }
      >
        <div class="feature-page-visual">
          <CrmRecordDemo />
        </div>
        <ProductProse>
          <p>
            Open a company and it’s all there: the people you talk to, every
            email thread, every call, the files you’ve sent, and the tasks in
            flight. The discussion on each record works like a channel thread,
            so the note about pricing lives on the customer instead of somewhere
            in #sales. Mention the company in a doc or channel and it links
            straight back here.
          </p>
        </ProductProse>
      </FeaturePageSection>
      <FeaturePageSection
        id="crm-agents"
        title="Your agents get the same CRM."
        description={
          'Agents can read companies and their contacts and update company properties with the same tools you see in the app.\nUse them for outbound, research, or keeping the pipeline current.'
        }
      >
        <div class="feature-page-visual crm-agent-scene">
          <HomepageConversation
            messages={[
              {
                person: 'valentina',
                text: (
                  <>
                    <span class="homepage-person-mention">@Claude</span>, update
                    the pipeline from our sales sync. Northwind asked for a
                    proposal, and Lumen signed.
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
        <ProductProse>
          <p>
            We treat Macro’s MCP server as seriously as the interface. Agents
            can list companies, read a record, and update its properties,
            whether they’re running in Macro or in Claude, ChatGPT, or Cursor.
            Tell one which deals moved after your sales sync and the pipeline
            updates while you get on with your day.
          </p>
        </ProductProse>
      </FeaturePageSection>
      <FeaturePageFaq
        id="crm-faq-title"
        title="Questions about Macro CRM"
        introduction={
          <p>
            If you’re coming from HubSpot, Attio, or a spreadsheet, here’s
            what’s different.
          </p>
        }
        items={faqItems}
      />
      <CrmComparison />
      <HomepageClosing />
    </ProductPage>
  );
}
