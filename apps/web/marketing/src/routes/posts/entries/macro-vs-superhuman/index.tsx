import '../macro-vs-notion/MacroVsNotion.css';
import { featureNavGlyphs } from '../../../../app/components/graphics/FeatureNavGlyphs';
import avatarJacob from '../../../../assets/people/jacob.webp';
import accountsSidebar from '../../../../assets/posts/macro-vs-superhuman/accounts-sidebar.jpg';
import agentDraft from '../../../../assets/posts/macro-vs-superhuman/agent-draft.jpg';
import blockEmail from '../../../../assets/posts/macro-vs-superhuman/block-email.jpg';
import crmBoard from '../../../../assets/posts/macro-vs-superhuman/crm-board.jpg';
import emailShareDemo from '../../../../assets/posts/macro-vs-superhuman/email-share-demo.mp4';
import emailSplits from '../../../../assets/posts/macro-vs-superhuman/email-splits.jpg';
import propertiesPanel from '../../../../assets/posts/macro-vs-superhuman/properties-panel.jpg';
import signalNoise from '../../../../assets/posts/macro-vs-superhuman/signal-noise.jpg';
import superhumanShared from '../../../../assets/posts/macro-vs-superhuman/superhuman-shared.jpg';
import unifiedInbox from '../../../../assets/posts/macro-vs-superhuman/unified-inbox.jpg';
import {
  type ComparisonRow,
  ComparisonTable,
  SuperhumanLogo,
} from '../../PostComparison';
import type { PostMeta } from '../../registry';

const SUPERHUMAN_VIDEO_ID = 'tnsxkywzTvY';
const ARTICLE_LEDE =
  'Macro is heavily inspired by Superhuman. While building Macro we had the privilege of speaking with the co-founders of Superhuman. They invented CMD+K, popularized dark mode (especially in email), and the idea of luxury, highly polished software. They laid the foundations for high-taste companies that came after them like Linear.';
const ARTICLE_SECOND_PARAGRAPH = {
  after:
    '. Superhuman is a really fast email client, but only for one inbox at a time. Macro is that plus your team chat, your docs, and your GitHub PRs, all triaged from one list with the same keyboard shortcuts. On top of that we made a handful of specific improvements to the email experience itself.',
  before: 'The main difference between Macro and Superhuman is that ',
  emphasis: 'Macro is multi-modal',
} as const;
const ARTICLE_PREVIEW = `${ARTICLE_LEDE} ${ARTICLE_SECOND_PARAGRAPH.before}${ARTICLE_SECOND_PARAGRAPH.emphasis}${ARTICLE_SECOND_PARAGRAPH.after}`;

const comparisonRows: ComparisonRow[] = [
  {
    feature: "Who it's for",
    macro:
      'Startups and teams that want email, chat, docs, and tasks together in one AI-first workspace',
    them: 'Founders, salespeople, and anyone who just needs to fly through one inbox',
  },
  {
    feature: 'Pricing',
    macro: '$40 per seat, every module included',
    them: '$40 per seat per month (as part of the new Superhuman Suite)',
  },
  {
    feature: 'Free plan',
    macro:
      'Full workspace access for personal use, with limits on storage and AI',
    them: "Covers Grammarly, Docs, and Go — Mail isn't included until Business",
  },
  {
    feature: 'Inbox',
    macro:
      'Unified inbox across every account, plus chat, @mentions, and PRs, triaged with j / k / e',
    them: "One inbox at a time, but it's a really fast one",
  },
  {
    feature: 'Signal vs. noise',
    macro: 'AI splits and tagging',
    them: 'AI splits and tagging',
  },
  {
    feature: 'CRM',
    macro: 'Deep, native CRM built into the workspace',
    them: 'Read-only HubSpot, Salesforce, and Pipedrive widgets in the inbox',
  },
  {
    feature: 'Email sync',
    macro:
      "Full duplex, we back up your whole mailbox so we're not rate-limited by the Gmail API after the initial backfill",
    them: 'Pulls through the Gmail/Outlook API into a local cache',
  },
  {
    feature: 'AI drafting',
    macro:
      'Draft and send right from the agent, using its unified memory of you and prior interactions, without leaving the agent',
    them: 'Auto Drafts and Write with AI, matched to your voice and tone',
  },
  {
    feature: 'Multitasking',
    macro: 'Built-in window manager, as many splits as your screen allows',
    them: "One email open at a time, you can't even see your inbox alongside it",
  },
  {
    feature: 'Sharing to channels',
    macro:
      'Share button posts the live, updating thread into a channel — everyone and every agent in it sees new replies as they land',
    them: 'Shared Conversations, a parallel thread that lives only inside Superhuman',
  },
];

