import { A } from '@solidjs/router';
import { Dynamic, isServer } from 'solid-js/web';
import markDesyncPlaceholder from '../../assets/mark-desync-placeholder.jpg';
import { APP_BASE_URL } from '../utils/utilBaseUrl';
import { breakpoint, viewportWidth } from '../utils/utilBreakpoint';
import { setPageSeo } from '../utils/utilSeo';
import './RouteTasks.css';
import { type Component, createSignal, type JSX, Show } from 'solid-js';
import taskListBgUrl from '../../assets/graphics/tasks-task-list.svg?url';
import LogoAsana from '../../assets/icons/logo-asana.svg';
import LogoClickUp from '../../assets/icons/logo-clickup.svg';
import LogoJira from '../../assets/icons/logo-jira.svg';
import LogoLinear from '../../assets/icons/logo-linear.svg';
import {
  type ComparisonColumn,
  ComparisonLegend,
  type ComparisonRow,
  ComparisonTable,
} from '../components/sections/ComparisonTable';
import { HomeSectionRule } from '../components/sections/HomeSectionRule';
import {
  dataSecurityFaqItem,
  type FaqItem,
  SectionFaq,
} from '../components/sections/SectionFaq';
import { SectionMoreFeatures } from '../components/sections/SectionMoreFeatures';
import {
  AgentHandoffAnimated,
  ChatIntegrationAnimated,
  GuideWorkAnimated,
} from '../components/sections/TasksAnimatedGraphics';
import { TasksAutopilot } from '../components/sections/TasksAutopilot';
import { TasksFeatureCards } from '../components/sections/TasksFeatureCards';
import { TasksFlexibility } from '../components/sections/TasksFlexibility';
import {
  ConnectGoogleButton,
  TasksHero,
} from '../components/sections/TasksHero';
import { TasksLifecycle } from '../components/sections/TasksLifecycle';

const HERO_DEMO_VIDEO_ID = 'tnsxkywzTvY';
/* The tasks walkthrough on YouTube. Also embedded in the macro-vs-linear post. */
const TASKS_VIDEO_ID = 'gxJquVXRX5A';
/* Desync's case study is a self-hosted mp4, not a YouTube embed. Same
   localhost/production split the other pages that use it apply. */
const isLocalhost =
  !isServer && ['localhost', '127.0.0.1'].includes(window.location.hostname);
const desyncVideoUrl = isLocalhost
  ? '/video/desync.mp4'
  : new URL('/video/desync.mp4', APP_BASE_URL).toString();
const mobile = () => viewportWidth() < 700;

const tasksFaq: FaqItem[] = [
  {
    q: 'How is Macro Tasks different from Linear?',
    a: (
      <>
        Macro Tasks keeps the keyboard-first flow of Linear, including status,
        priority, and assignee. Tasks also live alongside email, chat, and docs,
        and agents can take on work and close tasks.
      </>
    ),
  },
  {
    q: 'Does it integrate with GitHub?',
    a: (
      <>
        Yes. Link a task to a branch or pull request and its status follows the
        code. Opening a PR moves the task to In Review; merging it closes the
        task.
      </>
    ),
  },
  {
    q: 'Can I turn an email or message into a task?',
    a: (
      <>
        Yes. Turn an email or chat message into a task with one keystroke. The
        task stays linked to the original thread.
      </>
    ),
  },
  {
    q: 'What can the agents actually do?',
    a: (
      <>
        Assign a task to an agent as you would a teammate. It can do the work,
        open a pull request, and report back. Agents can also identify duplicate
        tasks.
      </>
    ),
  },
  {
    q: 'Can non-engineers follow the work?',
    a: (
      <>
        Yes. People outside engineering can follow tasks in the workspace they
        already use for email and chat.
      </>
    ),
  },
  {
    q: 'Is Macro open source?',
    a: (
      <>
        Yes. Macro is open source under the AGPLv3. The code is on{' '}
        <a
          href="https://github.com/macro-inc/macro"
          target="_blank"
          rel="noreferrer"
        >
          GitHub
        </a>
        .
      </>
    ),
  },
  dataSecurityFaqItem,
];

// ---------------------------------------------------------------------------
// Comparison table (Macro vs Linear vs Asana vs Jira vs ClickUp)
// ---------------------------------------------------------------------------

const comparisonColumns: ComparisonColumn[] = [
  { label: 'Macro' },
  { label: 'Linear', logo: LogoLinear },
  { label: 'Asana', logo: LogoAsana },
  { label: 'Jira', logo: LogoJira },
  { label: 'ClickUp', logo: LogoClickUp },
];

