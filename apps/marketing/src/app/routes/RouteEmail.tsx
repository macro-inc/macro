import { DemoInteractionBoundary } from '../../features/marketing/components/DemoInteractionBoundary';
import { EmailAccountsDemo } from '../../features/marketing/components/email/EmailAccountsDemo';
import { EmailAgenticEditingDemo } from '../../features/marketing/components/email/EmailAgenticEditingDemo';
import { EmailComparison } from '../../features/marketing/components/email/EmailComparison';
import { EmailDesktopDemo } from '../../features/marketing/components/email/EmailDesktopDemo';
import {
  AgenticEditingGraphic,
  AutoTagsGraphic,
  EmailSharingGraphic,
  KeyboardSpeedGraphic,
} from '../../features/marketing/components/email/EmailFeatureGraphics';
import { EmailKeyboardDemo } from '../../features/marketing/components/email/EmailKeyboardDemo';
import { EmailSharingDemo } from '../../features/marketing/components/email/EmailSharingDemo';
import {
  FeaturePage,
  FeaturePageCta,
  FeaturePageFaq,
  FeaturePageSection,
} from '../../features/marketing/components/FeaturePage';
import { HomepageClosing } from '../../features/marketing/components/HomepageClosing';
import { ProductBrand } from '../../features/marketing/components/product/ProductPage';
import { setPageSeo } from '../utils/utilSeo';
import '../../features/marketing/components/email/email-hero.css';

const faqItems = [
  {
    q: 'Which email accounts can I connect?',
    a: (
      <>
        Macro supports Gmail and Google Workspace. Connect an account in
        Settings and keep using Gmail alongside Macro. See the{' '}
        <a href="https://docs.macro.com/product/email">email setup guide</a>.
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
        Yes. Ask an agent to draft a reply using the email thread and relevant
        workspace context. Review and edit the draft before sending. Learn more
        about <a href="/agents">Macro Agents</a>.
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
        <a href="/pricing">plans and limits</a> before choosing a plan for your
        team.
      </>
    ),
  },
];

export function RouteEmail() {
  setPageSeo({
    title: 'Macro Mail — The AI Email Client',
    description:
      'Bring your email accounts into one inbox. Draft and edit with agents, separate signal from noise, and share email threads with your team in Macro.',
    path: '/email',
  });

  return (
    <FeaturePage productSpacing>
      <header class="feature-page-hero email-page-hero">
        <ProductBrand product="Mail" />
        <h1>
          <span>Extremely fast email for</span>
          <span>humans and agents.</span>
        </h1>
        <p class="email-page-hero-description">
          Keep your inbox clean, move through emails quickly, and have agents
          draft good replies.
        </p>
        <FeaturePageCta name="email_hero_get_started" />
      </header>
      <EmailDesktopDemo />
      <nav
        class="feature-page-jump-links email-feature-links"
        aria-label="On this page"
      >
        <a href="#auto-tags">
          <AutoTagsGraphic />
          <span>Tags</span>
        </a>
        <a href="#email-sharing">
          <EmailSharingGraphic />
          <span>Share to a channel</span>
        </a>
        <a href="#keyboard-speed">
          <KeyboardSpeedGraphic />
          <span>Superhuman speed</span>
        </a>
        <a href="#agentic-editing">
          <AgenticEditingGraphic />
          <span>Agentic editing</span>
        </a>
      </nav>
      <FeaturePageSection
        id="auto-tags"
        title={['Keep all your inboxes', 'organized.']}
        description="Connect your personal and work inboxes across Gmail, Outlook, and more. Organize them with tags for customers, projects, and follow-ups."
      >
        <DemoInteractionBoundary
          class="feature-page-visual"
          render={() => <EmailAccountsDemo />}
        />
      </FeaturePageSection>
      <FeaturePageSection
        id="email-sharing"
        title={['Share email threads', 'with your team.']}
        description="Share email threads in a channel so your team can read the full conversation, discuss it, and keep new replies linked."
      >
        <DemoInteractionBoundary
          class="feature-page-visual"
          render={() => <EmailSharingDemo />}
        />
      </FeaturePageSection>
      <FeaturePageSection
        id="keyboard-speed"
        title={['Manage your inbox', 'with keyboard shortcuts.']}
        description="Open, reply to, and archive emails with keyboard shortcuts so you can move through your inbox faster."
      >
        <DemoInteractionBoundary
          class="feature-page-visual"
          render={() => <EmailKeyboardDemo />}
        />
      </FeaturePageSection>
      <FeaturePageSection
        id="agentic-editing"
        title={['Draft emails in your', 'voice with agents.']}
        description="Ask an agent to prepare a reply using the email thread, relevant documents, meeting transcripts, and team conversations. Review and edit the draft before sending."
      >
        <DemoInteractionBoundary
          class="feature-page-visual"
          render={() => <EmailAgenticEditingDemo />}
        />
      </FeaturePageSection>
      <EmailComparison />
      <FeaturePageFaq
        id="email-faq-title"
        title="Questions about Macro Mail"
        items={faqItems}
      />
      <HomepageClosing />
    </FeaturePage>
  );
}