/** Small isometric block glyph (reused from the home feature nav) shown above
 * a section heading. `route` selects which block composition to draw. */
function SectionGlyph(props: { route: string }) {
  const Glyph = featureNavGlyphs[props.route];
  return (
    <div class="mvn-section-glyph" aria-hidden="true">
      {Glyph ? <Glyph height="44px" /> : null}
    </div>
  );
}

function PostScreenshot(props: {
  src: string;
  alt: string;
  width: number;
  height: number;
}) {
  return (
    <figure class="mvn-graphic">
      <div class="mvn-graphic-frame">
        <div class="mvn-graphic-inner">
          <img
            src={props.src}
            alt={props.alt}
            loading="lazy"
            width={props.width}
            height={props.height}
            style={{
              width: '100%',
              height: 'auto',
              'aspect-ratio': `${props.width} / ${props.height}`,
            }}
          />
        </div>
      </div>
    </figure>
  );
}

function PostAutoplayClip(props: {
  src: string;
  alt: string;
  width: number;
  height: number;
}) {
  return (
    <figure class="mvn-graphic">
      <div class="mvn-graphic-frame">
        <div class="mvn-graphic-inner">
          <video
            src={props.src}
            aria-label={props.alt}
            autoplay
            loop
            muted
            playsinline
            preload="metadata"
            width={props.width}
            height={props.height}
            style={{
              width: '100%',
              height: 'auto',
              'aspect-ratio': `${props.width} / ${props.height}`,
              display: 'block',
            }}
          />
        </div>
      </div>
    </figure>
  );
}

export const postMeta: PostMeta = {
  slug: 'superhuman-alternative',
  title: 'Macro vs Superhuman',
  seoTitle: 'Macro vs Superhuman — The Open-Source Superhuman Alternative',
  subtitle:
    'Macro is the open source alternative to Superhuman with your workspace built in.',
  date: '2026-06-25',
  updated: '2026-07-28',
  description:
    'Macro is the open-source alternative to Superhuman: the same fast, keyboard-first email, but on your own database and inside one workspace with chat, docs, tasks, calls and a CRM.',
  preview: ARTICLE_PREVIEW,
  tags: ['macro', 'superhuman', 'comparison'],
  category: 'Comparison',
  coverBrand: 'superhuman',
  image: '/og/superhuman-alternative.png',
  showTOC: true,
  tocDepth: 2,
  author: { name: 'Jacob Beckerman', role: 'Macro', avatar: avatarJacob },
  ctaButtonName: 'macro_vs_superhuman_cta',
};

