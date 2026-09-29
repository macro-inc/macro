import '../macro-vs-notion/MacroVsNotion.css';
import { featureNavGlyphs } from '../../../../app/components/graphics/FeatureNavGlyphs';
import avatarJacob from '../../../../assets/people/jacob.webp';
import agentBulkSearch from '../../../../assets/posts/macro-vs-slack/agent-bulk-search.png';
import agentInChannel from '../../../../assets/posts/macro-vs-slack/agent-in-channel.png';
import agentMentionContext from '../../../../assets/posts/macro-vs-slack/agent-mention-context.png';
import inlineReplies from '../../../../assets/posts/macro-vs-slack/inline-replies.png';
import signalNoise from '../../../../assets/posts/macro-vs-slack/signal-noise.png';
import splitScreen from '../../../../assets/posts/macro-vs-slack/split-screen.png';
import tasksIntegration from '../../../../assets/posts/macro-vs-slack/tasks-integration.png';
import threadExpand from '../../../../assets/posts/macro-vs-slack/thread-expand.png';
import {
  type ComparisonRow,
  ComparisonTable,
  SlackLogo,
} from '../../PostComparison';
import type { PostMeta } from '../../registry';

const SLACK_VIDEO_ID = '1gDOXUxHo0U';
const ARTICLE_PARAGRAPHS = [
  'Before Macro, we used Slack for years and never had any problems with it.',
  "That's to say, beyond the usual, mildly annoying problems that I didn't think of as being that bad:",
] as const;
const ARTICLE_PREVIEW = ARTICLE_PARAGRAPHS.join(' ');

