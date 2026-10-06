import MacroLogo from '@icon/macro-logo.svg';
import { EmailAgenticEditingDemo } from '../../features/marketing/components/email/EmailAgenticEditingDemo';
import { EmailAutoTagsDemo } from '../../features/marketing/components/email/EmailAutoTagsDemo';
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
import { setPageSeo } from '../utils/utilSeo';
import '../../features/marketing/components/email/email-hero.css';

const faqItems = [
  {
    q: 'Does Macro work with my existing email account?',
    a: 'Macro supports Gmail and Google Workspace. Connect your existing account to read and send email in Macro. You can continue using Gmail alongside it.',
  },
  {
    q: 'Can I connect more than one account?',
    a: 'Yes. View connected accounts in one inbox, or filter to a single account. Each message keeps its original sender and account.',
  },
  {
    q: 'What can an agent do with my email?',
    a: 'An agent can help draft and edit replies using email and the workspace context available to it. Review the draft, make changes, and approve it before sending.',
  },
  {
    q: 'How do Signal and Noise work?',
    a: 'Signal keeps important conversations together. Noise groups lower-priority mail, such as newsletters and automated updates. You can move a thread between the two views.',
  },
  {
    q: 'Can I share an email with a channel?',
    a: 'Yes. Share a thread with your team and link it in a channel. Teammates with access can open the conversation, including later replies, without forwarding a separate copy.',
  },
  {
    q: 'Is my email used to train AI?',
    a: 'Data received through Google Workspace APIs is not used to develop or train generalized AI models. Macro maintains zero data retention agreements with OpenAI and Anthropic for model processing.',
  },
  {
    q: 'Can I disconnect my account?',
    a: (
      <>
        Disconnect in Macro’s Settings or revoke access from your Google
        account. Revoking access and deleting data already stored in Macro are
        separate actions. Our <a href="/privacy">Privacy Policy</a> explains
        data deletion.
      </>
    ),
  },
  {
    q: 'Is Macro open source?',
    a: (
      <>
        Yes. You can inspect the application code on{' '}
        <a
          href="https://github.com/macro-inc/macro"
          target="_blank"
          rel="noreferrer"
        >
          GitHub
        </a>
        . Open source does not make your email or workspace public.
      </>
    ),
  },
  {
    q: 'Can I join as a Guest for free?',
    a: (
      <>
        Yes. Guest access includes email alongside chat, documents, tasks, and
        AI, with usage limits. See <a href="/pricing">pricing</a> for current
        account, storage, and AI limits.
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
    <FeaturePage>
      <header class="feature-page-hero email-page-hero">
        <p class="email-page-hero-label">
          <MacroLogo aria-hidden="true" />
          <span>Macro Mail</span>
        </p>
        <h1>
          <span>Extremely fast email for</span>
          <span>humans and agents.</span>
        </h1>
        <p class="email-page-hero-description">
          All your accounts in one inbox. Search across them.
          <br class="email-page-hero-break" /> Share threads. Let agents draft
          your replies.
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
          <span>Automatic tags</span>
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
        title="Your email, automatically tagged."
        description={
          'Macro tags incoming email by customer, project, or follow-up.\nUse tags to find the related conversations across your accounts.'
        }
      >
        <div class="feature-page-visual">
          <EmailAutoTagsDemo />
        </div>
        <div class="email-feature-prose">
          <p>
            Automatic tags label incoming messages so you can browse email by
            customer, project, or follow-up. Tags also work on documents, tasks,
            and other workspace items. You can add, remove, or change a tag
            yourself. A thread can have several tags, so it can appear under
            both the customer and the project.
          </p>
        </div>
      </FeaturePageSection>
      <FeaturePageSection
        id="email-sharing"
        title="Share an email directly to a channel."
        description={
          'Share the full email thread with your team.\nFuture replies appear in the shared thread automatically.'
        }
      >
        <div class="feature-page-visual">
          <EmailSharingDemo />
        </div>
        <div class="email-feature-prose">
          <p>
            Choose a channel, add a note, and share the email. Channel members
            can open the original thread, including its messages and
            attachments. New replies update that same thread. Your team can
            leave comments and @mention documents or tasks alongside the
            customer’s email.
          </p>
        </div>
      </FeaturePageSection>
      <FeaturePageSection
        id="keyboard-speed"
        title="Superhuman speed."
        description={
          'J and K to navigate. E to mark done.\nSearch all your connected accounts from one inbox.'
        }
      >
        <div class="feature-page-visual">
          <EmailKeyboardDemo />
        </div>
        <div class="email-feature-prose">
          <p>
            Macro syncs email into its own database and search index. Search and
            agent reading tools work on the indexed messages across your
            connected accounts. J and K move to the next and previous thread. E
            marks the conversation done. Enter opens it, and Esc returns to the
            list. These shortcuts work with a thread open too.
          </p>
        </div>
      </FeaturePageSection>
      <FeaturePageSection
        id="agentic-editing"
        title="Agents draft from your email and docs."
        description={
          'Ask for a follow-up using the email thread and meeting transcript.\nReview the draft, recipients, and attachments before sending.'
        }
      >
        <div class="feature-page-visual">
          <EmailAgenticEditingDemo />
        </div>
        <div class="email-feature-prose">
          <p>
            Agents can search past emails and read the documents and calls you
            reference. Ask Claude to write a reply, attach a proposal, and copy
            the people involved. The result is an editable email draft. Change
            the subject or wording, check the recipients, and approve the send
            when you’re ready.
          </p>
        </div>
      </FeaturePageSection>
      <FeaturePageFaq
        id="email-faq-title"
        title="Gmail accounts and agent permissions"
        introduction={
          <p>
            Macro connects to your existing Google account. You can read,
            organize, and reply to email alongside your team’s work. You approve
            the connection on Google. Macro does not receive your Google
            password. Email agents show you the draft and ask for approval
            before sending.
          </p>
        }
        items={faqItems}
      />
      <EmailComparison />
      <HomepageClosing />
    </FeaturePage>
  );
}