export default function MacroVsSuperhumanPost() {
  return (
    <div class="mvn-post">
      <article>
        <aside class="mvn-authors-note">
          <p class="mvn-authors-note-label">Note</p>
          <p>
            When we talk about Superhuman in this article we're referring to
            what's now known as the Superhuman suite (Mail, plus Grammarly,
            Docs, and Go) after the Grammarly acquisition.
          </p>
        </aside>

        <p>{ARTICLE_LEDE}</p>
        <p>
          {ARTICLE_SECOND_PARAGRAPH.before}
          <span class="mvn-hl">{ARTICLE_SECOND_PARAGRAPH.emphasis}</span>
          {ARTICLE_SECOND_PARAGRAPH.after}
        </p>

        <div class="mvn-video">
          <iframe
            src={`https://www.youtube.com/embed/${SUPERHUMAN_VIDEO_ID}?rel=0`}
            title="What we learned from Superhuman"
            loading="lazy"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowfullscreen
          />
        </div>
        <p class="mvn-figcaption">
          What Superhuman taught the industry about email speed, and what we set
          out to build on top of it.
        </p>

        <h2>Macro vs. Superhuman at a glance</h2>
        <ComparisonTable
          competitor="Superhuman"
          logo={SuperhumanLogo}
          rows={comparisonRows}
        />

        <SectionGlyph route="/email" />
        <h2>
          In detail: why Macro is the better choice once you're living across
          email, chat, and docs
        </h2>

        <h3>Macro is multi-modal</h3>
        <p>
          Macro has a <strong>unified inbox</strong> so you can triage all your
          accounts at once using familiar <code>j</code>, <code>k</code> and{' '}
          <code>e</code> shortcuts. You can also view accounts individually if
          you want. Connect 2 emails under Macro's free plan or unlimited emails
          with a paid plan.
        </p>
        <PostScreenshot
          src={accountsSidebar}
          alt="Macro sidebar with two email accounts nested under Email, alongside Channels and Calls"
          width={1120}
          height={600}
        />
        <p class="mvn-figcaption">
          Every account lives under one Email section — triage them together or
          filter to just one.
        </p>
        <p>
          Not just email: see your <strong>internal team chat</strong> (like
          Slack), <strong>@mentions</strong> in docs (like Notion), tickets and
          GitHub PRs in one inbox! Again, use the same <code>j</code>,{' '}
          <code>k</code> and <code>e</code> shortcuts to triage all of these
          content types from one list.
        </p>
        <PostScreenshot
          src={unifiedInbox}
          alt="Macro inbox list mixing docs, emails, tasks, channel messages and shared threads in one triage list"
          width={1400}
          height={439}
        />
        <p class="mvn-figcaption">
          One list, every content type: docs, emails, tasks and channel
          messages, all triaged the same way.
        </p>
        <p>In addition, we've made a few more improvements to Superhuman:</p>

        <h3>Better "Signal" vs. "Noise" split</h3>
        <p>
          Superhuman calls this <em>important</em> and <em>other</em>. Macro
          uses large language models to make this split, and we're introducing
          even more customization. In Superhuman, to our understanding, this
          feature has been around for a long time and they don't use the latest
          AI models to triage your email for you.
        </p>
        <PostScreenshot
          src={signalNoise}
          alt="Macro email view with Signal, Noise, Sent, Calendar and Drafts tabs, Signal selected"
          width={1052}
          height={610}
        />
        <p class="mvn-figcaption">
          Signal is the mail worth reading; Noise is still one keystroke away
          when you want it.
        </p>

        <SectionGlyph route="/crm" />
        <h3>Deep integration into CRM</h3>
        <p>
          Superhuman has integrations with HubSpot and Salesforce that we used
          when we used to use those products. It's pretty limited in what you
          can see though, and oftentimes you just have to go into a new tab and
          open HubSpot anyways. Macro's CRM is native to the workspace.
        </p>
        <PostScreenshot
          src={crmBoard}
          alt="Macro CRM board with Lead, Demo, Customer and Churned columns of company cards"
          width={1400}
          height={905}
        />
        <p class="mvn-figcaption">
          The CRM is a first-class surface in the same app as your inbox, not a
          read-only widget beside it.
        </p>

        <h3>Full duplex email synchronization</h3>
        <p>
          To our knowledge, the way Superhuman works is it uses the Gmail API or
          the Outlook API to pull your emails in for synchronization and then
          uses a local cache. Macro actually creates a whole backup of your
          emails so that we are not rate limited by the Gmail API after the
          initial backfill process is complete.
        </p>

        <SectionGlyph route="/agents" />
        <h3>AI drafting</h3>
        <p>
          You can draft and send emails right from the AI agent, which will
          draft emails based off of its unified memory of you as well as the
          tools it has. It can go and search prior interactions with people and
          build up agent-specific context before drafting the email. You can
          iterate with it and then hit send without leaving the agent.
        </p>
        <PostScreenshot
          src={agentDraft}
          alt="Macro agent drafting a catch-up email in the composer after searching recent conversations"
          width={1400}
          height={905}
        />
        <p class="mvn-figcaption">
          Ask for a draft, watch it pull context from prior threads, then
          iterate and send without leaving the agent.
        </p>

        <SectionGlyph route="/documents" />
        <h3>Splitscreen and multitasking</h3>
        <p>
          Superhuman is built like a horse with blinders on. It's very good for
          founders and salespeople that just need to respond to lots of emails.
          But when I've talked to friends in banking and other professions where
          they have to write emails that reference a lot of other content —
          lawyers, for example — Superhuman isn't so good for multitasking
          compared to Outlook, because it only lets you have one email open at
          once and you can't even see your inbox at the same time.
        </p>
        <p>
          Macro fixes this with a split screen system, our splits, that let you
          see as many panes as your screen will allow using its own built-in
          window manager. You can draft multiple emails at once and search
          multiple things at once. It's basically as good as Outlook Desktop,
          which is the gold standard for multitasking.
        </p>
        <PostScreenshot
          src={emailSplits}
          alt="Two Macro email splits side by side: an open thread on the left and a new draft being composed on the right"
          width={1400}
          height={864}
        />
        <p class="mvn-figcaption">
          Read a thread in one split while you draft in another — no tabs, no
          popped-out compose windows.
        </p>

        <h3>Macro has a unified properties system</h3>
        <p>
          It works across not just email but all surfaces, not just custom
          fields bolted onto one inbox. You can apply the same fields to
          documents, tasks, messages and emails. For example, internally we have
          a <code>user feedback</code> tag that we apply to documents we write
          on user calls, emails from users with feedback, and messages we send
          in our <code>#bug-reports</code> channel.
        </p>
        <PostScreenshot
          src={propertiesPanel}
          alt="Macro side panel on an email showing Actions, Tags including user feedback, and Properties"
          width={876}
          height={670}
        />
        <p class="mvn-figcaption">
          The same tags and properties panel appears on emails, docs, tasks and
          messages alike.
        </p>

        <SectionGlyph route="/channels" />
        <h3>Macro lets you share emails to channels</h3>
        <p>
          From any email, you can just hit the share button in the top right and
          instantly send a message to any one of your contacts or any member of
          your team.
        </p>
        <PostAutoplayClip
          src={emailShareDemo}
          alt="Sharing an email thread from Macro: hit Share, pick a recipient, add a note, and the thread lands in the channel"
          width={1920}
          height={1080}
        />
        <p class="mvn-figcaption">
          Hit <strong>Share</strong> on a thread, pick who gets it, add a note —
          the email itself lands in the channel, not a screenshot of it.
        </p>
        <p>
          With Slack + Gmail you're accustomed to taking a screenshot of an
          email and pasting it into a channel. But then a new email comes in on
          the chain, and the e.g. <code>#support</code> channel doesn't see the
          latest email.
        </p>
        <p>
          <strong>
            There's a chasm that forms between colleagues that live in Slack and
            those that live in email.
          </strong>
        </p>
        <p>Macro fixes this:</p>
        <ol class="mvn-list">
          <li>
            <code>Share</code> button sends the email right into channels, just
            like sharing a doc
          </li>
          <li>Every member of the channel gets access</li>
          <li>Teammates see the whole chain and new emails as they come in</li>
          <li>Agents in the channel also get access to the email</li>
        </ol>
        <p>
          Superhuman does have a sharing feature (Shared Conversations), but it
          doesn't share into the main chat system that you and your team
          actually use to communicate. It creates a parallel chat system on the
          email chain itself. That forces the whole company to check Superhuman
          for messages too, on top of Slack. When we used to use this, we found
          people just weren't checking Superhuman enough, because Slack was
          still the primary chat. It ended up being confusing rather than
          useful. It was simpler to just send a screenshot of the Superhuman
          chain into Slack.
        </p>

        <SectionGlyph route="/email" />
        <h2>In detail: what Superhuman still does really well</h2>

        <h3>Where Superhuman's taste comes from</h3>
        <p>
          Superhuman invented CMD+K and popularized dark mode in email years
          before it was standard. That lineage shows in the product, it's
          genuinely one of the best-designed pieces of software out there, and
          it set the bar for companies like Linear that came after.
        </p>

        <h3>A fast, focused single inbox</h3>
        <p>What both Superhuman and Macro have:</p>
        <ul class="mvn-list">
          <li>Split inbox</li>
          <li>AI auto-tagging</li>
          <li>Connect all your accounts</li>
        </ul>

        <h3>Both Superhuman and Macro have a clean user interface</h3>
        <p>
          Macro's <code>block-email</code> interface, where you actually see,
          respond to, and triage the email, is modeled after Superhuman.
        </p>
        <PostScreenshot
          src={superhumanShared}
          alt="A Superhuman Shared Conversation thread with the shared reply highlighted inside Superhuman"
          width={1400}
          height={869}
        />
        <p class="mvn-figcaption">
          Superhuman: the thread view, and a Shared Conversation living inside
          it.
        </p>
        <PostScreenshot
          src={blockEmail}
          alt="The same thread open in Macro's block-email view with Actions, Tags and Properties beside it"
          width={1400}
          height={905}
        />
        <p class="mvn-figcaption">
          Macro's block-email view of the same thread — the shortcuts and layout
          come straight from Superhuman.
        </p>

        <h2>Macro vs. Superhuman pricing comparison</h2>
        <p>
          Macro is one flat $40 per seat, and that includes every module: email,
          chat, docs, tasks, CRM, calls, all of it, with all AI features
          included. We also have a free plan that covers everything for personal
          use with some limits on storage and AI. Superhuman is also $40 a month
          which includes Superhuman and Grammarly. Some people might use both of
          those products but the kinds of users that need Superhuman —
          salespeople, founders, execs — and Grammarly (more junior or foreign
          language people) might have limited overlap.
        </p>

        <h2>When to choose Macro</h2>
        <p>Choose Macro when:</p>
        <ul class="mvn-list">
          <li>
            You want email, chat, docs, and tasks triaged from one unified inbox
            instead of four separate tools
          </li>
          <li>
            You want AI that actually drafts and sends with memory of your past
            interactions, not just tone-matching
          </li>
          <li>
            You need to multitask across a lot of reference material, not just
            blast through a single queue
          </li>
          <li>
            You want emails to live in the same channel your team already uses
            to communicate, instead of a parallel thread
          </li>
        </ul>

        <h2>When to choose Superhuman</h2>
        <p>Choose Superhuman when:</p>
        <ul class="mvn-list">
          <li>
            You just need the fastest possible single inbox and don't care about
            chat, docs, or tasks living alongside it
          </li>
          <li>
            You're a founder or salesperson whose whole job is responding to a
            high volume of email, one thread at a time
          </li>
          <li>
            You already use HubSpot, Salesforce, or Pipedrive and just want a
            read-only peek at them from your inbox
          </li>
          <li>
            You want Grammarly's writing assistant and Docs product more than
            you need a unified team workspace
          </li>
        </ul>

        <h2>Macro vs. Superhuman: the verdict</h2>
        <p>
          Superhuman is genuinely great, and it shaped a lot of how we think
          about speed and polish in Macro. But it's built for one inbox at a
          time. If your job is answering email as fast as possible and nothing
          else, it's excellent at that. If you're trying to keep email, chat,
          docs, and tasks from splintering into four different products your
          team half-checks, Macro is built for that instead.
        </p>

        <h2>FAQs</h2>
        <div class="mvn-faq">
          <h3>Is Macro better than Superhuman?</h3>
          <p>
            For teams that live across email, chat, and docs, yes. Macro triages
            all of it from one inbox with the same shortcuts Superhuman
            popularized. For someone whose entire job is answering a single
            inbox as fast as possible, Superhuman is still excellent at that one
            thing.
          </p>

          <h3>Is Macro cheaper than Superhuman?</h3>
          <p>
            Depends what you're comparing. Macro is $40/seat flat with
            everything included. Superhuman's Mail only shows up on the Business
            plan, $33/seat/month billed annually ($40 monthly), and that doesn't
            include a native chat, docs, or task layer, those are separate
            Superhuman products (Grammarly, Docs) with their own limits.
          </p>

          <h3>Does Superhuman have team chat or tasks?</h3>
          <p>
            No. Superhuman's Shared Conversations let you loop teammates into an
            email thread, but it's a parallel system, not your team's actual
            chat. Macro's channels are native, and emails, docs, and tasks all
            live in the same inbox.
          </p>

          <h3>Why does Macro's email UI look like Superhuman's?</h3>
          <p>
            Because we built it that way on purpose. Macro's{' '}
            <code>block-email</code> interface is modeled after Superhuman's, we
            think they got that part right, and it laid a lot of the groundwork
            for what "polished" looks like in email.
          </p>
        </div>

        <p>
          For keyboard shortcuts, the multi-account inbox, sharing and AI
          drafting, see the{' '}
          <a
            href="https://docs.macro.com/product/email"
            target="_blank"
            rel="noreferrer"
          >
            Macro Mail documentation
          </a>
          .
        </p>
      </article>
    </div>
  );
}
