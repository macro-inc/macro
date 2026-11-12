import { setPageSeo } from '../../../app/utils/utilSeo';
import {
  CallFollowupDemo,
  CallStartDemo,
} from '../components/calls/CallStories';
import { CallsComparison } from '../components/calls/CallsComparison';
import { CallTeamMemoryDemo } from '../components/calls/CallTeamMemoryDemo';
import { DemoInteractionBoundary } from '../components/DemoInteractionBoundary';
import { FeaturePageFaq, FeaturePageSection } from '../components/FeaturePage';
import { HomepageClosing } from '../components/HomepageClosing';
import { ProductHero, ProductPage } from '../components/product/ProductPage';
import './calls-page.css';

const callsFaq = [
  {
    q: 'How do I start a call?',
    a: (
      <>
        Start from Calls, a channel, or a direct message. You can also create a
        meeting link for an instant or scheduled call. See the{' '}
        <a href="/calls#guide">calls guide</a>.
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
  setPageSeo({
    title: 'Macro Calls — Team-level memory',
    description:
      'Calls right in your channels. Recordings, speaker-identified transcripts, and summaries give your agents team-level memory.',
    path: '/calls',
  });
  return (
    <ProductPage>
      <div class="calls-page">
        <ProductHero
          cta="calls_hero_get_started"
          tutorial="calls"
          product="Calls"
          title="Calls feed into team memory."
          description="Call from any channel or DM. Give your team and agents context with recordings and transcripts."
        />
        <FeaturePageSection
          id="call-start"
          demo={{
            tone: 'calls',
          }}
          title="Start a call from Macro Chat."
          description="Call from a channel or DM, or share a standalone meeting link with someone outside your team. They can join in a browser without installing anything."
        >
          <DemoInteractionBoundary
            class="feature-page-visual"
            render={() => <CallStartDemo />}
          />
        </FeaturePageSection>
        <FeaturePageSection
          id="call-followup"
          demo={{
            tone: 'calls',
          }}
          title="Ask agents to work from transcripts."
          description="Agents can read the full transcript and a summary of why the call matters and how it fits into the broader picture of your company. Ask one to create tasks or draft a follow-up from what was discussed."
        >
          <DemoInteractionBoundary
            class="feature-page-visual"
            render={() => <CallFollowupDemo />}
          />
        </FeaturePageSection>
        <FeaturePageSection
          id="call-default"
          demo={{
            tone: 'calls',
          }}
          title="Share call recordings with your team."
          description="Channel calls are recorded and shared with your team by default, so you don’t have to remember to share them afterward. You can turn off team sharing; standalone meetings stay with their participants unless shared."
        >
          <DemoInteractionBoundary
            class="feature-page-visual"
            render={() => <CallTeamMemoryDemo />}
          />
        </FeaturePageSection>
        <CallsComparison />
        <FeaturePageFaq
          guide={{ href: '/calls#guide', label: 'calls' }}
          id="calls-faq-title"
          title="Questions about Macro Calls"
          items={callsFaq}
        />
        <HomepageClosing />
      </div>
    </ProductPage>
  );
}
