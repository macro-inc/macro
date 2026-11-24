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
          title="Calls that feed into team memory."
          description="Call from any channel or DM. Give your team and agents context with recordings and transcripts."
        />
        <FeaturePageSection
          id="call-default"
          title="Team calls and private meetings."
          description="Calls in team and public channels share their recording, transcript, and summary with your team by default. Calls in DMs and private channels start private. Standalone meeting links are private to participants. Use the call controls to change sharing during a call. Afterward, the person who started it can change access from Sharing in the call’s side panel."
          screen={featureScreens['call-default']}
        />
        <FeaturePageSection
          id="call-followup"
          title="Macro Agents get the transcript and summary."
          description="Every speaker is identified, so the transcript knows who said what. Agents can read the full transcript, plus a summary of why the call matters and how it fits into the bigger picture of your company. Ask one to create tasks or draft a follow-up from what was discussed."
          screen={featureScreens['call-followup']}
        />
        <FeaturePageSection
          id="call-start"
          title="As easy as a Slack huddle."
          description="Start a call right in a channel or a DM in Macro Chat, or share a link with anyone, like Google Meet. They can join in a browser without installing anything."
          screen={featureScreens['call-start']}
        />
        <FeaturePageSection
          id="call-external"
          title="External calls, shared by link."
          description="Create a meeting link and send it to anyone outside your team. They can join in their browser without a Macro account or installing anything."
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
