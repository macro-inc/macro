import { setPageSeo } from '../../../app/utils/utilSeo';
import {
  CallDefaultDemo,
  CallFollowupDemo,
  CallHeroDemo,
  CallStartDemo,
  CallTranscriptDemo,
} from '../components/calls/CallStories';
import { FeaturePageFaq, FeaturePageSection } from '../components/FeaturePage';
import { HomepageClosing } from '../components/HomepageClosing';
import {
  CallGraphic,
  ContextGraphic,
  LinkedWorkGraphic,
  ThreadGraphic,
} from '../components/product/ProductGraphics';
import {
  ProductHero,
  ProductPage,
  ProductProse,
} from '../components/product/ProductPage';
import { WorkspaceDesktopDemo } from '../components/WorkspaceDesktopDemo';

const callsFaq = [
  {
    q: 'Are all calls recorded?',
    a: 'Yes. Calls in Macro are recorded and transcribed for the organizer and Macro participants, and the recording, transcript, and summary are saved with the call.',
  },
  {
    q: 'Who can see a recording?',
    a: 'Members of the channel it started in. Use Share to give anyone else access.',
  },
  {
    q: 'Do I need to install anything?',
    a: 'No. Calls run in the browser on desktop and mobile.',
  },
  {
    q: 'Can agents read my calls?',
    a: (
      <>
        Yes, the ones you have access to. Agents read the summary first and the
        full transcript when they need detail. More on{' '}
        <a href="/agents">agents in Macro</a>.
      </>
    ),
  },
  {
    q: 'Can I share a call with my team?',
    a: 'Yes. Turn on Share with team and your team can see the chat, transcript, and AI summary once the call ends.',
  },
  {
    q: 'Is there a free plan?',
    a: (
      <>
        Yes, for email, chat, docs, and agents. Calls, recording, and
        transcription are on the paid plan. See <a href="/pricing">pricing</a>{' '}
        for what each plan includes.
      </>
    ),
  },
];

export function RouteCalls() {
  setPageSeo({
    title: 'Macro Calls — Recordings, Transcripts, and Agent Tools',
    description:
      'Start a call from any channel. Macro records, transcribes, and summarizes it by default, so your team and your agents know what was decided.',
    path: '/calls',
  });
  return (
    <ProductPage>
      <ProductHero
        product="Calls"
        title={['Every call, recorded', 'and searchable.']}
        description={[
          'Start a call from any channel. It’s transcribed and summarized automatically,',
          'so your team and your agents know what was decided.',
        ]}
        cta="calls_hero_get_started"
      />
      <WorkspaceDesktopDemo
        view="messages"
        label="Explore Macro Calls"
        caption="A sample call. Click a transcript line to jump to that moment."
      >
        <CallHeroDemo />
      </WorkspaceDesktopDemo>
      <nav class="feature-page-jump-links" aria-label="On this page">
        <a href="#call-default">
          <ContextGraphic />
          <span>On by default</span>
        </a>
        <a href="#call-transcript">
          <ThreadGraphic />
          <span>Who said what</span>
        </a>
        <a href="#call-followup">
          <LinkedWorkGraphic />
          <span>Summaries for agents</span>
        </a>
        <a href="#call-start">
          <CallGraphic />
          <span>Calls in channels</span>
        </a>
      </nav>
      <FeaturePageSection
        id="call-default"
        title="Recorded by default."
        description={
          'No bot to invite and no record button to forget.\nEvery call gets a recording, a transcript, and a summary.'
        }
      >
        <div class="feature-page-visual">
          <CallDefaultDemo />
        </div>
        <ProductProse>
          <p>
            Granola, meeting bots, and the record button in Zoom all have the
            same problem: someone has to remember to use them, and then remember
            to share the notes. Usually nobody does, and the decision lives in
            three people’s heads. Macro flips it. Calls are recorded and
            transcribed by default and saved to the channel they started in. It
            feels a little strange at first. Then you stop losing decisions.
          </p>
        </ProductProse>
      </FeaturePageSection>
      <FeaturePageSection
        id="call-transcript"
        title="Knows who said what."
        description={
          'Each person’s audio is transcribed on its own, so every line has the right name on it.\nClick a line to jump to that moment in the recording.'
        }
      >
        <div class="feature-page-visual">
          <CallTranscriptDemo />
        </div>
        <ProductProse>
          <p>
            When we first rolled out calls to our own team, the transcripts kept
            attributing things to the wrong person, and that’s worse than no
            transcript at all: your agents end up thinking Eric agreed to
            something Seamus said. So Macro transcribes each participant’s audio
            separately and keeps different voices apart. The transcript is lined
            up with the recording, so you can click any line and hear it.
          </p>
        </ProductProse>
      </FeaturePageSection>
      <FeaturePageSection
        id="call-followup"
        title="Summaries your agents can use."
        description={
          'Every call gets a short summary of what was decided.\nAgents read it first, so they can act on the meeting without rereading an hour of transcript.'
        }
      >
        <div class="feature-page-visual">
          <CallFollowupDemo />
        </div>
        <ProductProse>
          <p>
            A transcript is a lot of words. The summary is what you and your
            agents actually want: what got decided, who owns what, and how it
            fits with everything else going on. Ask @Macro to update the task
            from this morning’s call and it reads the summary, pulls details
            from the transcript when it needs them, and makes the change.
          </p>
        </ProductProse>
      </FeaturePageSection>
      <FeaturePageSection
        id="call-start"
        title="Start one from any channel."
        description={
          'Click Call in a channel or DM, like a Slack huddle.\nIt runs in the browser, so there’s nothing to install.'
        }
      >
        <div class="feature-page-visual">
          <CallStartDemo />
        </div>
        <ProductProse>
          <p>
            We wanted the ease of a Slack huddle with the reliability of Google
            Meet. Click Call in any channel and everyone in it gets a
            notification. It works in the browser on any device, so nobody has
            to install anything five minutes before the meeting. Afterward, the
            recording, transcript, and summary live in the channel’s Calls tab.
          </p>
        </ProductProse>
      </FeaturePageSection>
      <FeaturePageFaq
        id="calls-faq-title"
        title="Questions about Macro Calls"
        introduction={
          <p>
            Calls are the one place we made a strong default choice. Here’s how
            it works.
          </p>
        }
        items={callsFaq}
      />
      <HomepageClosing />
    </ProductPage>
  );
}