const comparisonRows: ComparisonRow[] = [
  {
    feature: 'Status, priority & assignee',
    cells: [true, true, true, true, true],
  },
  {
    feature: 'Create a task from an email',
    cells: [true, true, true, true, true],
  },
  {
    feature: 'Keyboard-first workflows',
    cells: [true, true, 'partial', 'partial', true],
  },
  {
    feature: 'Custom properties when you want them',
    cells: [true, 'partial', true, true, true],
  },
  {
    feature: 'Agents that can complete tasks',
    cells: [true, 'partial', true, 'partial', true],
  },
  {
    feature: 'GitHub: branch, PR & merge move the task',
    cells: [true, true, false, 'partial', 'partial'],
  },
  {
    feature: '@mention a task in docs & channels',
    cells: [true, 'partial', false, false, 'partial'],
  },
  {
    feature: 'Tasks in the same app as email & chat',
    cells: [true, false, false, false, true],
  },
  {
    feature: 'Open source (AGPLv3)',
    cells: [true, false, false, false, false],
  },
];

function ComparisonSection() {
  return (
    <section
      aria-label="How Macro Tasks compares"
      style={{
        'box-sizing': 'border-box',
        display: 'grid',
        gap: mobile() ? '14px' : '18px',
        'justify-items': 'center',
        'min-width': '0',
        'padding-block': mobile() ? '56px' : '80px',
        'padding-inline': mobile() ? '18px' : '24px',
        width: '100%',
      }}
    >
      <div
        style={{
          width: '100%',
          'max-width': '920px',
          'text-align': 'center',
          'margin-bottom': mobile() ? '10px' : '18px',
        }}
      >
        <h2 class="tasks-h3">How does Macro Tasks stack up?</h2>
      </div>
      <div style={{ width: '100%', 'max-width': '980px', 'min-width': '0' }}>
        <ComparisonTable columns={comparisonColumns} rows={comparisonRows} />
      </div>
      <ComparisonLegend />
      <SectionFaq items={tasksFaq} embedded maxWidth="980px" />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Split spotlight sections — chat integration + agent handoff. Layout and type
// mirror the email page's "Feature 1.x" FeatureSplit sections.
// ---------------------------------------------------------------------------

// Brightens a key word to the full text color inside otherwise-muted body copy.
function Hi(props: { children: JSX.Element }) {
  return <span style={{ color: 'var(--c1)' }}>{props.children}</span>;
}

/* Anchor eyebrow at the foot of a split section's copy column, pointing at the
   feature's own page. Mirrors FeatureEyebrowLink in SectionFeatureGrid.tsx —
   same accent, face, tracking, caps and trailing arrow — which is module-local
   there, so it is restated rather than imported.
   "Explore" is prefixed here rather than baked into each block's label, so the
   data stays the page's own name and the two cannot drift apart. */
function FeatureAnchorEyebrow(props: { label: string; href: string }) {
  return (
    <A
      href={props.href}
      class="hover-relaunch"
      style={{
        'align-items': 'center',
        // Grey at rest rather than accent. These two sit immediately above the
        // lifecycle stage, whose frame carries the page's only warm light, and
        // two orange links right over it competed with it. .hover-relaunch
        // still takes them to --a0 on hover, so the accent now marks the
        // affordance instead of being spent on the resting state.
        // Pitched just UNDER the body copy beside it (which is --c4), not at
        // it: uppercase, tracked and arrow-tailed, this treatment carries
        // enough weight of its own that matching the paragraph's lightness
        // still read as louder than it. At --c2 it was brighter than the
        // paragraph it belongs to, which is what made it pull.
        color: 'color-mix(in srgb, var(--c4) 78%, transparent)',
        display: 'inline-flex',
        'font-family': 'rajdhani, body',
        'font-size': mobile() ? '12px' : '14px',
        gap: '8px',
        'letter-spacing': '0.08em',
        'text-decoration': 'none',
        'text-transform': 'uppercase',
        width: 'max-content',
      }}
    >
      Explore {props.label}
      <span aria-hidden="true" style={{ 'font-size': '1.05em' }}>
        &rarr;
      </span>
    </A>
  );
}

type TasksFeatureBlock = {
  /** Foot-of-column anchor to the feature's own page. */
  anchor?: { label: string; href: string };
  label: string;
  /** Short slab title. */
  headline: JSX.Element;
  /** Supporting paragraph beneath the title, in muted body copy. */
  description: JSX.Element;
  heroShot: Component;
};

// Copy-left / graphic-right feature section, lifted from the email page. On
// desktop (>=1030px) the heading and body sit beside the graphic; at
// medium/narrow it gives way to a simple stacked column (copy above graphic).
function FeatureSplit(props: {
  block: TasksFeatureBlock;
  reverse?: boolean;
  align?: 'center' | 'start';
  glow?: 'sm';
}) {
  const stacked = () => breakpoint();
  return (
    <div
      style={{
        'padding-top': mobile() ? '52px' : '84px',
        'padding-bottom': mobile() ? '96px' : '148px',
        'padding-inline': mobile() ? '18px' : '24px',
      }}
    >
      <section
        aria-label={props.block.label}
        style={{
          'align-items': stacked() ? 'start' : (props.align ?? 'center'),
          'box-sizing': 'border-box',
          display: 'grid',
          // Narrower copy, pushed further from the graphic than the email
          // page's 1:1.2 at 56px. Within a 1112px content box these ratios give
          // a 410px text column against a 614px graphic — the text was 480px
          // before, so it loses 70px of measure and gains 32px of separation.
          // Note this takes the column under the paragraph's 460px max-width,
          // so on desktop the column governs the measure and that max-width
          // only binds once the layout stacks.
          gap: stacked() ? '48px' : '88px',
          'grid-template-columns': stacked()
            ? 'minmax(0, 1fr)'
            : props.reverse
              ? 'minmax(0, 1.5fr) minmax(0, 1fr)'
              : 'minmax(0, 1fr) minmax(0, 1.5fr)',
          margin: '0 auto',
          'max-width': 'var(--page-max)',
          width: '100%',
        }}
      >
        {/* Heading + body copy (right column when reversed; always first when
            stacked, so copy stays above the graphic on mobile) */}
        {/* Title over supporting paragraph, matching the email page's feature
            sections exactly — same faces, sizes, weights, tracking, leading,
            measure, and the same 14/18px gap between the two. Kept in step with
            RouteEmail's FeatureSplit deliberately: these read as the same kind
            of section across the two pages. */}
        {/* Flex column, not grid, and stretched to the row: that is what lets
            the anchor sit on the row's bottom edge via margin-top:auto, which
            lines it up with the foot of the graphic beside it. A grid column
            cannot do it — align-content:stretch would grow all three rows
            instead of pushing the last one down. Stretching is skipped when
            stacked, where there is no second column to align to. */}
        <div
          style={{
            'align-items': 'flex-start',
            'align-self': stacked() ? undefined : 'stretch',
            display: 'flex',
            'flex-direction': 'column',
            gap: mobile() ? '14px' : '18px',
            'grid-column': stacked() ? undefined : props.reverse ? '2' : '1',
          }}
        >
          <h2 class="tasks-h2" style={{ 'text-align': 'left' }}>
            {props.block.headline}
          </h2>
          <p
            class="tasks-lead"
            style={{
              // Narrower than the email page's 460px, and narrower than the
              // column it sits in, so this caps the description's measure
              // without shrinking the column further — the title shares that
              // column and already wraps tightly at this width.
              'max-width': '360px',
              'text-align': 'left',
              // Keeps a lone word off the last line. At this measure the copy
              // was breaking to "...leaving the / thread."
              'text-wrap': 'pretty',
            }}
          >
            {props.block.description}
          </p>
          <Show when={props.block.anchor}>
            {(a) => (
              <div
                style={{
                  'margin-top': 'auto',
                  'padding-top': mobile() ? '28px' : '36px',
                }}
              >
                <FeatureAnchorEyebrow label={a().label} href={a().href} />
              </div>
            )}
          </Show>
        </div>
        {/* The section graphic (left column when reversed). The faint task-list
            texture is the main treatment, copied from the email page, which has
            no glow of its own. An optional small one can sit under it: the
            previous version was a large wash that competed with the texture, so
            this is opt-in per section rather than standing. */}
        <div
          style={{
            'grid-column': stacked() ? undefined : props.reverse ? '1' : '2',
            'grid-row': stacked() ? undefined : '1',
            position: 'relative',
            width: '100%',
          }}
        >
          {/* Optional pool of light, centred behind the chat panel and reaching
              the open gap below it only with its tail.

              The chat panel occupies x 4-79%, y 0-72% of this cell, so 40%/40%
              is essentially its centre. Most of the glow therefore sits behind
              opaque artwork and is never seen directly; what reads is the
              spill around the panel's edges and into the uncovered wedge below
              it (x 4-35%, y 72-101%). The vertical radius is much larger than
              the horizontal so the falloff has room to travel down there
              without the core drifting off the panel.

              Dissolve is deliberately long — six stops rather than three, each
              step small — so there is no perceptible edge anywhere. Values are
              chosen from where they land rather than by eye: 5% at the core
              (hidden), ~2.2% at the wedge's upper edge (a lift of about five
              levels over the (9,9,9) background), and ~0.3% by its centre. It
              genuinely just peeks in.

              Box IS the glow's extent, as elsewhere on this page: left/top are
              centre-minus-radius, size is twice the radii, and the gradient is
              a plain 50% 50%, so the last stop lands on the box edge and there
              is nothing to clip. The box runs above this cell (top -18%), which
              is fine — nothing here clips overflow. */}
          <Show when={props.glow === 'sm'}>
            <div
              aria-hidden="true"
              style={{
                background:
                  'radial-gradient(50% 50% at 50% 50%,' +
                  ' color-mix(in srgb, var(--ambient-ink) 5%, transparent) 0%,' +
                  ' color-mix(in srgb, var(--ambient-ink) 4.6%, transparent) 22%,' +
                  ' color-mix(in srgb, var(--ambient-ink) 3.8%, transparent) 40%,' +
                  ' color-mix(in srgb, var(--ambient-ink) 2.8%, transparent) 56%,' +
                  ' color-mix(in srgb, var(--ambient-ink) 1.8%, transparent) 70%,' +
                  ' color-mix(in srgb, var(--ambient-ink) 0.9%, transparent) 84%,' +
                  ' transparent 100%)',
                height: '116%',
                left: '2%',
                'pointer-events': 'none',
                position: 'absolute',
                top: '-18%',
                width: '76%',
                'z-index': 0,
              }}
            />
          </Show>
          {/* Super-faint task list behind the graphic, the same trick the email
              page's feature sections use for their inbox backdrop: a dimmed
              copy of a product surface, feathered out radially so it reads as
              ambient context rather than a second graphic competing with the
              first. Source is the bottom section's task list with its open task
              card removed (scripts/splitSvgPanels.ts, children 0-91), so this
              shows the list only.

              Loaded as a URL and drawn in an <img> rather than inlined, which
              is what RouteEmail does. Inlining it in both sections would put
              two copies of the same ids in the document and duplicate ~27K of
              markup; as an <img> it is one cached file in its own document. The
              cost is that its 34 text nodes cannot see the page's Inter face
              and fall back — invisible at this opacity, where the list reads as
              texture rather than as type. */}
          <img
            src={taskListBgUrl}
            alt=""
            aria-hidden="true"
            draggable={false}
            style={{
              display: 'block',
              height: 'auto',
              inset: '-14% -20% auto',
              // The email page applies opacity 0.45 to its backdrop <img>, but
              // its source asset also carries opacity="0.45" on a top-level
              // group, so the effective value there is ~0.20. Our task list has
              // no baked dimming, so 0.2 is what actually matches — 0.45 would
              // have been more than twice as bright as the page being copied.
              opacity: 0.2,
              'pointer-events': 'none',
              position: 'absolute',
              'user-select': 'none',
              width: '140%',
              'z-index': 0,
              '-webkit-mask-image':
                'radial-gradient(48% 40% at 50% 34%, #000 60%, transparent 100%)',
              'mask-image':
                'radial-gradient(48% 40% at 50% 34%, #000 60%, transparent 100%)',
            }}
          />
          <div style={{ position: 'relative', 'z-index': 1 }}>
            <Dynamic component={props.block.heroShot} />
          </div>
        </div>
      </section>
    </div>
  );
}

const chatBlock: TasksFeatureBlock = {
  label: 'Macro Tasks',
  // PLACEHOLDER title — the previous one, pending a snappier replacement.
  headline: (
    <>
      Integrated
      <br />
      with chat.
    </>
  ),
  description: (
    <>
      Convert a message to a task, mention it inline, and preview it in the
      thread.
    </>
  ),
  heroShot: ChatIntegrationAnimated,
  anchor: { label: 'Macro Chat', href: '/channels' },
};

const agentsBlock: TasksFeatureBlock = {
  label: 'Macro Tasks',
  // PLACEHOLDER title — the previous one, pending a snappier replacement.
  headline: (
    <>
      Tag team
      <br />
      with agents.
    </>
  ),
  description: (
    <>
      Hand a task to @Macro in any thread and the agent opens PRs and updates
      the status.
    </>
  ),
  heroShot: AgentHandoffAnimated,
  anchor: { label: 'Macro Agents', href: '/agents' },
};

// ---------------------------------------------------------------------------
// Closing hero — the philosophy line over the full task list + management
// panel illustration.
// ---------------------------------------------------------------------------

function TasksGuideHero() {
  return (
    <section
      aria-label="Task management should guide the work"
      style={{
        'box-sizing': 'border-box',
        display: 'grid',
        gap: mobile() ? '40px' : '64px',
        'justify-items': 'center',
        margin: '0 auto',
        'max-width': '1160px',
        // The bottom glow below runs past this section; clipping the y axis
        // cuts it exactly on the rule that closes the section. The same pairing
        // the top hero uses, and for the same reason: a calc() mask fitted to
        // the section's height drifted, because the height is set by whichever
        // child happens to be tallest. overflow-x stays visible so nothing
        // squeezes the row horizontally -- only scroll/auto/hidden would coerce
        // it, clip does not.
        'overflow-x': 'visible',
        'overflow-y': 'clip',
        padding: mobile() ? '72px 18px 64px' : '112px 24px 96px',
        position: 'relative',
        width: '100%',
      }}
    >
      <div
        style={{
          display: 'grid',
          gap: mobile() ? '28px' : '36px',
          'justify-items': 'start',
          'justify-self': 'start',
        }}
      >
        <h2
          class="tasks-h2"
          style={{ 'text-align': 'left', 'text-wrap': 'balance' }}
        >
          <span style={{ display: 'block' }}>Tasks should guide the work,</span>
          <span style={{ display: 'block', 'margin-top': '0.16em' }}>
            not be the work.
          </span>
        </h2>
        <p
          class="tasks-lead"
          style={{ 'max-width': '48ch', 'text-align': 'left' }}
        >
          Macro Tasks work for <Hi>dynamic teams</Hi>,{' '}
          <Hi>highly technical workflows</Hi>, and <Hi>rapid iteration</Hi>.
        </p>
      </div>
      {/* Illustration: task list window + management panel over a hero glow */}
      <div
        style={{ 'max-width': '980px', position: 'relative', width: '100%' }}
      >
        {/* The glow was cut off flat along its top edge. It read
            `radial-gradient(58% 64% at 50% 44%)` on a box inset -12% -16%, and
            a vertical radius of 64% from a centre at 44% has to reach -20% —
            20% above the box it is painted in, which a background gradient
            cannot do. Same failure as the hero glow: the fix is for the layer
            to BE the glow's extent rather than a box the gradient overflows.

            Converted without moving the light: the old form's visible extent
            (radius x its 75% transparent stop) is radii of 57.4%/59.5% about a
            centre at 50%/42.6% of this container, so left/top are
            centre-minus-radius, size is twice the radii, and a plain 50% 50%
            gradient lands its last stop on the box edge.

            Halved in strength while there — a 13% peak lifted the (9,9,9)
            background by 29 levels, which is why it read as a shape rather than
            ambient light; 6% lifts it by 13. Six stops so it dissolves. */}
        {/* Bottom-emanating glow, the same construction as the top hero's:
            source just below the artwork so the light spills down and out
            around its lower edge, then gets cut at the section's closing rule.

            Box IS the extent, as everywhere else on this page. Centre is
            (50%, 102%) of this container and the radii are 80%/62%, so
            left/top = centre - radius (-30%, 40%) and width/height = 2x radius
            (160%, 124%), with a plain 50% 50% gradient landing its last stop on
            the box edge. Moving the source means moving left/top, not
            offsetting the gradient.

            Stops are weighted outward rather than decaying conventionally: the
            core sits behind the artwork, so the only band anyone sees is the
            outer half, and a normal ramp has already faded to nothing by then.
            Peak is 10% against the hero's 14% because this section also carries
            the ambient layer below, and the two stack. */}
        <div
          aria-hidden="true"
          style={{
            background:
              'radial-gradient(50% 50% at 50% 50%,' +
              ' color-mix(in srgb, var(--ambient-ink) 10%, transparent) 0%,' +
              ' color-mix(in srgb, var(--ambient-ink) 8.5%, transparent) 30%,' +
              ' color-mix(in srgb, var(--ambient-ink) 5.5%, transparent) 55%,' +
              ' color-mix(in srgb, var(--ambient-ink) 2.4%, transparent) 78%,' +
              ' transparent 100%)',
            height: '124%',
            left: '-30%',
            'pointer-events': 'none',
            position: 'absolute',
            top: '40%',
            width: '160%',
            'z-index': 0,
          }}
        />
        <div
          aria-hidden="true"
          style={{
            background:
              'radial-gradient(50% 50% at 50% 50%,' +
              ' color-mix(in srgb, var(--ambient-ink) 6%, transparent) 0%,' +
              ' color-mix(in srgb, var(--ambient-ink) 5.2%, transparent) 24%,' +
              ' color-mix(in srgb, var(--ambient-ink) 4%, transparent) 45%,' +
              ' color-mix(in srgb, var(--ambient-ink) 2.6%, transparent) 64%,' +
              ' color-mix(in srgb, var(--ambient-ink) 1.3%, transparent) 82%,' +
              ' transparent 100%)',
            height: '119%',
            left: '-7.4%',
            'pointer-events': 'none',
            position: 'absolute',
            top: '-17%',
            width: '114.8%',
            'z-index': 0,
          }}
        />
        <div style={{ position: 'relative', 'z-index': 1 }}>
          <GuideWorkAnimated />
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Case studies — the tasks walkthrough and Desync's story, side by side.
//
// Two different embed kinds deliberately: the walkthrough lives on YouTube
// (same id the macro-vs-linear post uses) and Desync's is a self-hosted mp4
// (public/video/desync.mp4, ~23MB). The mp4 is click-to-play behind its poster
// with preload="metadata", so none of that weight is fetched unless someone
// asks for it; the YouTube frame is lazy for the same reason.
// ---------------------------------------------------------------------------

function CaseStudyMedia(props: {
  children: JSX.Element;
  onClick?: () => void;
  interactive?: boolean;
}) {
  return (
    <div
      onClick={props.onClick}
      style={{
        'background-color': 'var(--b1)',
        border: '1px solid color-mix(in srgb, var(--c1) 12%, transparent)',
        'border-radius': mobile() ? '14px' : '18px',
        'box-shadow':
          '0 28px 64px -22px rgb(0 0 0 / 0.66), 0 8px 24px -12px rgb(0 0 0 / 0.5)',
        cursor: props.interactive ? 'pointer' : 'default',
        overflow: 'hidden',
        position: 'relative',
        width: '100%',
      }}
    >
      {props.children}
    </div>
  );
}

function TasksCaseStudies() {
  // Stack earlier than the page's 700px mobile break: two 16/9 frames side by
  // side get unreadably small before that.
  const stackedPair = () => viewportWidth() < 900;
  let desyncRef!: HTMLVideoElement;
  const [desyncPlaying, setDesyncPlaying] = createSignal(false);
  const [tasksVideoOpen, setTasksVideoOpen] = createSignal(false);

  function playDesync() {
    desyncRef
      .play()
      .then(() => setDesyncPlaying(true))
      .catch(() => setDesyncPlaying(false));
  }

  const caption = (title: string, line: string) => (
    <div style={{ display: 'grid', gap: '6px' }}>
      <h3
        style={{
          color: 'var(--c1)',
          'font-family': 'display',
          'font-size': mobile() ? '19px' : '21px',
          'font-weight': '315',
          'letter-spacing': '-0.01em',
          'line-height': 1.2,
          margin: 0,
        }}
      >
        {title}
      </h3>
      <p class="tasks-caption">{line}</p>
    </div>
  );

  return (
    <section
      aria-label="Case studies"
      style={{
        'box-sizing': 'border-box',
        display: 'grid',
        gap: mobile() ? '14px' : '18px',
        'justify-items': 'center',
        'padding-block': mobile() ? '56px' : '80px',
        'padding-inline': mobile() ? '18px' : '24px',
        position: 'relative',
        width: '100%',
        // Own stacking context, so the full-bleed wash below (z-index -1)
        // stays scoped to this section instead of escaping to the page's
        // stacking order and landing behind an unrelated sibling.
        'z-index': 0,
      }}
    >
      {/* A cool grey wash for this section only, sitting between the page's
          near-black (--b0, rgb 9/9/9) and #16191F — the panel/pill surface
          the task and team graphics on this page are drawn in. Full-bleed via
          the same left/margin-left escape HomeSectionRule uses, so the tint
          runs edge to edge between the two dividers rather than just behind
          the 1080px column.

          Lit from the top divider: a crisp hairline catches the edge like a
          lit bezel, and a soft radial bloom (wider than tall, centred on the
          seam) spills a few percent of the section's own height downward.
          Both are background-image layers stacked over the flat wash color,
          not stops inside one gradient, so they never have to fight the base
          color for coverage — background-color already paints the full box
          on its own. */}
      <div
        aria-hidden="true"
        style={{
          'background-color': 'var(--b0)',
          'background-image':
            'linear-gradient(to bottom, color-mix(in srgb, var(--c1) 16%, transparent) 0, transparent 1px), ' +
            'radial-gradient(70% 22% at 50% 0%, color-mix(in srgb, var(--ambient-ink) 7%, transparent) 0%, color-mix(in srgb, var(--ambient-ink) 1.6%, transparent) 60%, transparent 100%)',
          bottom: 0,
          left: '50%',
          'margin-left': '-50%',
          'pointer-events': 'none',
          position: 'absolute',
          top: 0,
          width: '100%',
          'z-index': -1,
        }}
      />
      {/* Same type treatment as the comparison section below, but ranged left
          over the cards rather than centred. max-width matches the card grid's
          1080px exactly — the section centres both boxes, so equal widths are
          what makes the heading share a left edge with the first card. A
          narrower box here would centre inside the wider one and sit inset. */}
      <div
        style={{
          'margin-bottom': mobile() ? '48px' : '80px',
          'max-width': '1080px',
          'text-align': 'left',
          width: '100%',
        }}
      >
        {/* Small grey label, not the branded HeroEyebrow (no mark, no
            accent color) — this section doesn't need the Macro Tasks tag
            again, just a category marker above the slab sentence. */}
        <span class="tasks-eyebrow">Case studies</span>
        {/* One slab sentence carries the section below the eyebrow. Same
            treatment the split sections used before they were replaced:
            Roboto Slab is declared 100-900, so 350 is a genuinely
            interpolated weight rather than a synthesised one, keeping the slab
            character at a sentence's length without a display weight's mass. */}
        <h2
          class="tasks-h3"
          style={{
            margin: mobile() ? '10px 0 0' : '12px 0 0',
            'max-width': '20em',
            'text-align': 'left',
            'text-wrap': 'pretty',
          }}
        >
          {/* Explicit space: JSX strips the whitespace either side of the
              break, so without it the text reads "teamsthat" to anything
              consuming textContent, even though it renders correctly. */}
          Hear directly from startup teams that use <br />
          Macro Tasks for their work.
        </h2>
      </div>

      <div
        style={{
          display: 'grid',
          gap: stackedPair() ? '40px' : '32px',
          'grid-template-columns': stackedPair()
            ? 'minmax(0, 1fr)'
            : 'repeat(2, minmax(0, 1fr))',
          'max-width': '1080px',
          width: '100%',
        }}
      >
        {/* --- the tasks walkthrough, on YouTube --- */}
        <div style={{ display: 'grid', gap: mobile() ? '16px' : '20px' }}>
          <CaseStudyMedia
            interactive={!tasksVideoOpen()}
            onClick={() => setTasksVideoOpen(true)}
          >
            <Show
              when={tasksVideoOpen()}
              fallback={
                /* Poster-first: YouTube's own thumbnail, so the player only
                   loads when someone chooses to watch. */
                <div
                  style={{
                    'aspect-ratio': '16 / 9',
                    position: 'relative',
                    width: '100%',
                  }}
                >
                  <img
                    src={`https://i.ytimg.com/vi/${TASKS_VIDEO_ID}/maxresdefault.jpg`}
                    alt="Tasks on Macro — video thumbnail"
                    loading="lazy"
                    style={{
                      display: 'block',
                      height: '100%',
                      'object-fit': 'cover',
                      width: '100%',
                    }}
                  />
                  <PlayBadge />
                </div>
              }
            >
              <iframe
                title="Tasks on Macro"
                src={`https://www.youtube.com/embed/${TASKS_VIDEO_ID}?autoplay=1&rel=0`}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowfullscreen
                loading="lazy"
                style={{
                  'aspect-ratio': '16 / 9',
                  border: '0',
                  display: 'block',
                  width: '100%',
                }}
              />
            </Show>
          </CaseStudyMedia>
          {caption(
            'Tasks, on Macro',
            'Why engineers prefer using Macro Tasks.'
          )}
        </div>

        {/* --- Desync, self-hosted --- */}
        <div style={{ display: 'grid', gap: mobile() ? '16px' : '20px' }}>
          <CaseStudyMedia
            interactive={!desyncPlaying()}
            onClick={() => {
              if (!desyncPlaying()) playDesync();
            }}
          >
            <video
              ref={desyncRef}
              controls={desyncPlaying()}
              onEnded={() => setDesyncPlaying(false)}
              onError={() => setDesyncPlaying(false)}
              playsinline
              poster={markDesyncPlaceholder}
              preload="metadata"
              src={desyncVideoUrl}
              style={{
                'aspect-ratio': '16 / 9',
                background: 'var(--b1)',
                display: 'block',
                'object-fit': desyncPlaying() ? 'contain' : 'cover',
                width: '100%',
              }}
            />
            <Show when={!desyncPlaying()}>
              {/* The poster attribute alone is not enough: once the browser has
                  a decodable frame it paints that instead, and this video opens
                  on a dark frame, so the card read as an empty black box. The
                  other pages that embed this video overlay the placeholder the
                  same way. */}
              <img
                src={markDesyncPlaceholder}
                alt=""
                aria-hidden="true"
                style={{
                  display: 'block',
                  height: '100%',
                  inset: '0',
                  'object-fit': 'cover',
                  position: 'absolute',
                  width: '100%',
                }}
              />
              <PlayBadge />
            </Show>
          </CaseStudyMedia>
          {caption(
            'The Desync study',
            "One startup's move to Macro Tasks, and how it changed their workflow."
          )}
        </div>
      </div>
    </section>
  );
}

/** Centred play affordance over a poster. */
function PlayBadge() {
  return (
    <div
      aria-hidden="true"
      style={{
        'align-items': 'center',
        background: 'color-mix(in srgb, var(--b0) 62%, transparent)',
        'backdrop-filter': 'blur(2px)',
        border: '1px solid color-mix(in srgb, var(--c1) 34%, transparent)',
        'border-radius': '999px',
        display: 'flex',
        height: mobile() ? '48px' : '56px',
        'justify-content': 'center',
        left: '50%',
        'pointer-events': 'none',
        position: 'absolute',
        top: '50%',
        transform: 'translate(-50%, -50%)',
        width: mobile() ? '48px' : '56px',
      }}
    >
      <span
        style={{
          'border-bottom': '7px solid transparent',
          'border-left': mobile()
            ? '12px solid var(--c1)'
            : '14px solid var(--c1)',
          'border-top': '7px solid transparent',
          display: 'block',
          'margin-left': '3px',
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Final CTA
// ---------------------------------------------------------------------------

function TasksFinalCta() {
  return (
    <section
      aria-label="Get started"
      style={{
        'align-items': mobile() ? 'start' : 'center',
        display: 'grid',
        gap: mobile() ? '24px' : '28px',
        'justify-items': mobile() ? 'start' : 'center',
        'text-align': mobile() ? 'left' : 'center',
      }}
    >
      <div
        style={{
          display: 'grid',
          gap: mobile() ? '14px' : '16px',
          'justify-items': mobile() ? 'start' : 'center',
          'max-width': '585px',
        }}
      >
        <h2 class="tasks-h2">
          Make tasks <br />
          work for you.
        </h2>
        <p class="tasks-lead">
          It takes 30 seconds to connect. Your tasks, email, channels, and
          agents — all in one shared workspace.
        </p>
      </div>
      <ConnectGoogleButton buttonName="tasks_final_connect_google" large />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export const RouteTasks: Component = () => {
  // Mirrors the page's own copy: the title echoes the h1 ("Tasks that keep up
  // with your team") while keeping the "task management" phrasing people search
  // for, and the description leads with the hero's differentiator rather than
  // the feature checklist it used to list. The description is reused verbatim as
  // SoftwareApplication.description in the prerendered JSON-LD, so it has to
  // read as a product description on its own — see scripts/prerender.ts.
  setPageSeo({
    title: 'Macro Tasks — Task management that keeps up with your team',
    description:
      "Tasks that self-update from conversations in your channels, so you don't need a separate task manager — linked to your pull requests and worked by agents.",
    path: '/tasks',
  });

  const [heroDemoOpen, setHeroDemoOpen] = createSignal(false);

  return (
    <div
      lang="en"
      style={{
        'background-color': 'var(--b0)',
        'box-sizing': 'border-box',
        display: 'grid',
        'grid-template-columns': 'minmax(0, 1fr)',
        gap: '0',
        'padding-bottom': mobile() ? '48px' : '64px',
        width: '100%',
      }}
    >
      <style>{`
        svg text {
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
        }
        @media (hover) {
          .tasks-cta-button:hover { transform: scale(1.02); }
        }
      `}</style>

      <TasksHero onWatchDemo={() => setHeroDemoOpen(true)} />

      <HomeSectionRule />

      <TasksFeatureCards />

      <HomeSectionRule />

      {/* Case studies — walkthrough + Desync. Sits directly under the bento:
          the bento makes the claims, so the two videos are the proof, before
          the page goes on to show the mechanics. */}
      <TasksCaseStudies />

      <HomeSectionRule />

      {/* Chat integration — copy left, graphic right */}
      <FeatureSplit block={chatBlock} align="start" glow="sm" />

      <HomeSectionRule />

      {/* Agent handoff — reversed: graphic left, copy right */}
      <FeatureSplit block={agentsBlock} reverse align="start" />

      <HomeSectionRule />

      {/* The lifecycle carousel — one continuous story of a single task. */}
      <TasksLifecycle />

      <HomeSectionRule />

      {/* How you drive a task — conversationally in a channel, or over MCP from
          a terminal. Sits after the lifecycle (what a task does) and before
          autopilot (who it is for). */}
      <TasksFlexibility />

      <HomeSectionRule />

      {/* One line over three team boards. */}
      <TasksAutopilot />

      <HomeSectionRule />

      {/* Guide-the-work hero — the page's closing beat before the comparison. */}
      <TasksGuideHero />

      <HomeSectionRule />

      {/* Comparison */}
      <ComparisonSection />

      <HomeSectionRule />

      {/* Final CTA */}
      <div
        style={{
          'padding-block': mobile() ? '52px' : '68px',
          'padding-inline': mobile() ? '18px' : '24px',
        }}
      >
        <TasksFinalCta />
      </div>

      {/* Divider + footer */}
      <div
        style={{
          'padding-bottom': mobile() ? '40px' : '48px',
          'padding-inline': mobile() ? '18px' : '24px',
        }}
      >
        <SectionMoreFeatures currentPath="/tasks" footerOnly />
      </div>

      <Show when={heroDemoOpen()}>
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Macro demo video"
          onClick={() => setHeroDemoOpen(false)}
          style={{
            'align-items': 'center',
            background: 'oklch(from var(--b0) l c h / 0.86)',
            display: 'grid',
            inset: '0',
            'justify-items': 'center',
            padding: mobile() ? '18px' : '42px',
            position: 'fixed',
            'z-index': 100,
          }}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            style={{
              background: 'var(--b0)',
              border:
                '1px solid color-mix(in srgb, var(--c4) 18%, transparent)',
              'border-radius': '12px',
              'box-shadow': '0 28px 90px rgb(0 0 0 / 0.5)',
              'box-sizing': 'border-box',
              display: 'grid',
              'max-width': '1040px',
              overflow: 'hidden',
              position: 'relative',
              width: 'min(100%, 1040px)',
            }}
          >
            <button
              type="button"
              aria-label="Close video"
              onClick={() => setHeroDemoOpen(false)}
              style={{
                background: 'var(--b1)',
                border:
                  '1px solid color-mix(in srgb, var(--c4) 22%, transparent)',
                'border-radius': '999px',
                color: 'var(--c1)',
                cursor: 'pointer',
                'font-family': 'body',
                'font-size': '18px',
                height: '34px',
                'line-height': 1,
                position: 'absolute',
                right: '12px',
                top: '12px',
                width: '34px',
                'z-index': 1,
              }}
            >
              X
            </button>
            <iframe
              title="Macro demo video"
              src={`https://www.youtube.com/embed/${HERO_DEMO_VIDEO_ID}?autoplay=1&rel=0`}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowfullscreen
              style={{
                'aspect-ratio': '16 / 9',
                background: 'var(--b1)',
                border: '0',
                display: 'block',
                height: 'auto',
                'max-height': 'calc(100vh - 96px)',
                width: '100%',
              }}
            />
          </div>
        </div>
      </Show>
    </div>
  );
};
