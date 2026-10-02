import { setPageSeo } from '../../../app/utils/utilSeo';
import {
  CallArchiveDemo,
  CallFollowupDemo,
  CallSharingDemo,
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

export function RouteCalls() {
  setPageSeo({
    title: 'Macro Calls — Recordings, Transcripts, and Agent Tools',
    description:
      'Browser-based video calls with recordings, speaker transcripts, and summaries. Search the conversation and ask agents to update tasks from the call.',
    path: '/calls',
  });
  return (
    <ProductPage>
      <ProductHero
        product="Calls"
        title={['Record the conversation.', 'Search every word.']}
        description={[
          'Video calls, transcripts, and summaries.',
          'Available to your team and your agents.',
        ]}
        cta="calls_hero_get_started"
      />
      <WorkspaceDesktopDemo
        view="messages"
        label="Explore Macro Calls"
        caption="Open the launch check-in to read its summary and transcript. This sample has no live audio or video."
      >
        <CallArchiveDemo />
      </WorkspaceDesktopDemo>
      <nav class="feature-page-jump-links" aria-label="On this page">
        <a href="#call-context">
          <CallGraphic />
          <span>Call records</span>
        </a>
        <a href="#call-transcript">
          <ThreadGraphic />
          <span>Transcripts</span>
        </a>
        <a href="#call-followup">
          <LinkedWorkGraphic />
          <span>Agent tools</span>
        </a>
        <a href="#call-sharing">
          <ContextGraphic />
          <span>Sharing</span>
        </a>
      </nav>
      <FeaturePageSection
        id="call-context"
        title="Call directly from a channel or DM."
        description={
          'Start a browser-based call where your team is already talking.\nRecorded calls appear in the conversation’s Calls tab.'
        }
      >
        <div class="feature-page-visual">
          <CallArchiveDemo animate />
        </div>
        <ProductProse>
          <p>
            Channel and DM call controls let you start a conversation in the
            browser. Share a call link with someone outside your workspace so
            they can join too. A processed recording has its own workspace
            record with participants, a summary, and a transcript. Open previous
            calls from the channel’s Calls tab.
          </p>
        </ProductProse>
      </FeaturePageSection>
      <FeaturePageSection
        id="call-transcript"
        title="A transcript tied to the recording."
        description={
          'Read who said what, with timestamps for each segment.\nSelect a line to jump to that moment in the recording.'
        }
      >
        <div class="feature-page-visual">
          <CallTranscriptDemo />
        </div>
        <ProductProse>
          <p>
            The transcript identifies speakers and timestamps their words. It
            gives you a readable record and a direct route back to the audio.
            Search call content through Macro, or ask an agent to read the
            transcript. Summaries give you a quick overview; the original words
            are there when you need the detail.
          </p>
        </ProductProse>
      </FeaturePageSection>
      <FeaturePageSection
        id="call-followup"
        title="Agents can use what was said."
        description={
          'Ask an agent to read the call and update a task or document.\nMeeting decisions become edits your team can review.'
        }
      >
        <div class="feature-page-visual">
          <CallFollowupDemo />
        </div>
        <ProductProse>
          <p>
            Call-reading tools return the summary and transcript to the agent.
            Task and document tools let it turn those details into a checklist,
            a brief, or an updated task. Ask for a specific follow-up: record an
            owner, add a dependency, or draft an email using the agreement from
            the call. The agent works from the saved record.
          </p>
        </ProductProse>
      </FeaturePageSection>
      <FeaturePageSection
        id="call-sharing"
        title="Share the recording and transcript."
        description={
          'Give a teammate access to the call record.\nThey can read the summary and replay the conversation.'
        }
      >
        <div class="feature-page-visual">
          <CallSharingDemo />
        </div>
        <ProductProse>
          <p>
            Call records use Macro’s sharing system. Choose a recipient and
            access level, or reference the record in a channel you can share
            with. The recording, summary, and transcript are parts of that
            record. Teammates and agents with access can revisit the discussion.
          </p>
        </ProductProse>
      </FeaturePageSection>
      <FeaturePageFaq
        id="calls-faq-title"
        eyebrow="Recording and transcription"
        title="How Macro Calls work."
        introduction={
          <p>
            Browser-based calls with transcripts, summaries, sharing, and agent
            reading tools.
          </p>
        }
        items={[
          {
            q: 'Can I start a call from a channel?',
            a: 'Yes. Channels and direct conversations include call controls. The marketing previews do not start real calls or request microphone or camera access.',
          },
          {
            q: 'What appears in a call record?',
            a: 'The record can contain participants, a summary, a recording, and a transcript. Availability depends on the call and processing state.',
          },
          {
            q: 'Can I return to a moment in the recording?',
            a: 'When a recording and transcript are available, selecting a transcript segment seeks to its timestamp.',
          },
          {
            q: 'Can agents read the transcript?',
            a: 'Agents have a tool for reading accessible call records, including their summary and transcript. Ask them to find an agreement, update a task, or draft a follow-up from the transcript.',
          },
          {
            q: 'How do I share a call record?',
            a: 'Use the call record’s Share control to grant access. Recipients still need the appropriate permissions to open the record.',
          },
          {
            q: 'Does this demo record me?',
            a: 'No. It uses fictional local call data and contains no live audio or video connection.',
          },
        ]}
      />
      <HomepageClosing />
    </ProductPage>
  );
}
