import { setPageSeo } from '../../../app/utils/utilSeo';
import { CallsComparison } from '../components/calls/CallsComparison';
import { FeaturePageFaq, FeaturePageSection } from '../components/FeaturePage';
import { HomepageClosing } from '../components/HomepageClosing';
import { ProductHero, ProductPage } from '../components/product/ProductPage';
import './calls-page.css';
import { FeaturePhoneScreens } from '../components/FeatureScreenshot';
import { featureScreens, phoneScreens } from '../core/feature-screens';

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
    a: 'Yes. Participants see a recording and transcription notice. Open the recording, transcript, and summary in Calls right after the call.',
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
          title="Calls that feed into team memory."
          description="Calls lets you start instant video meetings in any channel or invite external guests with recordings and transcripts."
        />
        <FeaturePageSection
          id="call-default"
          title="Team calls and private meetings."
          description="Team-channel calls automatically share recordings, transcripts, and summaries with your team; DM and private-channel calls stay private. Adjust sharing mid-call or anytime afterward from the side panel."
          screen={featureScreens['call-default']}
        />
        <FeaturePageSection
          id="call-followup"
          title="Macro Agents get the transcript and summary."
          description="Every transcript is speaker-identified and paired with a company-level summary. Ask Macro Agents to turn what was decided into Macro Tasks, update Macro CRM, or draft follow-up Macro Mail."
          screen={featureScreens['call-followup']}
        />
        <FeaturePageSection
          id="call-start"
          title="As easy as a Slack huddle."
          description="Jump into a huddle from any Macro Chat channel or DM with one click—no calendar invite or meeting link required."
          screen={featureScreens['call-start']}
        />
        <FeaturePageSection
          id="call-external"
          title="External calls shared by link."
          description="Need to meet with a customer or candidate? Send a standalone browser link like Google Meet—no Macro account or download required."
          screen={featureScreens['call-external']}
        />
        <FeaturePhoneScreens screens={phoneScreens['calls']} product="Calls" />
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
