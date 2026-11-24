import { CrmComparison } from '../../features/marketing/components/crm/CrmComparison';
import {
  FeaturePageFaq,
  FeaturePageSection,
} from '../../features/marketing/components/FeaturePage';
import { FeaturePhoneScreens } from '../../features/marketing/components/FeatureScreenshot';
import { HomepageClosing } from '../../features/marketing/components/HomepageClosing';
import {
  ProductHero,
  ProductPage,
} from '../../features/marketing/components/product/ProductPage';
import {
  featureScreens,
  phoneScreens,
} from '../../features/marketing/core/feature-screens';
import { DEMO_BOOKING_URL } from '../../features/marketing/core/navigation';
import { setPageSeo } from '../utils/utilSeo';

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
        Mention teammates, files, or tasks. You can also link the company from a{' '}
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
      'CRM is built into the core workspace. It updates automatically and lives one block away alongside email, tasks, docs, and channels.',
    path: '/crm',
  });
  return (
    <ProductPage>
      <ProductHero
        product="CRM"
        title="CRM that keeps itself up to date."
        description="CRM automatically tracks your companies, contacts, owners, and deal stages so you never have to log updates by hand."
        cta="crm_hero_get_started"
        tutorial="crm"
      />
      <FeaturePageSection
        id="crm-enrichment"
        title="Records build and update themselves."
        description="Most CRMs get out of date because updating them is a chore. Macro creates records from your team’s email and enriches every one with public sources. Agents blend that with your team’s emails and calls into a summary at the top of every company."
        screen={featureScreens['crm-enrichment']}
      />
      <FeaturePageSection
        id="crm-pipeline"
        title="Your pipeline as a board or a list."
        description="See your sales pipeline as a kanban board and drag deals between stages or switch to a table if you’d rather see a list. If you sell to people, create a pipeline of contacts instead; it works exactly the same way."
        screen={featureScreens['crm-pipeline']}
      />
      <FeaturePageSection
        id="crm-databases"
        title="Pipelines are just Macro Databases."
        description="A pipeline is a database of companies or contacts so it’s much more flexible than most CRMs. Add your own fields of any type, write formulas, filter and sort into saved views, and create as many pipelines as you need."
        screen={featureScreens['crm-databases']}
      />
      <FeaturePageSection
        id="crm-from-email"
        title="Macro Mail and Macro Calls on every record."
        description="Open a customer email right from their record in the same email client you already use. @mention a company or contact from Macro Chat, Macro Docs, or Macro Tasks and the record links back to it. No separate tool your team won’t check and no deciding who gets CRM seats."
        screen={featureScreens['crm-from-email']}
      />
      <FeaturePageSection
        id="crm-context"
        title="Every record gets a Macro Chat."
        description="Comments on companies and contacts use the same threading system as your channels so the conversation about a deal stays on the record instead of getting lost in Slack. @mention a teammate and they get a ping just like in a channel; it all goes into one inbox."
        screen={featureScreens['crm-context']}
      />
      <FeaturePageSection
        id="crm-agents"
        title="Macro Agents can do everything you can."
        description="Our MCP support is just as important to us as the user interface. Ask your agent to update a deal, draft a follow-up from the customer’s Macro Mail and Macro Calls, or set up Macro Routines that move deals to the right stage after every call."
        screen={featureScreens['crm-agents']}
      />
      <FeaturePhoneScreens screens={phoneScreens['crm']} product="CRM" />
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
