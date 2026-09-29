import { lazy } from 'solid-js';
import {
  DeferredDemo,
  DemoPlaceholder,
} from '../../features/marketing/components/DeferredDemo';
import { EmailComparison } from '../../features/marketing/components/email/EmailComparison';
import {
  AgenticEditingGraphic,
  EmailSharingGraphic,
  OneInboxGraphic,
  SignalNoiseGraphic,
} from '../../features/marketing/components/email/EmailFeatureGraphics';
import {
  EmailInboxDemo,
  EmailSignalNoiseDemo,
} from '../../features/marketing/components/email/EmailInboxDemo';
import { EmailSharingDemo } from '../../features/marketing/components/email/EmailSharingDemo';
import {
  FeaturePage,
  FeaturePageCta,
  FeaturePageFaq,
  FeaturePageSection,
} from '../../features/marketing/components/FeaturePage';
import { HomepageConversation } from '../../features/marketing/components/HomepageConversation';
import { HomepageMention } from '../../features/marketing/components/HomepageMention';
import { setPageSeo } from '../utils/utilSeo';

const loadEmailCompose = () =>
  import('../../features/marketing/components/HomepageEmailCompose');
const HomepageEmailCompose = lazy(loadEmailCompose);

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
    q: 'Is there a free plan?',
    a: (
      <>
        Yes. The free plan includes email alongside chat, documents, tasks, and
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
      <header class="feature-page-hero">
        <h1>
          Email for humans
          <br />
          and agents.
        </h1>
        <p>
          Your accounts in one inbox. Agents to help you write. Your team, with
          the full conversation.
        </p>
        <FeaturePageCta name="email_hero_get_started" />
      </header>
      <nav class="feature-page-jump-links" aria-label="On this page">
        <a href="#inbox">
          <OneInboxGraphic />
          <span>One inbox</span>
        </a>
        <a href="#agentic-editing">
          <AgenticEditingGraphic />
          <span>Agentic editing</span>
        </a>
        <a href="#signal-noise">
          <SignalNoiseGraphic />
          <span>Signal &amp; noise</span>
        </a>
        <a href="#email-sharing">
          <EmailSharingGraphic />
          <span>Share with your team</span>
        </a>
      </nav>
      <FeaturePageSection
        id="inbox"
        title="Every account. One inbox."
        description="Your work and personal email, together. Find a conversation without switching accounts."
      >
        <div class="feature-page-visual">
          <EmailInboxDemo />
        </div>
        <p class="feature-page-caption">
          Search the inbox, switch accounts, or open a thread.
        </p>
      </FeaturePageSection>
      <FeaturePageSection
        id="agentic-editing"
        title="Agentic editing"
        description="Draft and edit with the context of your work. Review every word before it goes out."
      >
        <div class="feature-page-visual" id="email">
          <HomepageConversation
            messages={[
              {
                person: 'jacob',
                text: (
                  <>
                    <span class="homepage-person-mention">@Claude</span>, draft
                    a follow-up email based on{' '}
                    <HomepageMention
                      kind="calendar"
                      label="Demo Call Sep 14th"
                      description="Jacob, Dana, and Julia · Product demo and next steps for Dana’s team."
                      href="#agentic-editing"
                    />{' '}
                    and{' '}
                    <HomepageMention
                      kind="call"
                      label="Demo call transcript"
                      description="Transcript of the September 14 demo with Dana · Team rollout, sales materials, and follow-up next steps."
                      href="#agentic-editing"
                    />
                    . Include the sales PDF and rollout doc, and cc Julia.
                  </>
                ),
              },
            ]}
          />
          <div class="homepage-feature-email">
            <DeferredDemo
              preload={loadEmailCompose}
              fallback={<DemoPlaceholder label="Agent email draft preview" />}
            >
              <HomepageEmailCompose appChrome />
            </DeferredDemo>
          </div>
        </div>
        <p class="feature-page-caption">
          The agent brings in the context. You edit the draft and decide when to
          send.
        </p>
      </FeaturePageSection>
      <FeaturePageSection
        id="signal-noise"
        title="Signal above the noise"
        description="Keep important conversations in focus. Give newsletters and automated updates their own space."
      >
        <div class="feature-page-visual">
          <EmailSignalNoiseDemo />
        </div>
        <p class="feature-page-caption">
          You control the split. Move a thread to Noise when it can wait.
        </p>
      </FeaturePageSection>
      <FeaturePageSection
        id="email-sharing"
        title="Bring your team into the thread"
        description="Share an email in a channel. Keep the original conversation beside the discussion."
      >
        <div class="feature-page-visual">
          <EmailSharingDemo />
        </div>
        <p class="feature-page-caption">
          Share the example thread, then open it from the channel.
        </p>
      </FeaturePageSection>
      <FeaturePageFaq
        id="email-faq-title"
        eyebrow="Your account, explained"
        title="Your email. Your permission."
        introduction={
          <>
            <p>
              Macro connects to your existing Google account. You can read,
              organize, and reply to email alongside your team’s work.
            </p>
            <p>
              You approve the connection on Google. Macro does not receive your
              Google password. Email agents show you the draft and ask for
              approval before sending.
            </p>
          </>
        }
        items={faqItems}
      />
      <EmailComparison />
      <section
        class="feature-page-end"
        aria-label="Get started with Macro Mail"
      >
        <h2>
          Your inbox,
          <br />
          connected to your work.
        </h2>
        <FeaturePageCta name="email_footer_get_started" />
      </section>
      <footer class="feature-page-footer">
        <a href="/">Macro</a>
        <a href="/pricing">Pricing</a>
        <a href="/migrate">Switching to Macro</a>
        <a href="/privacy">Privacy</a>
        <a href="https://security.macro.com">Security</a>
        <a href="/terms">Terms</a>
      </footer>
    </FeaturePage>
  );
}
