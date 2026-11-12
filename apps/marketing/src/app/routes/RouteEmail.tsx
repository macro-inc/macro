import { CrmRecordDemo } from '../../features/marketing/components/crm/CrmRecordDemo';
import { DemoInteractionBoundary } from '../../features/marketing/components/DemoInteractionBoundary';
import { EmailAgenticEditingDemo } from '../../features/marketing/components/email/EmailAgenticEditingDemo';
import { EmailAutoTagDemo } from '../../features/marketing/components/email/EmailAutoTagDemo';
import { EmailComparison } from '../../features/marketing/components/email/EmailComparison';
import { EmailKeyboardDemo } from '../../features/marketing/components/email/EmailKeyboardDemo';
import { EmailShareStory } from '../../features/marketing/components/email/EmailShareStory';
import { EmailSignalNoiseDemo } from '../../features/marketing/components/email/EmailSignalNoiseDemo';
import {
  FeaturePage,
  FeaturePageCta,
  FeaturePageFaq,
  FeaturePageSection,
} from '../../features/marketing/components/FeaturePage';
import { HomepageClosing } from '../../features/marketing/components/HomepageClosing';
import { PaperEmailAccounts } from '../../features/marketing/components/paper/PaperEmailAccounts';
import { PaperFeatureGraphic } from '../../features/marketing/components/paper/PaperFeatureGraphic';
import { ProductIntroduction } from '../../features/marketing/components/product/ProductIntroduction';
import { ProductBrand } from '../../features/marketing/components/product/ProductPage';
import { TutorialVideoEmbed } from '../../features/marketing/components/TutorialVideoEmbed';
import { TaskContextDemo } from '../../features/marketing/components/tasks/TaskContextDemo';
import { setPageSeo } from '../utils/utilSeo';
import '../../features/marketing/components/crm/crm-page.css';
import '../../features/marketing/components/email/email-hero.css';

const faqItems = [
  {
    q: 'Which email accounts can I connect?',
    a: (
      <>
        Macro supports Gmail and Google Workspace. Connect an account in
        Settings and keep using Gmail or Superhuman alongside Macro. Macro
        connects directly to your Gmail account, so you don’t need to stop using
        another email client. See the{' '}
        <a href="/email#guide">email setup guide</a>.
      </>
    ),
  },
  {
    q: 'Can I use my personal and work inboxes together?',
    a: (
      <>
        Yes. Connect multiple accounts, view them together, or filter to one
        inbox. When composing, choose which connected address to send from.
        Account limits depend on your <a href="/pricing">plan</a>.
      </>
    ),
  },
  {
    q: 'Can an agent draft replies for me?',
    a: (
      <>
        Yes. Ask an agent to draft a reply using the thread, your docs, or a
        call transcript. Edit the draft before sending. Learn more about{' '}
        <a href="/agents">Macro Agents</a>.
      </>
    ),
  },
  {
    q: 'How do Signal and Noise work?',
    a: 'Signal groups important conversations; Noise groups lower-priority mail such as newsletters and promotions. Right-click a thread to change how its sender is classified.',
  },
  {
    q: 'Can my team read an email I share?',
    a: (
      <>
        Yes. Sharing gives recipients access to the full thread, including new
        replies. It does not let them send replies from your mailbox. See{' '}
        <a href="/channels">sharing email in team chat</a>.
      </>
    ),
  },
  {
    q: 'What happens when I mention a document in an email?',
    a: 'Macro inserts a link and makes the document viewable by anyone with that link. Check the document before including it in an external email.',
  },
  {
    q: 'Does Macro get my Google password?',
    a: 'No. You authorize the connection on Google, and Macro receives access tokens rather than your password.',
  },
  {
    q: 'Is my email used to train AI?',
    a: (
      <>
        Data received through Google Workspace APIs is not used to train
        generalized AI models. See our <a href="/privacy">Privacy Policy</a> for
        data use details.
      </>
    ),
  },
  {
    q: 'How do I disconnect an account?',
    a: (
      <>
        Disconnect in Macro’s Settings or revoke access from your Google
        account. Disconnecting does not delete data already stored in Macro. See
        the <a href="/privacy">Privacy Policy</a> for deletion details.
      </>
    ),
  },
  {
    q: 'Can I try Macro for free?',
    a: (
      <>
        Yes. Macro has a free plan with usage limits. See{' '}
        <a href="/pricing">plans and limits</a> for details.
      </>
    ),
  },
];

