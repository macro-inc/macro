import { setPageSeo } from '../../../app/utils/utilSeo';
import {
  CallFollowupDemo,
  CallHeroDemo,
  CallStartDemo,
} from '../components/calls/CallStories';
import { CallsComparison } from '../components/calls/CallsComparison';
import { CallTeamMemoryDemo } from '../components/calls/CallTeamMemoryDemo';
import { DemoInteractionBoundary } from '../components/DemoInteractionBoundary';
import { FeaturePageFaq, FeaturePageSection } from '../components/FeaturePage';
import { HomepageClosing } from '../components/HomepageClosing';
import {
  CallGraphic,
  ContextGraphic,
  LinkedWorkGraphic,
} from '../components/product/ProductGraphics';
import { ProductHero, ProductPage } from '../components/product/ProductPage';
import './calls-page.css';

const callsFaq = [
  {
    q: 'How do I start a call?',
    a: (
      <>
        Start from Calls, a channel, or a direct message. You can also create a
        meeting link for an instant or scheduled call. See the{' '}
        <a href="https://docs.macro.com/product/calls">calls guide</a>.
      </>
    ),
  },
  {
    q: 'Can someone join without a Macro account?',
    a: 'Yes. Guests can join standalone meeting links in their browser without an account. Channel-linked calls require sign-in.',
  },
  {
    q: 'Are calls recorded and transcribed?',
    a: 'Yes. Participants see a recording and transcription notice. After the call, open its recording, transcript, and summary in Calls.',
  },
  {
    q: 'Can an agent turn a call into next steps?',
    a: (
      <>
        Yes. Ask an agent to use an accessible transcript to draft a follow-up,
        create tasks, or update customer records. See{' '}
        <a href="/agents">Macro Agents</a>.
      </>
    ),
  },
  {
    q: 'Who can read the recording and transcript?',
    a: 'Channel calls share with the creator’s team by default; turn off Share with team to prevent that. Standalone meetings are not shared to the wider team automatically. Signed-in participants retain access to their recordings.',
  },
  {
    q: 'Can I use transcripts from another meeting app?',
    a: 'You can bring a transcript into Macro as a document and use it as agent context. This is separate from recording a call in Macro.',
  },
  {
    q: 'Which plan includes calls?',
    a: (
      <>
        Calls, recording, and transcription are included in paid plans. See{' '}
        <a href="/pricing">current pricing</a> for details.
      </>
    ),
  },
];

export function RouteCalls() {
  // Repeated clicks on the same hash still need to revisit the section.
  const revisitSection = (
    event: MouseEvent & { currentTarget: HTMLAnchorElement }
  ) => {
    if (
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      event.button !== 0
    )
      return;
    const hash = event.currentTarget.hash;
    if (hash !== window.location.hash) return;
    event.preventDefault();
    document.getElementById(hash.slice(1))?.scrollIntoView({
      block: 'start',
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'auto'
        : 'smooth',
    });
  };
  setPageSeo({
    title: 'Macro Calls — Turn Conversations into Tasks and Updates',
    description:
      'Macro records and transcribes your calls so your agents can update tasks and docs from the conversation.',
    path: '/calls',
  });
  return (
    <ProductPage>
      <div class="calls-page">
        <ProductHero
          cta="calls_hero_get_started"
          product="Calls"
          title={['Call from anywhere in Macro', 'with every call recorded.']}
          description={[
            'Macro records and transcribes your calls',
            'so your agent can handle what comes next.',
          ]}
        />
        <DemoInteractionBoundary render={() => <CallHeroDemo />} />
        <nav class="feature-page-jump-links" aria-label="On this page">
          <a href="#call-start" onClick={revisitSection}>
            <CallGraphic />
            <span>Meet in a click</span>
          </a>
          <a href="#call-followup" onClick={revisitSection}>
            <LinkedWorkGraphic />
            <span>Act on decisions</span>
          </a>
          <a href="#call-default" onClick={revisitSection}>
            <ContextGraphic />
            <span>Catch up afterward</span>
          </a>
        </nav>
        <FeaturePageSection
          id="call-start"
          title={[
            'Start a call in channels, DMs,',
            'or through meeting links.',
          ]}
          description="You can start calls from channels, DMs, or through meeting links. People outside of Macro can join your meeting links. Create your own booking links so people can set up times with you."
        >
          <DemoInteractionBoundary
            class="feature-page-visual"
            render={() => <CallStartDemo />}
          />
        </FeaturePageSection>
        <FeaturePageSection
          id="call-followup"
          title={['Turn what was said on', 'your calls into next steps.']}
          description="Tell your agent to turn what was said on a call into tasks, follow-up emails, and CRM updates. Your agent can read the transcript and determine who said what."
        >
          <DemoInteractionBoundary
            class="feature-page-visual"
            render={() => <CallFollowupDemo />}
          />
        </FeaturePageSection>
        <FeaturePageSection
          id="call-default"
          title={['View call recordings', 'after they finish.']}
          description="After calls finish, you can go back and watch the recording, review the transcript, or get a summary of what was said. Call recordings are shareable across your team."
        >
          <DemoInteractionBoundary
            class="feature-page-visual"
            render={() => <CallTeamMemoryDemo />}
          />
        </FeaturePageSection>
        <CallsComparison />
        <FeaturePageFaq
          id="calls-faq-title"
          title="Questions about Macro Calls"
          items={callsFaq}
        />
        <HomepageClosing />
      </div>
    </ProductPage>
  );
}
