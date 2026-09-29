import { For } from 'solid-js';
import '../macro-vs-notion/MacroVsNotion.css';
import { featureNavGlyphs } from '../../../../app/components/graphics/FeatureNavGlyphs';
import { PhoneFrame } from '../../../../app/components/utils/UtilPhoneFrame';
import avatarJacob from '../../../../assets/people/jacob.webp';
import linkedWorkspace from '../../../../assets/posts/macro-vs-linear/linked-workspace.jpg';
import taskCreateButton from '../../../../assets/posts/macro-vs-linear/task-create-button.mp4';
import taskEmailAction from '../../../../assets/posts/macro-vs-linear/task-email-action.png';
import taskFromChannel from '../../../../assets/posts/macro-vs-linear/task-from-channel.jpg';
import taskFromEmailModal from '../../../../assets/posts/macro-vs-linear/task-from-email-modal.jpg';
import taskFromHuddle from '../../../../assets/posts/macro-vs-linear/task-from-huddle.jpg';
import taskGithubPr from '../../../../assets/posts/macro-vs-linear/task-github-pr.jpg';
import {
  type ComparisonRow,
  ComparisonTable,
  LinearLogo,
} from '../../PostComparison';
import type { PostMeta } from '../../registry';

const LINEAR_VIDEO_ID = 'nHxqE2mVKrA';
const TASKS_VIDEO_ID = 'gxJquVXRX5A';
const ARTICLE_PARAGRAPHS = [
  'We loved Linear. Before Macro we ran our old company on it, and Macro Tasks is inspired by its keyboard-first speed and design principles.',
  'Linear is really really good for pure task tracking.',
] as const;
const ARTICLE_PREVIEW = ARTICLE_PARAGRAPHS.join(' ');

const comparisonRows: ComparisonRow[] = [
  {
    feature: 'What you get',
    macro: 'Tasks inside a full workspace',
    them: 'A focused issue tracker',
  },
  {
    feature: 'Fast, keyboard-first tasks',
    macro: 'Yes (Linear-inspired)',
    them: 'Yes (the benchmark)',
  },
  {
    feature: 'Create tasks from email',
    macro: 'Yes, native',
    them: 'No',
    themNo: true,
  },
  {
    feature: 'Create tasks from chat',
    macro: 'Yes, bidirectional',
    them: 'Via integration',
  },
  {
    feature: 'Create tasks from calls',
    macro: 'Yes (recorded, transcribed)',
    them: 'No',
    themNo: true,
  },
  {
    feature: 'Links',
    macro: 'Bidirectional with everything',
    them: 'Other issues and connected apps',
  },
  { feature: 'GitHub linking', macro: 'Yes, bidirectional', them: 'Yes, deep' },
  { feature: 'PRs in a unified inbox', macro: 'Yes', them: 'No', themNo: true },
  {
    feature: 'Chat, email, docs and CRM',
    macro: 'Yes, native',
    them: 'No',
    themNo: true,
  },
  {
    feature: 'Shared AI memory across team',
    macro: 'Yes',
    them: 'No',
    themNo: true,
  },
  {
    feature: 'Cycles, projects and roadmaps',
    macro: 'Lightweight',
    them: 'Deep',
  },
  {
    feature: 'Triage, insights and workflows',
    macro: 'Basic',
    them: 'Advanced',
  },
  { feature: 'Third-party integrations', macro: 'Growing', them: 'Extensive' },
  {
    feature: 'Open source',
    macro: 'Yes, end to end',
    them: 'No',
    themNo: true,
  },
  { feature: 'Pricing', macro: 'Flat, by stage', them: 'Per seat, by tier' },
];