export function RouteEmail() {
  setPageSeo({
    title: 'Macro Mail — Brilliantly fast email',
    description:
      'Macro brings all of your email accounts into one inbox, with unified search. Share emails with internal channels and draft and send emails from the agent.',
    path: '/email',
  });

  return (
    <FeaturePage productSpacing>
      <header class="feature-page-hero email-page-hero email-page-hero--mail">
        <ProductBrand product="Email" />
        <h1>Organized and prioritized email.</h1>
        <p class="email-page-hero-description">
          Macro Mail tags and prioritizes email from all your accounts, with
          Superhuman shortcuts and Opus intelligence.
        </p>
        <div class="feature-page-hero-actions">
          <FeaturePageCta name="email_hero_get_started" />
        </div>
      </header>
      <TutorialVideoEmbed tutorial="mail" />
      <ProductIntroduction product="Email" />
      <FeaturePageSection
        id="keyboard-speed"
        demo={{
          tone: 'email',
        }}
        title="Navigate with Superhuman speed."
        description="We bring your emails into our own database so we’re not bottlenecked by Gmail’s API. Use J, K, and E to navigate and mark emails done, or open splits to draft and search side by side."
      >
        <DemoInteractionBoundary
          class="feature-page-visual"
          render={() => <EmailKeyboardDemo />}
        />
      </FeaturePageSection>
      <FeaturePageSection
        id="email-accounts"
        title="All your accounts in one inbox."
        description="Triage all your email accounts in a single inbox, or one at a time. We backfill everything, so search is split-second across every account."
      >
        <PaperFeatureGraphic label="Switch between all inboxes, individual accounts, and email aliases.">
          <PaperEmailAccounts />
        </PaperFeatureGraphic>
      </FeaturePageSection>
      <FeaturePageSection
        id="signal-noise"
        demo={{
          tone: 'email',
        }}
        title="Signal vs. Noise."
        description="Signal is your important email. Noise is the newsletters, receipts, and inbound you don’t need to see first. Macro separates them for you, so you can focus on what matters."
      >
        <DemoInteractionBoundary
          class="feature-page-visual"
          render={() => <EmailSignalNoiseDemo />}
        />
      </FeaturePageSection>
      <FeaturePageSection
        id="email-sharing"
        demo={{ tone: 'email', glassFrame: false }}
        title="Share email in Macro Chat, no screenshots."
        description="Share an email in a channel without taking a screenshot of Gmail and pasting it in Slack. Your team sees the full thread, including future replies, so they’re not asking what happened after your screenshot."
      >
        <DemoInteractionBoundary
          class="feature-page-visual"
          render={() => <EmailShareStory />}
        />
      </FeaturePageSection>
      <FeaturePageSection
        id="agentic-editing"
        demo={{
          tone: 'email',
        }}
        title="Draft and send with Macro Agents."
        description="The agent can search prior interactions with people and build up context before drafting the email. You can iterate with it and then hit send without leaving the agent."
      >
        <DemoInteractionBoundary
          class="feature-page-visual"
          render={() => <EmailAgenticEditingDemo />}
        />
      </FeaturePageSection>
      <FeaturePageSection
        id="email-to-task"
        demo={{
          tone: 'email',
        }}
        title="Turn emails into Macro Tasks."
        description="Create a task from the thread and assign it without leaving your inbox. The email stays linked as the source, so the original conversation is one click away, and you can see when it’s resolved."
      >
        <DemoInteractionBoundary
          class="feature-page-visual"
          render={() => <TaskContextDemo />}
        />
      </FeaturePageSection>
      <FeaturePageSection
        id="email-crm"
        demo={{
          tone: 'email',
        }}
        title="Your Macro CRM, one click from any email."
        description="Open a company or contact record from any email to see every email between your team and that company, without opening a heavyweight CRM. Catch up on the relationship without leaving your inbox."
      >
        <DemoInteractionBoundary
          class="feature-page-visual"
          render={() => <CrmRecordDemo />}
        />
      </FeaturePageSection>
      <FeaturePageSection
        id="auto-tags"
        title="Let Macro Routines watch your email."
        description="Set up a routine that runs when an email arrives. Have an agent tag incoming emails by customer, project, or topic, or notify a channel when an urgent support email comes in. The same tags work across emails, docs, and tasks."
      >
        <PaperFeatureGraphic
          height={360}
          mobileHeight={390}
          label="An inbox with one highlighted email automatically tagged Customers and Follow up by a routine. Callouts point to each tag."
        >
          <EmailAutoTagDemo />
        </PaperFeatureGraphic>
      </FeaturePageSection>
      <EmailComparison />
      <FeaturePageFaq
        guide={{ href: '/email#guide', label: 'email' }}
        id="email-faq-title"
        title="Questions about Macro Mail"
        items={faqItems}
      />
      <HomepageClosing />
    </FeaturePage>
  );
}