const comparisonRows: ComparisonRow[] = [
  {
    feature: 'What you get',
    macro: 'Channels inside a full workspace',
    them: 'A best-in-class standalone chat app',
  },
  {
    feature: 'Inbox',
    macro: 'A real inbox; leave messages for later',
    them: 'Read and unread only',
  },
  {
    feature: 'Focus',
    macro: 'Signal and Noise, AI-sorted',
    them: 'Notifications and mute',
  },
  {
    feature: 'Connected to',
    macro: 'Email, docs, tasks, calls, CRM',
    them: 'Outside apps via integrations',
  },
  {
    feature: '@-mentions',
    macro: 'Anything in your company',
    them: 'People and channels',
  },
  { feature: 'Fast team channels', macro: 'Yes', them: 'Yes (the benchmark)' },
  {
    feature: 'Create tasks from messages',
    macro: 'Yes, native and linked',
    them: 'Via integration',
  },
  { feature: 'Native email client', macro: 'Yes', them: 'No', themNo: true },
  {
    feature: 'Docs and editor',
    macro: 'Yes (CRDT, agentic)',
    them: 'Canvas (basic)',
  },
  { feature: 'CRM', macro: 'Yes (auto-updating)', them: 'No', themNo: true },
  {
    feature: 'Calls',
    macro: 'In-channel, recorded, transcribed',
    them: 'Huddles (no memory)',
  },
  {
    feature: 'App directory and integrations',
    macro: 'Growing',
    them: 'Extensive',
  },
  {
    feature: 'Cross-company channels',
    macro: 'Limited',
    them: 'Yes (Slack Connect)',
  },
  {
    feature: 'Shared team memory',
    macro: 'Yes, across every surface',
    them: 'No',
    themNo: true,
  },
  { feature: 'Open source', macro: 'Yes, end to end', them: 'No, closed box' },
  {
    feature: 'Pricing model',
    macro: 'Flat, by company stage',
    them: 'Per seat, by plan tier',
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
  phone?: boolean;
  fadeRight?: boolean;
}) {
  return (
    <figure
      classList={{
        'mvn-graphic': true,
        'mvn-graphic--phone': !!props.phone,
        'mvn-graphic--fade-right': !!props.fadeRight,
      }}
    >
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

export const postMeta: PostMeta = {
  slug: 'slack-alternative',
  title: 'Macro vs Slack',
  seoTitle: 'Macro vs Slack — The Open-Source Slack Alternative',
  subtitle:
    'Macro is the open source alternative to Slack with a real inbox and a full workspace built in.',
  date: '2026-06-25',
  description:
    'Macro is the open-source alternative to Slack: team channels with a real inbox and Signal vs Noise, wired into your email, docs, tasks, calls and a CRM with one shared memory.',
  preview: ARTICLE_PREVIEW,
  tags: ['macro', 'slack', 'comparison'],
  category: 'Comparison',
  coverBrand: 'slack',
  image: '/og/slack-alternative.png',
  showTOC: true,
  tocDepth: 2,
  author: { name: 'Jacob Beckerman', role: 'Macro', avatar: avatarJacob },
  ctaButtonName: 'macro_vs_slack_cta',
};

export default function MacroVsSlackPost() {
  return (
    <div class="mvn-post">
      <article>
        <p>{ARTICLE_PARAGRAPHS[0]}</p>
        <p>{ARTICLE_PARAGRAPHS[1]}</p>
        <ul class="mvn-list">
          <li>
            Slack is "noisy", seemingly encouraging random pings and constant
            babysitting. It was unclear to me whether this was an issue with
            Slack or just with workplace chat in general. We used to have quiet
            hours for focused deep work where no pings were allowed. Certain
            people muted certain channels (and DMs 🙍), which was a good stopgap
            until it led to the cultural issue of people not seeing messages.
          </li>
          <li>
            Slack, being owned by Salesforce, isn't really integrated with your
            tools. We never used Microsoft Teams, but I'd guess Teams is more
            tightly integrated with the Office suite than Slack is with Google.
            But then you'd have to use the Microsoft suite, and no team that has
            the choice wants to do that. What I mean is: Slack isn't tightly
            integrated with Gmail or Google Docs, or with tools we used like
            Notion, Linear and Figma. The result is that conversations get split
            between Slack and the commenting features of those tools. Again, I
            didn't realize this at the time, but it's a big reason why things
            got chaotic as we scaled our team.
          </li>
        </ul>
        <p>
          Since migrating onto Macro I've realized Slack was taking up more time
          than I thought it was, for me and our team. It was kind of like a mini
          social network.
        </p>
        <p class="mvn-hl">
          Not quite as distracting as Twitter, but still pretty distracting for
          our team.
        </p>
        <p>
          I'd seen people complaining about Slack being noisy before, but I
          didn't really grok it until we switched off it onto Macro Chat.
        </p>

        <div class="mvn-video">
          <iframe
            src={`https://www.youtube.com/embed/${SLACK_VIDEO_ID}?rel=0`}
            title="What we learned from Slack"
            loading="lazy"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowfullscreen
          />
        </div>
        <p class="mvn-figcaption">
          What Slack got right about team chat, and where a chat-only app leaves
          real work on the table.
        </p>

        <h2>At a glance</h2>
        <ComparisonTable
          competitor="Slack"
          logo={SlackLogo}
          rows={comparisonRows}
        />

        <SectionGlyph route="/email" />
        <h2>A Signal vs. Noise split to keep you sane</h2>
        <p>
          The main innovation of Macro for making things quieter is the Signal
          vs. Noise split. Important emails, messages and @mentions go into
          Signal, and non-important things go into Noise.
        </p>
        <PostScreenshot
          src={signalNoise}
          alt="Macro inbox with Signal, Noise and All tabs, showing grouped channel replies from #bug-reports and an email draft"
          width={1435}
          height={751}
        />
        <p class="mvn-figcaption">
          One inbox, pre-sorted: what matters lands in Signal; everything else
          waits in Noise until you want it.
        </p>

        <SectionGlyph route="/channels" />
        <h2>Unread on the side, not everything</h2>
        <p>
          The second big thing that makes Macro less noisy than Slack is that
          only your unread channels are on the side, not every channel (of
          course, you can pin channels if you want them there). This
          ever-so-slight bit of friction to open a channel, for everyone on your
          team, creates less traffic. I know it doesn't sound like much, but
          when I introspect on why our Macro Chat is quieter than our Slack was,
          I think this is why.
        </p>

        <SectionGlyph route="/tasks" />
        <h2>Macro Chat tightly integrates with engineering tasks</h2>
        <p>
          If you read our{' '}
          <a href="/posts/linear-alternative">post on Macro vs. Linear</a>,
          you'll see me talk about how tightly channels are integrated with
          Macro tasks. This has been really helpful for our engineering team
          staying on track without needing a dedicated PM keeping track of
          everything — which works well with our culture of agency and no
          micromanaging. We no longer have to "stay on top" of everybody,
          because everybody is creating tasks and marking them complete (or it
          happens automatically with the GitHub integration) without me having
          to prod them to keep things updated.
        </p>
        <PostScreenshot
          src={tasksIntegration}
          alt="A task pill in a Macro channel thread expanded into a preview card showing status, assignees and due date"
          width={1213}
          height={658}
        />
        <p class="mvn-figcaption">
          Tasks render as live pills right in the conversation — hover to see
          status, assignees and the linked GitHub PR.
        </p>

        <SectionGlyph route="/documents" />
        <h2>Split-screen channels in Macro Chat</h2>
        <p>
          Slack only lets you have one window open at a time, which makes it
          hard to multitask. When I look at our team using Macro Chat, they
          often have multiple splits open at a time, which wouldn't be possible
          with Slack. This makes it easy to carry out multiple conversations in
          parallel.
        </p>
        <PostScreenshot
          src={splitScreen}
          alt="Three Macro channels — Engineers, bug-reports and creative team — open side by side in split view"
          width={2347}
          height={1237}
        />
        <p class="mvn-figcaption">
          Three channels open at once: triage a bug, follow the engineering
          thread and answer the design question in parallel.
        </p>

        <SectionGlyph route="/channels" />
        <h2>Inline replies are easier to read in Macro</h2>
        <p>
          With Slack, I'd often forget which channel a message was sent in, and
          I'd have to go looking through all the different channels to find it.
        </p>
        <p>
          In Macro this is a lot easier because the first few replies to a
          message show inline (like Reddit or forums), instead of being hidden
          in a side flap like Slack that you need to expand to see the context
          of the thread. Most threads are just people saying "okay" or one or
          two more messages, and it's wasteful to have to stop and open the
          thread just to see one additional message. Really long threads are
          still perma-linked, and you can hit expand to view them fully.
        </p>
        <p>
          For example, here's how I can read multiple threads at a time without
          needing to expand and collapse:
        </p>
        <PostScreenshot
          src={inlineReplies}
          alt="A Macro channel where several threads show their first replies inline, with a '2 more replies' pill for the longer one"
          width={1573}
          height={1213}
        />
        <p class="mvn-figcaption">
          Short threads read top to bottom, in place — no side flap, no clicking
          into each one.
        </p>
        <p>
          Replying to a thread works like this. Just click the <code>+</code>{' '}
          button and the thread expands:
        </p>
        <PostScreenshot
          src={threadExpand}
          alt="An expanded Macro thread with a reply composer open inline under the messages"
          width={1443}
          height={418}
        />

        <SectionGlyph route="/agents" />
        <h2>Better access for agents: a real MCP surface</h2>
        <p>
          One of the awesome things about Macro is the unified memory for the
          agent. It can search all your channels as well as list recent messages
          in bulk. That's the important part: in bulk. Where Slack's MCP is
          limited in what it can read, Macro's MCP is far more capable for the
          agent — and for your own agents that you can plug in. Here's an
          example of that:
        </p>
        <PostScreenshot
          src={agentBulkSearch}
          alt="The Macro agent reading 30 messages each from the Engineers and bug-reports channels in bulk, then summarizing the team's day"
          width={1240}
          height={775}
        />
        <p class="mvn-figcaption">
          One prompt, whole channels read in bulk — the agent summarizes a day
          of team activity across channels, tasks and docs.
        </p>
        <p>
          You can also feed the agent context manually by @mentioning, like
          this:
        </p>
        <PostScreenshot
          src={agentMentionContext}
          alt="An @mention picker in the agent composer suggesting a channel and an email thread as context"
          width={1357}
          height={604}
        />

        <SectionGlyph route="/agents" />
        <h2>Powerful built-in agents, integrated with your workspace</h2>
        <p>
          Slack and Macro both have agents in channels, @mentionable just like
          human users. Slack has a well-developed marketplace and a lead in
          integrations compared to Macro (as of 2026), whereas Macro has a
          stronger first-party agent with full-workspace context and the ability
          to take action. When you <code>@Macro</code> in a channel, it gains
          the permissions of the person sending the message, allowing it to
          access everything, create tasks, send messages, and more.
        </p>
        <PostScreenshot
          src={agentInChannel}
          alt="A bug report in a Macro channel where @Macro is asked to make a task and replies with the created, linked task"
          width={1465}
          height={937}
        />
        <p class="mvn-figcaption">
          <code>@Macro</code> reads the thread, creates the task and links it
          back — then asks if it should assign and prioritize it.
        </p>

        <h2>Conclusion</h2>
        <p>
          Slack is a mature chat platform with a big integration marketplace and
          Slack Connect to chat across companies. Macro is quieter, has better
          UX, and is a more powerful bedrock for agentic development.
        </p>

        <h2>FAQ</h2>
        <div class="mvn-faq">
          <h3>Should I switch from Slack to Macro?</h3>
          <p>
            If your stack is Slack plus email plus a tracker plus docs plus a
            CRM, yes — that is five tools that do not share context. Run Macro
            alongside Slack for a week, move a few active channels over, and
            feel what a real inbox and a Signal/Noise split do to your day.
          </p>

          <h3>When would I keep Slack instead?</h3>
          <p>
            When you depend on Slack's enormous app directory or on Slack
            Connect channels with external companies. Those ecosystems took
            years to build and we will not pretend Macro matches them yet; some
            teams keep both during a transition.
          </p>

          <h3>Does Macro have huddles or calls?</h3>
          <p>
            Yes — start a call in any channel or DM like a huddle, or share a
            link like Google Meet. Calls run across devices with nothing to
            install and are recorded, transcribed and diarized into your team's
            shared memory by default.
          </p>

          <h3>Is Macro open source?</h3>
          <p>
            Yes, end to end:{' '}
            <a
              href="https://github.com/macro-inc/macro"
              target="_blank"
              rel="noreferrer"
            >
              github.com/macro-inc/macro
            </a>
            . Your data stays open and portable and the app is extensible. Slack
            is closed source.
          </p>
        </div>

        <p>
          For the inbox, Signal and Noise, @mentions and turning messages into
          tasks, see the{' '}
          <a
            href="https://docs.macro.com/product/channels"
            target="_blank"
            rel="noreferrer"
          >
            Macro channels documentation
          </a>
          .
        </p>
      </article>
    </div>
  );
}