const USER_QUOTES: { name: string; text: string }[] = [
  {
    name: 'Seamus',
    text: 'I think because they\u2019re faster to make I make more of them and track more of them. And that part is positive. I make more tickets compared to Linear and I lose track of less stuff \u2014 I\u2019m already there checking the messages and I can easily turn that into a task instead of having to open Linear.',
  },
  {
    name: 'Seamus',
    text: 'Compared to Linear, Macro has an obvious good writing surface. I do more spec writing in tasks for agents \u2014 in Linear I didn\u2019t like the writing surface as much \u2014 then I\u2019ll use a skill to delegate it to an agent.',
  },
  {
    name: 'Eric',
    text: 'I\u2019ll often collect tasks into a todo doc, which is easier in Macro. I prefer organizing things in a markdown doc vs the list view \u2014 it\u2019s just easier for me.',
  },
  {
    name: 'Julia',
    text: 'I joined at the tail end of when we used Linear. I think I make tasks less in Macro \u2014 because in Linear I used to make a lot of tickets each morning as a morning ritual. Now the tickets are mostly there for me.',
  },
  {
    name: 'Rahul',
    text: 'In Linear it felt like there was a big giant backlog of tasks; I probably should have gone in and deleted them. In Macro I still have a backlog obviously, but it\u2019s less cluttered.',
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
  fadeRight?: boolean;
}) {
  return (
    <figure
      classList={{
        'mvn-graphic': true,
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

function PostPhoneScreenshot(props: {
  src: string;
  alt: string;
  width: number;
  height: number;
}) {
  return (
    <figure class="mvn-phone">
      <PhoneFrame>
        <img
          src={props.src}
          alt={props.alt}
          loading="lazy"
          width={props.width}
          height={props.height}
          style={{
            display: 'block',
            width: '100%',
            height: 'auto',
            'aspect-ratio': `${props.width} / ${props.height}`,
          }}
        />
      </PhoneFrame>
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
  slug: 'linear-alternative',
  title: 'Macro vs Linear',
  seoTitle: 'Macro vs Linear — The Open-Source Linear Alternative',
  subtitle:
    'Macro is the open source alternative to Linear for fast engineering task management.',
  date: '2026-06-25',
  updated: '2026-07-09',
  description:
    'Macro is the open-source alternative to Linear: fast, keyboard-first task management inside one workspace with email, chat, docs, calls and a CRM, linked to GitHub and a shared team memory.',
  preview: ARTICLE_PREVIEW,
  tags: ['macro', 'linear', 'comparison'],
  category: 'Comparison',
  coverBrand: 'linear',
  image: '/og/linear-alternative.png',
  showTOC: true,
  tocDepth: 2,
  author: { name: 'Jacob Beckerman', role: 'Macro', avatar: avatarJacob },
  ctaButtonName: 'macro_vs_linear_cta',
};

export default function MacroVsLinearPost() {
  return (
    <div class="mvn-post">
      <article>
        <p>{ARTICLE_PARAGRAPHS[0]}</p>
        <p>{ARTICLE_PARAGRAPHS[1]}</p>
        <p class="mvn-hl">But tasks don't exist in a vacuum...</p>

        <p>
          The actual conversation about the task is in Slack, and you work on
          the code in Claude, and the docs are in Notion. Customer emails with
          bug reports are in Gmail/Superhuman. All of these apps are
          disconnected from each other.
        </p>
        <p>
          Architecturally, task management should not be a separate tab from the
          rest of the work — they should be part of the same system.{' '}
          <span class="mvn-hl">Macro is that system</span>: tasks in the same
          @linked workspace as email, messages, agents, docs, calls and CRM.
        </p>

        <p>
          The problem with standalone issue tracking is as Linear says
          themselves...
        </p>
        <div class="mvn-quote">
          <blockquote>
            <a
              href="https://linear.app/next"
              target="_blank"
              rel="noopener noreferrer"
            >
              Issue tracking is dead.
              <br />
              <br />
            </a>{' '}
            It was built for a handoff model of software development. A PM
            scoped the work, engineers picked it up later, and the system filled
            with prioritization, negotiation, and workflows to bridge the gap
            [...] But over time, complexity started to look like sophistication.
          </blockquote>
        </div>
        <p>
          Indeed, standalone issue tracking is dead. It was already cumbersome
          to create and manage issues. Agents were the death knell.
        </p>

        <div class="mvn-video">
          <iframe
            src={`https://www.youtube.com/embed/${LINEAR_VIDEO_ID}?rel=0`}
            title="What we learned from Linear"
            loading="lazy"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowfullscreen
          />
        </div>
        <p class="mvn-figcaption">
          What we took from years of running on Linear, and why we eventually
          wanted tasks to live next to everything.
        </p>

        <h2>At a glance</h2>

        <ComparisonTable
          competitor="Linear"
          logo={LinearLogo}
          rows={comparisonRows}
        />

        <SectionGlyph route="/tasks" />
        <h2>Task creation: Linear is manual, Macro is automatic</h2>
        <p>
          Macro and Linear are comparably fast once you are inside the tracker:
          tasks are quick to create, assign, prioritize and close with keyboard
          shortcuts.
        </p>
        <p>
          But most tasks are ideated somewhere else — an email from a customer,
          a line in a spec, a comment on a call — and when we used Linear that
          meant switching tabs to hit c/t. Sounds fast, but since it's another
          thing to do, the Slack conversation, eng huddle, or customer email
          often never led to a ticket.
        </p>
        <p>
          In Macro you spin one up without leaving where you are working. Every
          task is linked back to its source bidirectionally — the task remembers
          where it came from and the source knows the task exists. Linear can be
          notified about a Slack thread; in Macro the message and the task are
          two views of one object.
        </p>

        <h3>From a customer email</h3>
        <p>
          Open any email — a customer report, a bug thread, a partner ask — and
          hit <strong>Task</strong> in the Actions panel. Macro opens the
          create-task modal with the email already attached as context, so the
          assignee can jump straight back to the thread.
        </p>
        <PostScreenshot
          src={taskEmailAction}
          alt="Email sidebar Actions panel with Ask Macro and Task buttons, cursor on Task"
          width={517}
          height={291}
        />
        <p class="mvn-figcaption">
          Hit <strong>Task</strong> on any email to turn it into a tracked item
          without leaving your inbox.
        </p>
        <PostScreenshot
          src={taskFromEmailModal}
          alt="Create task modal opened from an email, with the source thread linked in the description"
          width={1024}
          height={640}
        />
        <p class="mvn-figcaption">
          The modal opens with the email linked — status, assignee and priority
          ready to set, source attached.
        </p>

        <h3>From a channel message</h3>
        <p>
          Hover any message and click <strong>Create task</strong>. Macro spins
          one up deterministically, linked to that thread — no copy-paste into
          another tab.
        </p>
        <PostAutoplayClip
          src={taskCreateButton}
          alt="Hovering a channel message and clicking Create task in the message toolbar"
          width={1278}
          height={720}
        />
        <p class="mvn-figcaption">
          Click <strong>Create task</strong> on any message to spin one up,
          linked to that thread.
        </p>

        <h3>Ask @Macro</h3>
        <p>
          Mention <code>@Macro</code> in a channel and ask it to create a task
          from what was just said. It assigns the work and links the task back
          to the conversation.
        </p>
        <PostScreenshot
          src={taskFromChannel}
          alt="Channel thread where a user asks @Macro to create a task from a bug report and Macro assigns it with a linked task title"
          width={1024}
          height={330}
        />
        <p class="mvn-figcaption">
          Mention <code>@Macro</code> in a channel and it creates a task from
          the conversation, linked back to the thread.
        </p>

        <h3>Keyboard shortcut</h3>
        <p>
          Hit <code>c</code> then <code>t</code> from anywhere to bring up the
          create task modal — the same Linear-style speed, without leaving
          Macro.
        </p>

        <h3>From markdown to-dos</h3>
        <p>
          Drop a to-do box into any markdown area, highlight the set, and turn
          them into tasks at once. Specs and notes become tracked work without a
          separate triage pass. Linear can do something similar, but only inside
          a task — as subtasks. In Macro it works anywhere in the workspace: a
          personal "todos July 9th" doc, a meeting note, a spec, not just the
          task editor.
        </p>

        <div class="mvn-video">
          <iframe
            src={`https://www.youtube.com/embed/${TASKS_VIDEO_ID}?rel=0`}
            title="Tasks on Macro"
            loading="lazy"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowfullscreen
          />
        </div>
        <p class="mvn-figcaption">
          Tasks are quick to create and easy to close out — status, priority and
          assignee, linked to the rest of your workspace.
        </p>

        <SectionGlyph route="/calls" />
        <h2>Create and assign tasks from standups and huddles</h2>
        <p>
          A lot of tasks are decided on a call and never make it into a tracker
          — someone says they will do something on the standup, everyone nods,
          and by Monday nobody wrote it down. With Linear that meant opening
          another tab after the huddle and trying to remember who owned what.
          Macro keeps the meeting in the same workspace as the tracker.
        </p>
        <p>
          Spin up a huddle in any channel or DM without sharing a link, or run a
          full meet with one. Calls record, transcribe and diarize by default,
          so what got said on the standup is searchable and shared with the
          team. Mention <code>@Macro</code> during or after the call and ask it
          to create tasks from what was discussed — Macro assigns them to the
          right people and links each one back to the recording. No one has to
          play secretary.
        </p>
        <PostScreenshot
          src={taskFromHuddle}
          alt="Channel message with an active Macro huddle showing participants and in-call controls on mobile"
          width={1024}
          height={665}
        />
        <p class="mvn-figcaption">
          Start a huddle from any channel — on desktop or mobile — and turn what
          gets said into assigned tasks when it ends.
        </p>

        <SectionGlyph route="/github" />
        <h2>Linked to GitHub, both ways</h2>
        <p>
          For engineering work, Macro tasks link to GitHub bidirectionally and
          to the agents working on them. Click the GitHub pill to jump from a
          task to its pull request, or the other way around, all opening in a
          split inside Macro so you never leave your workspace.
        </p>
        <p>Here's what this looks like on mobile:</p>
        <PostPhoneScreenshot
          src={taskGithubPr}
          alt="Macro task detail with a linked GitHub pull request pill, status, assignees and discussion thread"
          width={472}
          height={820}
        />
        <p class="mvn-figcaption">
          A task with its GitHub PR linked bidirectionally — click the pill to
          open the review in a split.
        </p>
        <p>
          The integration goes one step further into your inbox. GitHub's own
          notifications are famously easy to miss, so Macro brings the PRs where
          you are the author, are mentioned, or get a comment into your unified
          inbox alongside your messages, tasks and important email. You stop
          checking three places to find out a review came in, and team velocity
          goes up for the boring reason that nothing waits unseen.
        </p>
        <p>
          Linear recently added the ability to view PRs alongside issues, albeit
          not unified in an inbox with messages and mail in one place, it is
          still a separate thing to check.
        </p>

        <SectionGlyph route="/agents" />
        <h2>One linked system, one team memory</h2>
        <p>
          In Linear you link issues to issues, and to PRs and a handful of
          connected apps. In Macro you can @-mention anything in your company
          from a task: a doc, a file, a customer email, a support ticket, a
          channel message, a recorded call. The links are bidirectional, so the
          task and whatever it touches both know about each other, and your
          workspace becomes context you can navigate in either direction.
        </p>
        <PostScreenshot
          src={linkedWorkspace}
          alt="Macro workspace showing tasks in the same app as email, channels, calls and the rest of the sidebar"
          width={1024}
          height={519}
          fadeRight
        />
        <p class="mvn-figcaption">
          Tasks live in the same app as email, channels, calls and everything
          else — one rail, one linked system.
        </p>
        <p>
          That web is also how permissions work. Anything you @-mention in a
          channel is shared with the people in it; join a channel and you gain
          its context, leave and you lose it. There is no access-request dance,
          because membership is the permission.
        </p>
        <p>
          The same linked graph feeds shared memory across your whole team.
          Macro builds it from your docs, email, tasks, channels, calls and CRM,
          refreshes it nightly, and lets agents do work a standalone tracker
          cannot: assign a task to whoever actually owns that area, route an
          incoming customer report to the right person, or tell you who to ask
          about a piece of code. No tool that only sees issues has the right to
          reason across all of your work. A unified workspace does.
        </p>

        <h2>What our users say</h2>
        <p>
          We dogfood Macro internally. After years on Linear, here is what the
          team said about switching:
        </p>
        <div class="mvn-testimonials">
          <For each={USER_QUOTES}>
            {(quote) => (
              <figure class="mvn-testimonial">
                <blockquote>&ldquo;{quote.text}&rdquo;</blockquote>
                <figcaption>{quote.name}</figcaption>
              </figure>
            )}
          </For>
        </div>

        <h2>FAQ</h2>
        <div class="mvn-faq">
          <h3>Should I switch from Linear to Macro?</h3>
          <p>
            If your stack is Linear plus Slack plus email plus docs plus a CRM,
            yes — that is five tools that do not share context. Run Macro
            alongside Linear for a week, create tasks from your real email and
            channels, wire up GitHub, and see how much context-switching
            disappears.
          </p>

          <h3>When would I keep Linear instead?</h3>
          <p>
            When you explicitly want standalone issue tracking disconnected from
            email, chat, calls and docs — a dedicated tracker tab and
            integrations to bridge the gap, rather than one linked workspace.
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
            . Your data stays open and portable and the app is extensible.
            Linear is closed source.
          </p>

          <h3>Can I move my Linear issues over?</h3>
          <p>
            Run Macro alongside Linear while you switch — create tasks from live
            email and channels so new work lands in Macro without a big-bang
            migration, then bring the rest across as you go.
          </p>
        </div>

        <p>
          For shortcuts, @mentions, the task component and GitHub integration,
          see the{' '}
          <a
            href="https://docs.macro.com/product/tasks"
            target="_blank"
            rel="noreferrer"
          >
            Macro tasks documentation
          </a>
          .
        </p>
      </article>
    </div>
  );
}
