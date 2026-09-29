import {
  type Component,
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import docsHeroUrl from '../../assets/graphics/docs-hero.svg?url';
import DocsMentionCycle from '../../assets/graphics/docs-mention-cycle.svg';
import docsTimelineSvg from '../../assets/graphics/docs-timeline.svg?raw';
import LogoConfluence from '../../assets/icons/logo-confluence.svg';
import LogoGoogleDocs from '../../assets/icons/logo-google-docs.svg';
import LogoNotion from '../../assets/icons/logo-notion.svg';
import LogoObsidian from '../../assets/icons/logo-obsidian.svg';
import { DocsMarkdownGraphic } from '../components/featureGraphics/DocsMarkdownScene';
import {
  DocsAgentTeammateGraphic,
  HeroDocCollabWindow,
  HomeMobileDocsShot,
} from '../components/featureGraphics/DocumentsGraphics';
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
import {
  type FeatureLiteCard,
  featureLiteStyles,
  SectionFeatureLite,
} from '../components/sections/SectionFeatureLite';
import { SectionFinalCta } from '../components/sections/SectionFinalCta';
import { SectionMoreFeatures } from '../components/sections/SectionMoreFeatures';
import { breakpoint, viewportWidth } from '../utils/utilBreakpoint';
import { setPageSeo } from '../utils/utilSeo';

const mobile = () => viewportWidth() < 700;

// The h1, one entry per line. Single source for both the static heading and
// the typing animation, so the two can't drift apart.
const docsHeadlineLines = ['Collaborative', 'markdown docs.'];

// ---------------------------------------------------------------------------
// Sub-feature cards (blog-style)
// ---------------------------------------------------------------------------

/**
 * Card marks for the three sub-features: plain outlined geometry instead of
 * glyph icons.
 *
 * Each takes the same props as the SVG components imported elsewhere, so they
 * drop into FeatureLiteCard's `icon` slot unchanged, and each strokes in
 * currentColor so the card tile's own accent still drives the colour.
 *
 * Sized to nearly fill the 48-unit box, since the card renders them at 46px
 * inside a 176px tile — a shape inset the way a glyph is would read as small
 * and lost in that space.
 */
type ShapeProps = { class?: string; style?: JSX.CSSProperties };

const SHAPE_STROKE = 1.6;

/** Open source: a circle. */
function ShapeCircle(props: ShapeProps) {
  return (
    <svg
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
      class={props.class}
      style={props.style}
    >
      <circle
        cx="24"
        cy="24"
        r="21"
        stroke="currentColor"
        stroke-width={SHAPE_STROKE}
      />
    </svg>
  );
}

/** Mobile: a rounded rectangle, in portrait so it reads as a handset. */
function ShapeRoundedRect(props: ShapeProps) {
  return (
    <svg
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
      class={props.class}
      style={props.style}
    >
      <rect
        x="13"
        y="4"
        width="22"
        height="40"
        rx="6"
        stroke="currentColor"
        stroke-width={SHAPE_STROKE}
      />
    </svg>
  );
}

/**
 * Offline: a quarter slice pointing down.
 *
 * A 90-degree circular sector, so the two straight edges sit at 45 degrees
 * either side of vertical and converge on an apex at the bottom, with the arc
 * spanning the top. The sweep flag is 1 so the arc passes over the top rather
 * than cutting under.
 *
 * A quarter is wider than it is tall (42.4 x 30 at radius 30), so radius 30 is
 * what the WIDTH allows once the stroke needs clearance, not the height.
 *
 * Unlike the other two, the viewBox is cropped to the path's own bounds rather
 * than left at 0 0 48 48. A square box around a shape this wide leaves dead
 * space above and below and wastes width, so the sector rendered ~13% smaller
 * than it needed to. Cropped, it fills the full 46px the card gives it and sits
 * vertically centred by preserveAspectRatio, with no padding to shrink it.
 */
function ShapeSliceDown(props: ShapeProps) {
  return (
    <svg
      viewBox="2 8.2 44 31.6"
      fill="none"
      aria-hidden="true"
      class={props.class}
      style={props.style}
    >
      <path
        d="M24 39 L2.8 17.8 A30 30 0 0 1 45.2 17.8 Z"
        stroke="currentColor"
        stroke-width={SHAPE_STROKE}
        stroke-linejoin="round"
      />
    </svg>
  );
}

const docsCards: FeatureLiteCard[] = [
  {
    icon: ShapeCircle,
    title: 'Open source',
    desc: 'Macro fully open source on Github. Audit it, fork it, or extend it.',
  },
  {
    icon: ShapeRoundedRect,
    title: 'Built for mobile',
    desc: 'Blocks, properties, comments and live cursors all work on mobile.',
  },
  {
    icon: ShapeSliceDown,
    title: 'Stable offline',
    desc: 'CRDT-backed: keystrokes apply locally first, then replay in order on reconnect.',
  },
];

const docsFaq: FaqItem[] = [
  {
    q: 'How is Macro Docs different from Notion?',
    a: (
      <>
        Macro Docs uses Markdown and supports real-time, offline-capable
        editing. Documents link directly to related tasks, email, and channels.
      </>
    ),
  },
  {
    q: 'Are docs collaborative?',
    a: (
      <>
        Yes. It uses CRDT-based real-time editing, includes inline comment
        threads, and shows a live agent cursor while an agent works in the
        document.
      </>
    ),
  },
  {
    q: 'What are properties?',
    a: (
      <>
        Properties add structured fields such as status, assignee, dates, and
        links alongside the document.
      </>
    ),
  },
  {
    q: 'Can agents edit my docs?',
    a: (
      <>
        Yes. Agents can draft or revise documents, and you can see their cursor
        move through the document in real time.
      </>
    ),
  },
  {
    q: 'Is there version history?',
    a: (
      <>
        Yes. Every document keeps a full version history, and you can restore or
        fork a past version.
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
// "Power in simplicity" — the markdown-foundation argument, sitting between
// the hero and the sub-feature cards
// ---------------------------------------------------------------------------

function PowerInSimplicity() {
  return (
    <section
      aria-label="Built on markdown"
      style={{
        'box-sizing': 'border-box',
        margin: '0 auto',
        'max-width': '1160px',
        'padding-block': mobile() ? '52px' : '76px',
        'padding-inline': mobile() ? '18px' : '24px',
        width: '100%',
      }}
    >
      {/* Set as the tasks page's founder statement is: one centred column that
          the heading and the body both live inside, rather than two siblings
          each carrying their own measure. The column is what gets centred
          (max-width + auto side margins); everything within it is flush left,
          so the heading and the paragraphs share a left edge by construction
          and cannot drift apart. Matching a max-width on the h2 and on the body
          separately would look identical today and silently misalign the moment
          either one changed.

          Measured in ch rather than px, again following the statement: the
          column is sized by how many characters fit on a line, so it tracks the
          text it holds. */}
      <div
        style={{
          margin: '0 auto',
          'max-width': mobile() ? '100%' : '104ch',
          width: '100%',
        }}
      >
        <h2
          style={{
            color: 'var(--c1)',
            'font-family': 'display',
            // The statement's tier, not this page's section-title tier. Main's
            // three slab tiers are assigned by role: hero 360, full-width
            // section title 380, and the smaller section titles and the
            // single-sentence slab treatment 350. A statement set flush left in
            // its own column is the third of those, so it drops from 36/380 to
            // .tasks-h3's 30/350.
            'font-size': mobile() ? '23px' : '30px',
            'font-weight': '350',
            'letter-spacing': '-0.01em',
            'line-height': 1.35,
            // Wide gap under the heading: it reads as a title over a statement
            // rather than as a lede's first line.
            margin: mobile() ? '0 0 40px' : '0 0 56px',
            'text-align': 'left',
            'text-wrap': 'balance',
          }}
        >
          Power in simplicity.
        </h2>
        <div
          style={{
            display: 'grid',
            gap: mobile() ? '18px' : '22px',
          }}
        >
          <p
            style={{
              color: 'var(--c4)',
              // 'body' stays behind cyberreader everywhere on this page: with
              // font-display: swap a failed load would otherwise drop to the
              // generic default instead of to Rajdhani, which is the site's
              // voice.
              'font-family': 'cyberreader, body',
              'font-size': mobile() ? '16.5px' : '18px',
              'font-weight': '300',
              'line-height': 1.6,
              margin: '0',
              'text-align': 'left',
              'text-wrap': 'pretty',
            }}
          >
            At the end of the day, a Macro Doc is just a markdown file. As
            simple as you want it to be, with advanced features when you need
            them. Collaborate online, smart link to other Macro entities, loop
            in agents, edit offline, or export for another markdown editor.
            <br />
            <br />
            Nothing is trapped in a proprietary format.
            <br />
            <br />
            <Hi>A Macro Doc is just a markdown file.</Hi>
          </p>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Split spotlight sections — live collaboration + agent editing. Layout and
// type mirror the tasks and chat pages' FeatureSplit sections.
// ---------------------------------------------------------------------------

// Brightens a key word to the full text color inside otherwise-muted body copy.
function Hi(props: { children: JSX.Element }) {
  return <span style={{ color: 'var(--c1)' }}>{props.children}</span>;
}

type DocsFeatureBlock = {
  /** Skip the radial glow: the graphic is a transparent zoomed crop, not an
   * opaque panel, so the glow would show through it. */
  bareGraphic?: boolean;
  label: string;
  headline: JSX.Element;
  description?: JSX.Element;
  /**
   * A bulleted list, as the version-history section uses.
   *
   * The two render sites place it differently, so neither one gets to own the
   * description. DocsFeatureCopy puts it in the subtitle's place, and there a
   * block passes description or footer but never both -- see the note at that
   * render site for what a third grid child does. FeatureSplit stacks it BELOW
   * the description instead, which is the shape this field was lifted from on
   * the tasks and chat pages and the one the email page's compose section uses.
   * Only DocsFeatureCopy carries the .docs-note-list rule, so a footer taken
   * through FeatureSplit would need styles of its own.
   */
  footer?: JSX.Element;
  /** Omitted by blocks rendered outside FeatureSplit. */
  heroShot?: Component;
};

// Copy-left / graphic-right feature section, lifted from the tasks page. On
// desktop (>=1030px) the heading and body sit beside the graphic; at
// medium/narrow it gives way to a simple stacked column (copy above graphic).
function _FeatureSplit(props: {
  block: DocsFeatureBlock;
  reverse?: boolean;
  align?: 'center' | 'start';
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
          gap: stacked() ? '52px' : '88px',
          'grid-template-columns': stacked()
            ? 'minmax(0, 1fr)'
            : props.reverse
              ? 'minmax(0, 1.2fr) minmax(0, 1fr)'
              : 'minmax(0, 1fr) minmax(0, 1.2fr)',
          margin: '0 auto',
          'max-width': 'var(--page-max)',
          width: '100%',
        }}
      >
        {/* Heading + body copy (right column when reversed; always first when
            stacked, so copy stays above the graphic on mobile). The gap is
            deliberately loose: these sections carry two short blocks of type,
            so the air between them is doing the work the old bullet lists
            used to. */}
        <div
          style={{
            display: 'grid',
            gap: mobile() ? '20px' : '30px',
            'grid-column': stacked() ? undefined : props.reverse ? '2' : '1',
            'justify-items': 'start',
          }}
        >
          <h2
            style={{
              'font-family': 'display',
              'font-size': mobile() ? '32px' : '42px',
              'font-weight': '400',
              'letter-spacing': '-0.018em',
              'line-height': 1.1,
              margin: '0',
              'text-align': 'left',
            }}
          >
            {props.block.headline}
          </h2>
          <Show when={props.block.description}>
            <p
              style={{
                color: 'var(--c4)',
                // rajdhani, as on the email and tasks feature sections — this
                // page was the only one setting these descriptions in body.
                'font-family': 'rajdhani, body',
                'font-size': mobile() ? '18px' : '21px',
                'font-weight': '400',
                'line-height': 1.6,
                margin: '0',
                'max-width': '430px',
                'text-align': 'left',
              }}
            >
              {props.block.description}
            </p>
          </Show>
          {props.block.footer}
        </div>
        {/* The section graphic (left column when reversed), lifted off the page
            by a subtle radial glow behind it.
            The glow assumes an opaque graphic sitting on top of it. A zoomed
            detail crop is transparent, so the glow would read as a stray light
            blob behind the text instead of a lift — those blocks opt out. */}
        <div
          style={{
            'grid-column': stacked() ? undefined : props.reverse ? '1' : '2',
            'grid-row': stacked() ? undefined : '1',
            position: 'relative',
            width: '100%',
          }}
        >
          <Show when={!props.block.bareGraphic}>
            <div
              aria-hidden="true"
              style={{
                background:
                  'radial-gradient(54% 60% at 50% 48%, color-mix(in srgb, var(--ambient-ink) 12%, transparent) 0%, color-mix(in srgb, var(--ambient-ink) 7%, transparent) 46%, transparent 74%)',
                inset: '-8% -12%',
                'pointer-events': 'none',
                position: 'absolute',
                'z-index': 0,
              }}
            />
          </Show>
          <Show when={props.block.heroShot}>
            {(shot) => (
              <div style={{ position: 'relative', 'z-index': 1 }}>
                <Dynamic component={shot()} />
              </div>
            )}
          </Show>
        </div>
      </section>
    </div>
  );
}

const versionHistoryBlock: DocsFeatureBlock = {
  label: 'Macro Docs',
  headline: <>Rewrite history.</>,
  // Three claims, one per row, stacked under the headline: the headline is one
  // line here, so the column beside it was carrying a three-line paragraph
  // whose first clause only set up the other two.
  //
  // The marks are set in CSS rather than passed per row, so a row is the claim
  // and nothing else. See .docs-note-list li::before.
  footer: (
    <ul class="docs-note-list">
      <li>
        <Hi>Restore</Hi> any timestamp.
      </li>
      <li>See who did what.</li>
      <li>
        <Hi>Fork</Hi> it into a new doc.
      </li>
    </ul>
  ),
};

// The markdown claim, demonstrated. PowerInSimplicity has just said "A Macro
// Doc is just a markdown file" three times over, in a column of pure type
// with no artwork -- it is the only claim on this page with nothing to look
// at. This band is that sentence happening: the syntax lands, the blocks form
// under it, and the @ that DocsIntegrationHero names two beats later is shown
// once here without being explained, so that section reads as the escalation
// it is written as rather than as the first mention of the idea.
const markdownBlock: DocsFeatureBlock = {
  label: 'Macro Docs',
  headline: (
    <>
      Mention and link
      <br />
      as you type.
    </>
  ),
  description: (
    <>
      Mention a person, a task, a date, an email, a channel, or another
      document. <br />
      Insert snippets of other documents with ';'
    </>
  ),
};

const agentTeammateBlock: DocsFeatureBlock = {
  label: 'Macro Docs',
  headline: (
    <>
      Agents edit
      <br />
      like teammates.
    </>
  ),
  description: (
    <>
      As many agents as you want can join you in the doc simultaneously. They
      don't lock your document, you see their actions in realtime.
    </>
  ),
  heroShot: DocsAgentTeammateGraphic,
  bareGraphic: true,
};

// ---------------------------------------------------------------------------
// Live editor — the real Macro editor, embedded and typeable
// ---------------------------------------------------------------------------

// The same window the home page runs, on its own full-width beat. On phones the
// window's fixed editor measure runs past the viewport and clips on the right,
// so swap in the static mobile shot exactly as the home page does.
// ---------------------------------------------------------------------------
// Artwork bands — a wide graphic run past both edges of the viewport
//
// The version-history timeline is drawn 1211 units wide: far wider than a
// feature column, and the point of it is its width. So it runs wider than the
// page and fades out at both sides instead of being cropped or shrunk to fit,
// with the fade fully opaque at exactly one place — the thing the section is
// about. It is the only band left on this page; the machinery below is still
// written for any artwork width, which is what the 800-wide mentions band that
// used to sit above it needed.
// ---------------------------------------------------------------------------

/** The timeline artwork's own width, and the reference the band's proportions are expressed in. */
const BAND_ARTWORK_W = 1211;

/** Where a band's focal point lands across the viewport. */
const BAND_PEAK = 62;

/**
 * Band width for the reference artwork: wider than the page on purpose.
 *
 * 165, up from the 132 this carried while there were two bands to keep at one
 * scale. The timeline is the only band left, and it is a wide, quiet graphic
 * whose whole subject is a range of time; at 132 it sat as an illustration
 * under the copy, and at 165 it reads as the thing the section is about. The
 * cost is 65% of the viewport spent past its edges instead of 32%, which the
 * side fade absorbs -- it is already the mechanism for a band that runs off
 * both sides.
 */
const BAND_REF_WIDTH = 165;

/**
 * Band width as a percentage of the viewport, scaled so every band renders at
 * the same pixels per artwork unit.
 *
 * Without the artworkW term, an artwork drawn in a narrower coordinate space
 * would render proportionally larger at the same width percentage: 800 units
 * across a 132% band is 1.84 device pixels per unit against the reference's
 * 1.22, so its type comes out half again too big. Scaling the percentage by
 * the artwork's own width holds the scale instead, which means a narrower
 * artwork takes less than the full viewport and shows its own side edges.
 *
 * The phone width is a per-band absolute, because it is not the same problem.
 * Desktop is about scale; a phone is about legibility, where a document's
 * 12-unit body text at the reference scale lands at 6px and reads as noise, so
 * artwork made of type is scaled up and cropped harder instead.
 */
const bandWidth = (artworkW: number, mobileWidth: number) =>
  mobile() ? mobileWidth : (BAND_REF_WIDTH * artworkW) / BAND_ARTWORK_W;

/**
 * How tall every band is, in its own artwork's units.
 *
 * One number serves every band because bandWidth holds the scale: 236 units of
 * an 800-wide artwork and 236 of a 1211-wide one come out at the same 287px.
 * That figure is what the timeline occupies once its blank top is trimmed, so
 * this pins the height the page already had rather than picking a new one.
 * Each band then chooses WHICH 236 units to show, via topTrim. Only the
 * timeline is left to choose, but the width-independence is what makes the
 * number mean anything, so it is stated rather than folded away.
 */
const BAND_UNITS = 236;

/**
 * Left offset that puts `focus` (the artwork's focal point, as a fraction of
 * its own width) at BAND_PEAK.
 *
 * The band is deliberately NOT centred. Centring it would park the focal point
 * wherever the width happened to put it (81% of the viewport at the mobile
 * width, hard against the faded right edge); solving for the offset instead
 * keeps it at the same place on every breakpoint.
 */
const bandOffset = (focus: number, width: number) => BAND_PEAK - focus * width;

/**
 * Dead space above an artwork's topmost ink, in its own units, trimmed so the
 * band sits close to the copy.
 *
 * Converted to a percentage of the wrapper's WIDTH, because that is what
 * percentage margins resolve against; scaling by the band width keeps a fixed
 * unit trim correct at every breakpoint, since the artwork scales with it.
 */
const bandTopTrim = (units: number, width: number, artworkW: number) =>
  -(units / artworkW) * width;

/**
 * Horizontal fade, applied to the viewport-width wrapper rather than to the
 * artwork.
 *
 * Masking the artwork itself put the transparent ends off-screen, since the
 * band overflows the viewport — so the visible edges were still around 40%
 * opaque and read as a crop. On the wrapper, 0% and 100% are the viewport
 * edges, so it genuinely reaches nothing exactly where the band leaves view.
 *
 * A long, uneven ramp: fully opaque only in a narrow band at the focal point,
 * then falling away across the whole remaining width. The left ramp is
 * stretched further than the right because there is more distance to cover on
 * that side.
 */
/**
 * The ramp, as fractions of the distance from the band's edge to its peak and
 * from the peak to the far edge.
 *
 * Relative rather than absolute percentages because the peak moves: a band
 * that bleeds places it at BAND_PEAK, a band that fits puts it wherever its
 * artwork's focal point lands. Absolute stops hand-placed around one peak go
 * lopsided as soon as the other band uses a different one.
 */
const BAND_RAMP_IN = [
  [0, 0],
  [0.16, 0.04],
  [0.35, 0.13],
  [0.55, 0.3],
  [0.73, 0.55],
  [0.87, 0.82],
] as const;
const BAND_RAMP_OUT = [
  [0.24, 0.86],
  [0.5, 0.55],
  [0.74, 0.25],
  [0.89, 0.07],
  [1, 0],
] as const;

/**
 * Horizontal fade, applied to the viewport-width wrapper rather than to the
 * artwork.
 *
 * Masking the artwork itself put the transparent ends off-screen back when
 * every band overflowed the viewport — so the visible edges were still around
 * 40% opaque and read as a crop. On the wrapper, 0% and 100% are the viewport
 * edges, so it reaches nothing exactly where the band leaves view.
 *
 * `strength` scales how far the ramp is allowed to fall: 1 takes the edges to
 * nothing, and lower values lift the whole curve toward opaque, which is what
 * a band whose artwork FITS wants. There the fade is thinning the drawing's own
 * side edges rather than dissolving a crop, and taking those to zero throws
 * away content the viewer can see the boundary of.
 */
const bandFade = (peak: number, strength = 1) => {
  const alpha = (v: number) => +(1 - strength * (1 - v)).toFixed(3);
  const stops = [
    ...BAND_RAMP_IN.map(
      ([t, v]) => `rgb(0 0 0 / ${alpha(v)}) ${+(t * peak).toFixed(1)}%`
    ),
    `rgb(0 0 0 / 1) ${+peak.toFixed(1)}%`,
    ...BAND_RAMP_OUT.map(
      ([t, v]) =>
        `rgb(0 0 0 / ${alpha(v)}) ${+(peak + t * (100 - peak)).toFixed(1)}%`
    ),
  ];
  return `linear-gradient(to right, ${stops.join(', ')})`;
};

/**
 * Vertical fade for the region a band bleeds above its laid-out box.
 *
 * `bleed` is that region as a percentage of the band's height. Below it the
 * mask stays fully opaque, so this only ever softens the top: the bottom edge
 * of both artworks lands in blank page, where there is nothing to clip.
 */
function bandTopFade(bleed: number) {
  const ramp = [
    [0, 0],
    [0.3, 0.02],
    [0.5, 0.08],
    [0.68, 0.22],
    [0.82, 0.45],
    [0.92, 0.72],
  ] as const;
  const stops = ramp.map(
    ([t, a]) => `rgb(0 0 0 / ${a}) ${+(t * bleed).toFixed(1)}%`
  );
  return `linear-gradient(to bottom, ${stops.join(', ')}, rgb(0 0 0 / 1) ${bleed}%, rgb(0 0 0 / 1) 100%)`;
}

/**
 * The band itself: inlined artwork, offset onto its focal point, under the
 * fade.
 *
 * Inlined rather than an <img> because both graphics set live text in Inter,
 * and an <img> SVG is an isolated document that cannot see this page's
 * @font-face.
 */
function ArtworkBand(props: {
  svg: string;
  focus: number;
  /** Artwork unit that sits at the top of the laid-out box. */
  topTrim: number;
  /**
   * Artwork units shown ABOVE that box, dissolving upward.
   *
   * The laid-out height stays BAND_UNITS either way, so the bleed costs no
   * layout and the sections keep their matching heights; it is pure overlap
   * into the copy above, and the top fade means what overlaps is a ghost.
   */
  bleedTop?: number;
  /** The artwork's own coordinate width. Defaults to the timeline's 1211. */
  artworkW?: number;
  /**
   * How far the side fade is allowed to fall, 0 to 1. Defaults to 1.
   */
  fadeStrength?: number;
  /**
   * Opacity for the artwork as a whole, on top of the fade.
   *
   * A separate lever from fadeStrength, which lifts the ramp's tails toward
   * opaque and cannot touch its peak. This caps the peak instead, which is
   * what pulling a whole graphic back from the eye needs.
   */
  opacity?: number;
  /**
   * Underline thickness for the artwork's links, in its own units.
   *
   * Figma exports link underlines as text-decoration and leaves the weight to
   * the browser, which draws Inter's own underline metric. On a document set at
   * 10 units that lands heavier than the artwork's own hairlines, so the links
   * read as ruled rather than linked. Set in CSS rather than patched into the
   * asset, so re-sourcing the graphic cannot drop it.
   */
  underline?: number;
  /**
   * Artwork unit at which the fade reaches full opacity.
   *
   * Separate from topTrim because the two answer different questions: topTrim
   * is where the band's laid-out box starts, and this is how far down the
   * artwork has to travel before it is fully present. Defaults to topTrim, so
   * a band that does not set it fades exactly across its bleed.
   */
  fadeTo?: number;
  mobileWidth?: number;
  /**
   * Handed the element the artwork is injected into.
   *
   * The only way to reach inside an innerHTML'd asset, which is what a band
   * that animates part of its own artwork needs. Scoped to this element rather
   * than left to a document query, so two copies of the same asset could never
   * drive each other.
   */
  artworkRef?: (el: HTMLDivElement) => void;
  /**
   * Space between the copy above and the band's laid-out top. Defaults to the
   * 40/68px every band used to take.
   *
   * A section passes a NEGATIVE value to run the band up into its own copy.
   * That is not the same lever as bleedTop, and the two are not
   * interchangeable: bleedTop reaches further up the ARTWORK, which only
   * shows more of it, and the timeline's top is blank by construction --
   * TIMELINE_TOP_TRIM exists precisely because there are 58 units of nothing
   * above its first ink. Pulling the whole band up is what actually moves ink
   * into the copy's space.
   */
  topGap?: string;
  label?: string;
}) {
  const artworkW = () => props.artworkW ?? BAND_ARTWORK_W;
  const width = () => bandWidth(artworkW(), props.mobileWidth ?? 200);
  const bleed = () => props.bleedTop ?? 0;
  const units = () => BAND_UNITS + bleed();
  // An artwork narrow enough to fit the viewport is centred, and the fade
  // follows its focal point to wherever that lands. Only a band that runs past
  // the edges has the freedom to place the focal point itself, and offsetting a
  // fitting artwork to hit BAND_PEAK would just shove it against one edge.
  const fits = () => width() <= 100;
  const inset = () => (100 - width()) / 2;
  const peak = () => (fits() ? inset() + props.focus * width() : BAND_PEAK);
  const offset = () => (fits() ? inset() : bandOffset(props.focus, width()));
  // Height as a ratio rather than a length: the artwork is sized as a
  // percentage of this wrapper, so the only thing either of them knows at
  // layout time is the wrapper's width. aspect-ratio turns that width into the
  // height those artwork units occupy at this band width, and overflow:hidden
  // crops whatever runs past them (by which point the fade has reached zero).
  const ratio = () => 1 / ((width() / 100) * (units() / artworkW()));
  // Percentage margins resolve against the containing block's WIDTH, which is
  // this wrapper's own width — the same basis the artwork is sized in. So the
  // bleed cancels out of the layout in exactly the units it was added in.
  const pull = () => `${-bandTopTrim(bleed(), width(), artworkW())}%`;
  // Measured from the top of what is visible (topTrim - bleed) down to fadeTo,
  // so moving the fade's landing point does not move the artwork or the band.
  const fadeSpan = () =>
    (props.fadeTo ?? props.topTrim) - props.topTrim + bleed();
  const fade = () =>
    fadeSpan() > 0
      ? `${bandFade(peak(), props.fadeStrength)}, ${bandTopFade((fadeSpan() / units()) * 100)}`
      : bandFade(peak(), props.fadeStrength);
  return (
    <>
      <style>{`
        .docs-artwork-band svg { display: block; height: auto; width: 100%; }
        .docs-artwork-band-thin-rule text { text-decoration-thickness: var(--band-underline); }
      `}</style>

      {/* The band runs past both edges of the viewport; the fade is what makes
          that read as continuing rather than cut. The mask is on this wrapper,
          not the artwork, so its endpoints are the viewport edges.
          overflow:hidden stops the overflow widening the page into a horizontal
          scrollbar. */}
      <div
        style={{
          // Two mask layers intersected: the alphas multiply, so the
          // horizontal fade keeps its shape at every height and the top fade
          // keeps its shape across the whole width.
          '-webkit-mask-composite': 'source-in',
          '-webkit-mask-image': fade(),
          '-webkit-mask-repeat': 'no-repeat',
          'aspect-ratio': ratio(),
          'margin-top': `calc(${props.topGap ?? (mobile() ? '40px' : '68px')} - ${pull()})`,
          'mask-composite': 'intersect',
          'mask-image': fade(),
          'mask-repeat': 'no-repeat',
          overflow: 'hidden',
          width: '100%',
        }}
      >
        <div
          aria-hidden={props.label ? undefined : 'true'}
          aria-label={props.label}
          class={`docs-artwork-band${props.underline ? ' docs-artwork-band-thin-rule' : ''}`}
          innerHTML={props.svg}
          ref={(el) => props.artworkRef?.(el)}
          role={props.label ? 'img' : undefined}
          style={{
            '--band-underline': props.underline
              ? `${props.underline}px`
              : undefined,
            opacity: props.opacity,
            'margin-left': `${offset()}%`,
            // Negative: clipped by the wrapper's overflow, which is why the
            // trim can only ever eat the artwork's blank top.
            'margin-top': `${bandTopTrim(props.topTrim - bleed(), width(), artworkW())}%`,
            width: `${width()}%`,
          }}
        />
      </div>
    </>
  );
}

/**
 * Where the timeline's blue scrubber comes to rest in its artwork: x=793 of
 * 1211. The fade's peak and the band's offset both derive from it, so they
 * cannot drift apart the way two hand-tuned numbers would.
 *
 * The scrubber now sweeps up to this point rather than sitting on it (see
 * TIMELINE_TRAVEL), and the fade does NOT travel with it -- which is what
 * bounds how far back the sweep is allowed to start.
 */
const TIMELINE_SCRUBBER = 793 / BAND_ARTWORK_W;

/**
 * Empty space above the timeline's topmost ink (the scrubber's label).
 *
 * Measured: the label starts 62 units down, so nearly all of that is dead
 * space. Trimming most of it — rather than only closing the margin — is the
 * only way to actually shorten the gap, which was 145px to the first ink with
 * 83px of it inside the artwork.
 */
const TIMELINE_TOP_TRIM = 58;

/**
 * The scrubber's sweep.
 * ---------------------------------------------------------------------------
 * One clock, one number. `elapsed` is the only state; the scrubber's offset,
 * its opacity and its timestamp are all pure functions of it, so the label
 * cannot drift out of step with the thing it is labelling the way two
 * independent animations would. That is also why this is not a CSS keyframe
 * animation: CSS can move the scrubber, but it cannot write the time, and a
 * keyframe timeline plus a JS clock reading it is two clocks.
 *
 * It runs only while the band is on screen, and not at all under reduced
 * motion. In both of those cases the artwork is left exactly as it ships:
 * parked at x=793, labelled Aug 30, 2:11 PM.
 */

/** Artwork units between the timeline's dashed day gridlines. */
const TIMELINE_DAY_UNITS = 81.4545;

/**
 * Seconds of document history per artwork unit, which is the whole mapping
 * between where the scrubber is and what it reads: 1060.7s, so a single unit
 * of travel is nearly eighteen minutes.
 */
const TIMELINE_S_PER_UNIT = 86400 / TIMELINE_DAY_UNITS;

/** Seconds past midnight at rest: the label the artwork ships with, 2:11 PM. */
const TIMELINE_REST_S = 14 * 3600 + 11 * 60;

/**
 * How far LEFT of its resting position the scrubber starts, in artwork units.
 *
 * Bounded by the band's own fade, not by taste. That fade peaks at a FIXED
 * x=793 (TIMELINE_SCRUBBER) and does not travel, and its ramp puts the
 * artwork at 82% opacity around x=734 and at 100% at the peak. 38 units back
 * from the peak sits the scrubber itself at roughly 87%, which is as far as it
 * can go and still read as fully present. The label's leading edge does reach
 * into the 74% region for the first frames of the sweep, which is the fastest
 * part of it and reads as the scrubber coming out of the fade.
 *
 * At TIMELINE_S_PER_UNIT that is 11h 12m of history, so the sweep starts at
 * 2:59 AM and lands on 2:11 PM.
 */
const TIMELINE_TRAVEL = 38;

const TIMELINE_FADE_MS = 420;
const TIMELINE_SWEEP_MS = 2400;
const TIMELINE_HOLD_MS = 3000;
const TIMELINE_CYCLE_MS =
  TIMELINE_FADE_MS * 2 + TIMELINE_SWEEP_MS + TIMELINE_HOLD_MS;

/**
 * Quintic rather than the usual cubic, because the readout is what is being
 * eased, not the line.
 *
 * The seconds move at 40,000 of them across the sweep, so they are a blur for
 * most of it -- which is the point, and what scrubbing a real timeline looks
 * like. Whether it resolves into a legible time at the end is entirely the
 * curve's tail: at nine tenths through, a cubic is still turning over 550
 * seconds per second and a quint about nine. Only the second of those settles.
 */
const timelineEase = (t: number) => 1 - (1 - t) ** 5;

const pad2 = (n: number) => (n < 10 ? `0${n}` : `${n}`);

/**
 * The clock half of the scrubber's label, at a given offset from rest.
 *
 * Only the clock: the whole sweep is 11 hours inside one day, so the date is
 * fixed text in the artwork and nothing here can move it. They are two <text>
 * elements at two fixed x's rather than one string, because a centred string
 * that changes width drags the date around with the seconds.
 *
 * Fixed width, three ways, because everything about the shape of this string
 * has to stay still while its digits race:
 *
 *   - Tabular figures, set on the element in the SVG. Inter's proportional
 *     digits are not one width -- measured at 8 units, "1" is 3.254 against
 *     "0" at 5.047 -- so a timestamp could breathe by 7 units as it counted.
 *     Tabular puts every digit at 5.189.
 *   - A padded hour, so 9 -> 10 does not add a character. This is the one
 *     label on the artwork that is padded, and it is the only one that moves.
 *   - Anchored at its START, not centred. AM and PM are still not the same
 *     width (50.314 against 49.899), and left-anchored that difference lands
 *     on the trailing edge instead of shifting every digit by half of it.
 *
 * Written out by hand rather than through Date, which would render this in the
 * viewer's timezone and quietly move a label the artwork's gridlines fix.
 */
function timelineStamp(offset: number) {
  const total = Math.round(TIMELINE_REST_S + offset * TIMELINE_S_PER_UNIT);
  const hour = Math.floor(total / 3600);
  return `${pad2(hour % 12 || 12)}:${pad2(Math.floor(total / 60) % 60)}:${pad2(total % 60)} ${hour < 12 ? 'AM' : 'PM'}`;
}

/** Where the scrubber is, and how present it is, at a point in the cycle. */
function timelineFrame(elapsed: number) {
  const sweepEnd = TIMELINE_FADE_MS + TIMELINE_SWEEP_MS;
  const holdEnd = sweepEnd + TIMELINE_HOLD_MS;
  const t = Math.min(
    1,
    Math.max(0, (elapsed - TIMELINE_FADE_MS) / TIMELINE_SWEEP_MS)
  );
  return {
    // Negative: the sweep runs from TIMELINE_TRAVEL units back up to 0, so it
    // decelerates INTO the fade's peak rather than away from it.
    offset: TIMELINE_TRAVEL * (timelineEase(t) - 1),
    // Faded in before it moves and out after it lands, so the jump back to the
    // start of the next sweep happens while there is nothing to see.
    opacity:
      elapsed < TIMELINE_FADE_MS
        ? elapsed / TIMELINE_FADE_MS
        : elapsed < holdEnd
          ? 1
          : 1 - (elapsed - holdEnd) / TIMELINE_FADE_MS,
  };
}

export function TimelineArtworkBand(props: {
  topGap: string;
  /** A normalized history position, when a caller supplies a scrubber. */
  position?: number;
  versionLabel?: string;
}) {
  const [elapsed, setElapsed] = createSignal(0);
  // Nothing is written to the artwork until the sweep is actually running, so
  // the asset renders exactly as it ships -- parked, labelled to the minute --
  // for anyone who never scrolls to it and for anyone on reduced motion. Set
  // the frame at mount instead and the scrubber would be faded out and rewound
  // to 2:59 AM before the band had ever been on screen.
  const [running, setRunning] = createSignal(false);
  const frame = () =>
    props.position === undefined
      ? timelineFrame(elapsed())
      : { offset: (props.position - 1) * TIMELINE_TRAVEL, opacity: 1 };
  // Memoised on the string, so the label is written only on the frames where
  // it actually reads differently. Once the ease has settled that is a handful
  // of frames rather than sixty a second.
  const stamp = createMemo(
    () => props.versionLabel ?? timelineStamp(frame().offset)
  );

  let root!: HTMLDivElement;
  let scrub: SVGGElement | null = null;
  let label: Element | null = null;

  onMount(() => {
    scrub = root.querySelector<SVGGElement>('.docs-timeline-scrub');
    label = root.querySelector('.docs-timeline-stamp tspan');
    if (!scrub || !label) return;
    if (props.position !== undefined) {
      setRunning(true);
      return;
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let id = 0;
    let origin = -1;
    const tick = (now: number) => {
      if (origin < 0) origin = now;
      setElapsed((now - origin) % TIMELINE_CYCLE_MS);
      id = requestAnimationFrame(tick);
    };
    // Off screen it does not run at all, and every arrival restarts it from
    // the top -- so the sweep plays for whoever scrolls to it rather than
    // being caught halfway through a cycle that began minutes ago.
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting === Boolean(id)) return;
        if (entry.isIntersecting) {
          origin = -1;
          setRunning(true);
          id = requestAnimationFrame(tick);
        } else {
          cancelAnimationFrame(id);
          id = 0;
        }
      },
      { rootMargin: '160px 0px' }
    );
    observer.observe(root);
    onCleanup(() => {
      observer.disconnect();
      if (id) cancelAnimationFrame(id);
    });
  });

  createEffect(() => {
    const { offset, opacity } = frame();
    if (!running() || !scrub) return;
    scrub.style.transform = `translateX(${offset.toFixed(2)}px)`;
    scrub.style.opacity = opacity.toFixed(3);
  });
  createEffect(() => {
    const text = stamp();
    if (running() && label) label.textContent = text;
  });

  return (
    <ArtworkBand
      svg={docsTimelineSvg}
      focus={TIMELINE_SCRUBBER}
      topTrim={TIMELINE_TOP_TRIM}
      topGap={props.topGap}
      artworkRef={(el) => (root = el)}
    />
  );
}

// ---------------------------------------------------------------------------
// Feature bands — copy header above, graphic below
//
// Replaces the side-by-side FeatureSplit for these sections. Copy in two
// columns across the full measure, then the graphic on its own beat with real
// air above it, which is what let the version-history timeline breathe.
// ---------------------------------------------------------------------------

/**
 * The two-column copy header: headline left, description right.
 *
 * 1fr auto, not an even split. Every description here forces its own line
 * breaks with <br />, so a 1fr 1fr split leaves dead space to the right of the
 * text that no amount of width can fill. Sizing the second column to its
 * content lands the text's right edge on the section's right edge and hands the
 * slack to the headline, which also keeps the headlines on one line.
 */
/**
 * Headline line-height and upward nudge, in px, solved so the two-line
 * headline registers against the three-line description beside it on the two
 * things the eye actually reads: the x-height top of the first line, and the
 * baseline of the last.
 *
 * Both constraints together leave no freedom. Writing b1 for a block's first
 * baseline, its x-top is b1 - x-height and its last baseline is
 * b1 + (N - 1) x line-height. Aligning the x-tops fixes the headline's first
 * baseline 11.48px below the description's (22.19 - 10.71); aligning the last
 * baselines then forces the line-height, because the headline has one gap to
 * cover the description's two:
 *
 *   L = 2 x 30.4 + x(cyberreader 19px) - x(display 42px)
 *     = 60.8 + 10.66 - 22.19
 *     = 49.27
 *
 * The nudge is needed because align-items lines up the two blocks' line BOXES,
 * and how far the x-height sits below a box top is half-leading plus
 * (ascent - x-height), which differs with the font and the line-height:
 * (49.27 - 55) / 2 + (44 - 22.19) = 18.95 against
 * (30.4 - 25) / 2 + (19 - 10.66) = 11.04.
 *
 * Both constants moved when the subtitle went from rajdhani 21px/1.6 to
 * cyberreader 19px/1.6, and they moved in opposite directions: the subtitle's
 * line-height dropped 3.2px, and the headline covers TWO of its gaps against
 * one of its own, so L lost 6.4px and gained back the 0.95px the wider face
 * adds to the x-height. At 49.27 on 42px type the leading is 1.17, tighter
 * than the 1.33 it was but still 6.8px of air between the first line's
 * descenders and the second's ascenders -- checked against Roboto Slab's own
 * 11px descent and 31.5px ascender, not assumed from the em box.
 *
 * Every metric above is measured off the rendered fonts rather than assumed,
 * via canvas measureText("x") and ("H") actualBoundingBoxAscent. Cap heights
 * are deliberately NOT the reference: both blocks are mostly lowercase, so
 * aligning caps (29.86 against 13.91) lines up letters that are barely there:
 * cap-aligned, the headline's x-top sits 7.67px down and the subtitle's 3.25,
 * leaving the two x-heights 4.4px apart.
 *
 * Desktop only: the two columns stack on a phone, where there is nothing to
 * line up against.
 */
const DOCS_HEADLINE_LH = 49.27;
const DOCS_HEADLINE_NUDGE = 7.9;

function DocsFeatureCopy(props: { block: DocsFeatureBlock }) {
  // A footer is a list, and a list stacks. Derived rather than passed: the
  // shape of the copy decides the layout, so there is no way to set one and
  // forget the other.
  const stacked = () => Boolean(props.block.footer);
  return (
    <section
      aria-label={props.block.label}
      style={{
        'box-sizing': 'border-box',
        margin: '0 auto',
        'max-width': 'var(--page-max)',
        'padding-inline': mobile() ? '18px' : '24px',
        width: '100%',
      }}
    >
      <Show when={props.block.footer}>
        <style>{`
        /*
         * The footer list is the email page's compose-section bullets in
         * this page's own type, and the swap is not cosmetic: that list is
         * set in body at 19px/1.45, while DOCS_HEADLINE_NUDGE above aligns
         * the headline's x-height top against a FIRST LINE BOX of cyberreader
         * 19px/1.6. Adopting the other page's font moves that x-top 1.5px
         * and the headline stops registering against its own subtitle.
         *
         * So what is borrowed is the form -- an inline mark, a grid ul, one
         * claim per row -- and the gap that carries it is that list's own,
         * scaled from its 19px body to this 19px cyberreader:
         *
         *   gap    9 / 27.55 x 30.4 = 9.9
         *
         * The gap is free to take it: it falls BETWEEN items, so it cannot
         * move the first line box the headline is registered against.
         * margin is what could, which is why it is zeroed: the UA default
         * margin-block-start of 1em is 19px at this font size, and
         * align-items: start aligns the item's margin box, so leaving it would
         * drop the x-top by the full 21px.
         *
         * padding is zeroed for an unrelated, horizontal reason -- the UA only
         * sets padding-inline-start, which cannot move a line box in the block
         * direction. Nothing here sets box-sizing, so the UA's 40px would both
         * indent every bullet 40px right of the headline's left edge, where the
         * paragraph this list replaces begins, and push the ul's border box to
         * 470px against a 430px track.
         */
        .docs-note-list {
          color: var(--c3);
          display: grid;
          font-family: cyberreader, body;
          font-size: 19px;
          font-weight: 300;
          gap: 10px;
          line-height: 1.6;
          list-style: none;
          margin: 0;
          max-width: 100%;
          padding: 0;
          text-align: left;
          /*
           * No stated width any more: shrink-to-fit is what this list wants.
           *
           * It used to be 430px because it sat in the subtitle's own auto grid
           * TRACK, beside the headline, where shrink-to-fit would have parked
           * its 232px of max-content 198px right of where the paragraph it
           * replaced began. Stacked under the headline it shares that
           * headline's left edge and its column's full width, so fitting the
           * content is exactly right -- and the phone override that had to
           * undo the width went with it. max-width stays: it is what wraps a
           * row rather than running it past a narrow viewport.
           */
        }
        /*
         * The bullet: a round dot in the list's own ink, not the accent "+"
         * this list used to carry. Set on ::before so a row's markup is the
         * claim and nothing else, and sized in px with a phone override rather
         * than in em, because 0.3em of a 19px row and 0.3em of a 17px one are
         * 5.7 and 5.1 -- close enough that the dot may as well be a stated
         * size, and a stated size cannot drift when the type does.
         *
         * The dot keeps its 6px through the move to cyberreader 19px because
         * what it is sized against barely moved: rajdhani's x-height at 21px
         * is 10.71 and cyberreader's at 19px is 10.66, so the same dot reads
         * at the same weight beside the row.
         *
         * baseline alignment plus a lift, the same pair the closing figure's
         * caption uses (.dhc-caption li::before) in this same font: a dot
         * aligned on the baseline sits ON it, and -0.28em raises it to the
         * middle of the x-height. align-items: center would look right too
         * until a row wrapped, and then it would centre on both lines.
         */
        .docs-note-list li {
          align-items: baseline;
          display: flex;
          gap: 8px;
        }
        .docs-note-list li::before {
          background: currentColor;
          border-radius: 999px;
          content: '';
          flex: none;
          height: 6px;
          translate: 0 -0.28em;
          width: 6px;
        }
        /* Viewport-dependent styling lives in CSS (not JS ternaries) so the
           build-time prerender paints correctly on phones before the JS
           bundle loads. Matches the 700px mobile() breakpoint this
           component's inline styles use, and holds the same proportions
           against the 17px phone type. */
        @media (max-width: 699px) {
          .docs-note-list { font-size: 17px; gap: 9px; }
          .docs-note-list li { gap: 7px; }
          .docs-note-list li::before { height: 5px; width: 5px; }
        }
        `}</style>
      </Show>
      {/*
       * Two columns for a block with a subtitle, one for a block with a list.
       *
       * The side-by-side arrangement is for a paragraph: it is the shape that
       * lets a three-line subtitle sit against a two-line headline without
       * either running long. A three-row list beside a one-line headline is a
       * different picture -- the rows stack down past the headline's baseline
       * and the eye has to travel back up and left to read them -- so the
       * list goes under the headline instead and the grid drops to one
       * column.
       */}
      <div
        style={{
          'align-items': 'start',
          display: 'grid',
          gap: mobile() ? '20px' : stacked() ? '26px' : '64px',
          'grid-template-columns':
            mobile() || stacked() ? 'minmax(0, 1fr)' : 'minmax(0, 1fr) auto',
          'justify-items': 'start',
        }}
      >
        <h2
          style={{
            'font-family': 'display',
            'font-size': mobile() ? '32px' : '42px',
            // Main's h2 tier: a section title, same slot as .tasks-h2.
            'font-weight': '380',
            'letter-spacing': '-0.018em',
            'line-height': mobile() ? 1.1 : `${DOCS_HEADLINE_LH}px`,
            // The nudge is a cross-column correction -- it registers this
            // headline's x-height against a subtitle's first line box in the
            // track beside it. Stacked, there is no such neighbour, and
            // applying it would just lift the whole block 9.58px.
            margin:
              mobile() || stacked() ? '0' : `-${DOCS_HEADLINE_NUDGE}px 0 0`,
            'text-align': 'left',
          }}
        >
          {props.block.headline}
        </h2>
        <Show when={props.block.description}>
          <p
            style={{
              // One step up the ink ramp from --c4 (0.75 lightness) to --c3
              // (0.87). Still clearly secondary to the headline, which sits at
              // --c1, and still leaves the <Hi> emphasis inside these
              // descriptions a step above it.
              //
              // Kept in sync with .docs-note-list above, which is the same
              // subtitle slot set as a list: colour, family, both sizes and the
              // line-height are restated there because a class cannot be shared
              // with an inline style object. Retype one, retype the other, or
              // the version-history section stops matching its siblings.
              color: 'var(--c3)',
              // Main's lead tier, at its own size rather than this page's old
              // one. 21px was a rajdhani measure, and rajdhani is condensed:
              // the same string set in cyberreader runs 14% wider and wrapped
              // to FOUR lines in this 430px track, which breaks the two-column
              // registration outright -- the headline has one line gap to cover
              // the subtitle's, and against three of them the solved
              // line-height would be 90px on 42px type. At 19px, which is what
              // .tasks-lead sets, it is three lines again and 8px narrower than
              // the rajdhani version was, so the column is unchanged.
              'font-family': 'cyberreader, body',
              'font-size': mobile() ? '17px' : '19px',
              'font-weight': '300',
              'line-height': 1.6,
              margin: '0',
              'max-width': '430px',
              'text-align': 'left',
            }}
          >
            {props.block.description}
          </p>
        </Show>
        {/* A block sets description OR footer, never both. Two children is
            what each arrangement is drawn for: a headline and its subtitle
            across two columns, or a headline and its list down one. A block
            that wants both has to wrap them in a cell of their own first. */}
        {props.block.footer}
      </div>
    </section>
  );
}

/**
 * A feature band: the copy header, then its graphic below with generous space.
 *
 * `graphicMaxWidth` exists because these graphics are not the same shape. The
 * mention strip wants the whole measure (it was rendering at half the scale it
 * was drawn for); a single zoomed line of document text would just look lost
 * in that width, so it gets capped narrower.
 */
function DocsFeatureBand(props: {
  block: DocsFeatureBlock;
  graphic: Component;
  graphicMaxWidth?: string;
  /** The graphic runs its own full-bleed band; skip the page column. */
  bleed?: boolean;
}) {
  return (
    <div
      style={{
        'padding-top': mobile() ? '52px' : '84px',
        'padding-bottom': mobile() ? '72px' : '116px',
      }}
    >
      <DocsFeatureCopy block={props.block} />
      {/* bleed: the graphic supplies its own full-bleed band, so wrapping it
          in the padded page column here would cap it at the content width and
          defeat the point. */}
      <Show
        when={props.bleed}
        fallback={
          <div
            style={{
              'box-sizing': 'border-box',
              margin: '0 auto',
              'margin-top': mobile() ? '40px' : '68px',
              'max-width': props.graphicMaxWidth ?? 'var(--page-max)',
              'padding-inline': mobile() ? '18px' : '24px',
              width: '100%',
            }}
          >
            <Dynamic component={props.graphic} />
          </div>
        }
      >
        <Dynamic component={props.graphic} />
      </Show>
    </div>
  );
}

function VersionHistorySection() {
  return (
    <div
      style={{
        'padding-top': mobile() ? '52px' : '84px',
        'padding-bottom': mobile() ? '72px' : '116px',
      }}
    >
      <DocsFeatureCopy block={versionHistoryBlock} />
      {/*
       * A negative gap, so the timeline rises past the copy instead of
       * starting under it. The three bullets stop about 240px into a 1160px
       * column, and the band's fade is near zero out there -- its peak follows
       * the scrubber at 62% of the viewport -- so what reaches up beside them
       * is a ghost of the graphic's left tail, not a second thing to read.
       *
       * -48, measured rather than picked: the artwork's first ink is the
       * scrubber's label and its first RULE is 41 units below that. -48 brings
       * the label level with the last bullet and still leaves the rule clear
       * of it; a little further and the rule crosses "Fork it into a new doc."
       * and reads as a strikethrough.
       *
       * A phone gets the closing but not the overlap. The copy runs the full
       * column there, so there is no empty right-hand side for the graphic to
       * rise into -- at -16px the scrubber's label ends up sitting on the same
       * line as "Fork it into a new doc.", 15px from it. 0 still takes 40px
       * out of the gap this band used to leave.
       */}
      <TimelineArtworkBand topGap={mobile() ? '0px' : '-48px'} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// The integration thesis — a hero-scale statement over the animated @mention
// cycle, on the beat the @links band used to hold. Ported from the /channels
// page's ChannelsIntegrationHero, artwork included, so the two pages make the
// claim in one voice. Deliberately a different graphic register from this
// page's other bands: one line-art card blown up to full width, rather than a
// wide document crop faded out at both edges.
//
// The headline is the feature bands' own tier -- 42px at -0.018em, the same
// as "Agents edit like teammates." above it and "Rewrite history." below.
// It used to run a step larger, at clamp(40px, 4.2vw, 52px), on the grounds
// that this is a hero beat rather than a feature header; that was the
// /channels original's divergence and it survived the port. It does not
// survive the reorder: on /channels this section opens the page, where a
// larger tier reads as the page's own voice, but here it now sits third of
// four beats in a row and the size difference reads as an inconsistency
// rather than as emphasis. The wash, the width and the cooler body copy are
// what mark it as the statement; the type does not have to as well.
// ---------------------------------------------------------------------------

function DocsIntegrationHero() {
  return (
    <section
      aria-label="Deeply integrated with your workspace"
      style={{
        'box-sizing': 'border-box',
        display: 'grid',
        gap: mobile() ? '36px' : '64px',
        'justify-items': 'center',
        margin: '0 auto',
        'max-width': 'var(--page-max)',
        /*
         * Bottom-heavy on purpose, and measured against the page's own rhythm
         * rather than picked. Every other divider on this page has 96 to 116px
         * of section padding above it; this one had 88, and the section BELOW
         * it is the tightest on the page at 74.4px to its heading, so the
         * mention line landed 163px from "Agents edit" where the pair above
         * gets 193.
         *
         * 128 took that to 205 and still read tight. Note what this padding
         * can and cannot move: the wash is the section's own box, so growing
         * the padding grows the panel with it and the wash's bottom edge stays
         * exactly 77px above "Agents edit" whatever this number is -- that gap
         * belongs to the rule and the next section's own top padding. What it
         * moves is how much panel sits UNDER the mention line before that
         * edge, which is the thing that was reading tight.
         *
         * 144, which is half again the 96 this section opens with. Bottom-heavy
         * by that much on purpose, because the box's mass is all in its top
         * half -- headline, paragraph, then a single 52px strip of artwork --
         * so an even split would pool the slack above the headline where there
         * is already plenty. A thin line of ink also needs more clearance from
         * a hard edge than a block of type does: there is nothing else in the
         * lower half of the panel to hold the eye off the boundary.
         *
         * The phone keeps the same ratio against its own 64: 96.
         */
        padding: mobile() ? '64px 18px 96px' : '96px 24px 144px',
        position: 'relative',
        width: '100%',
        // Own stacking context, so the section lighting below (z-index -1)
        // stays scoped to this section instead of escaping to the page's
        // stacking order and landing behind an unrelated sibling.
        'z-index': 0,
      }}
    >
      {/* A quiet divider and a small neutral highlight within the page column. */}
      <div
        aria-hidden="true"
        style={{
          'background-color': 'var(--b0)',
          'background-image':
            'linear-gradient(to bottom, color-mix(in srgb, var(--c1) 16%, transparent) 0, transparent 1px), ' +
            'radial-gradient(70% 22% at 50% 0%, color-mix(in srgb, var(--ambient-ink) 7%, transparent) 0%, color-mix(in srgb, var(--ambient-ink) 1.6%, transparent) 60%, transparent 100%)',
          bottom: 0,
          left: '0',
          'pointer-events': 'none',
          position: 'absolute',
          top: 0,
          width: '100%',
          'z-index': -1,
        }}
      />
      <div
        style={{
          display: 'grid',
          gap: mobile() ? '14px' : '18px',
          'justify-items': 'start',
          'justify-self': 'start',
        }}
      >
        <h2
          style={{
            color: 'var(--c1)',
            'font-family': 'display',
            'font-size': mobile() ? '32px' : '42px',
            'font-weight': '380',
            'letter-spacing': '-0.018em',
            // The bands set their leading in px because their two-column
            // header registers the headline's x-height against the subtitle's
            // first line box. This headline has no subtitle beside it, so it
            // takes that leading as the ratio it works out to -- 49.27 on 42
            // -- and stays in step without inheriting the registration.
            'line-height': mobile() ? 1.1 : DOCS_HEADLINE_LH / 42,
            margin: '0',
            'text-align': 'left',
            'text-wrap': 'balance',
          }}
        >
          Deeply integrated <br /> with your workspace.
        </h2>
        <p
          style={{
            color: 'var(--c4)',
            'font-family': 'cyberreader, body',
            'font-size': mobile() ? '17px' : '19px',
            'font-weight': '300',
            'line-height': 1.6,
            margin: '0',
            // Still 44ch, and the measure grows with the font rather than in
            // spite of it: cyberreader's zero is wider, so the same 44ch is
            // 507px where rajdhani's was 435. Two lines either way.
            'max-width': '44ch',
            'text-align': 'left',
          }}
        >
          {/* "everyone in the doc", not the original's "the whole channel":
              the sentence names the container the reader is standing in, and
              on this page that is the document. The list of linkable objects
              is the workspace's, so it carries over unchanged. */}
          <Hi>
            @mention a task, channel, document, email thread, agent, or company
          </Hi>{' '}
          to share it with everyone in the doc.
        </p>
      </div>
      {/* The animated mention row: one line of message text whose @mention
          window cycles through linkable items — the scrollme list steps up one
          16px row every 3s, six steps over an 18s loop. The animation lives in
          the SVG's own <style>, which is why the asset is imported as a
          component and not as a URL. */}
      <DocsMentionCycle
        role="img"
        aria-label="A message reading @Sarah take a look at, where the linked item cycles through the docs, tasks, charts and people in a workspace"
        style={{
          display: 'block',
          height: 'auto',
          margin: '0 auto',
          /* Sized so the line's own type lands at ~27px on a desktop — between
             the 19px paragraph above it and the 52px headline above that, so
             it reads as the example rather than as a third heading. Both
             figures are the /channels original's min(1217px, 65vw) scaled by
             this asset's crop, 268 units against the 342 it was exported at,
             which is what holds the type size across that change.
             No mask, unlike the original: the asset's viewBox is cropped to
             its own ink now, so there is no card left to dissolve. */
          'max-width': mobile() ? '100%' : 'min(954px, 51vw)',
          /*
           * Nudged right, because the artwork's box is wider than its average
           * frame. The cycling window is a fixed 157-unit clip, sized for the
           * widest row it has to hold, but only two of the seven rows reach
           * that far. Measured right edges, in the window's own units:
           *
           *   Deploy onboarding v3     157.00     Morning briefing      93.54
           *   Re: onboarding feedback  133.77     Release Steps         81.83
           *   Atreus Consulting         99.11     outage alerts         76.86
           *
           * So the mean row leaves 42.8 units of reserved-but-empty space at
           * the right, and centring the BOX parks the ink 21.4 units left of
           * centre for most of the loop -- which is the left-heaviness, and
           * why it cannot be fixed in the asset: cropping the viewBox to the
           * average would clip the two rows that use the full width.
           *
           * 6%, not the 8% that would centre the mean exactly. The section's
           * content box stops growing at --page-max while this graphic keeps
           * growing to its own 954px cap, so past about 1870px the slack is
           * down to 79px a side; 8% would spend 76 of it and leave the widest
           * rows 3px off the page column. 6% leaves 22px there, and everywhere
           * narrower there is far more room than that.
           *
           * Phones get none of it: at max-width 100% there is no slack to
           * spend, so any shift is straight off the right edge.
           */
          transform: mobile() ? 'none' : 'translateX(6%)',
          width: '100%',
        }}
      />
    </section>
  );
}

function _LiveEditorSection() {
  return (
    <section
      aria-label="Try the editor"
      style={{
        'box-sizing': 'border-box',
        display: 'grid',
        'justify-items': 'center',
        margin: '0 auto',
        'max-width': '1280px',
        'padding-block': mobile() ? '56px 8px' : '96px 16px',
        'padding-inline': mobile() ? '18px' : '24px',
        width: '100%',
      }}
    >
      {/* Mockup frame, matching the email page's filtering hero: a top-lit
          gradient fill plus a masked 1px gradient ring (::before) that paints
          only the ring, never behind the content, so it reads a touch lighter
          than the fill it sits on. Kept in sync with .email-filter-frame in
          EmailFilteringSection. */}
      <style>{`
        .docs-demo-frame { position: relative; }
        .docs-demo-frame::before {
          content: '';
          position: absolute;
          inset: 0;
          border-radius: inherit;
          padding: 1px;
          background: linear-gradient(to bottom, color-mix(in srgb, var(--c1) 10%, transparent) 0%, color-mix(in srgb, var(--c1) 7%, transparent) 45%, transparent 80%);
          -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
          -webkit-mask-composite: xor;
          mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
          mask-composite: exclude;
          pointer-events: none;
        }
      `}</style>

      <div
        style={{
          'margin-top': mobile() ? '34px' : '52px',
          // The frame spans the content width and the window is capped
          // narrower, which is where the inset comes from — the same way the
          // email hero does it, rather than horizontal padding on the frame.
          'max-width': mobile() ? '1000px' : '100%',
          width: '100%',
        }}
      >
        <Show
          when={mobile()}
          fallback={
            <>
              {/* Outside the frame, on the page's own dark ground, and flush
                  with the section's left edge — the same margin the rest of the
                  page's content uses. Deliberately NOT inset to the window's
                  900px column, which left it floating in from the page edge. */}
              <div style={{ width: '100%' }}>
                <p
                  style={{
                    color: 'color-mix(in srgb, var(--c4) 70%, transparent)',
                    'font-family': 'rajdhani, body, system-ui, sans-serif',
                    'font-size': '14px',
                    'font-weight': '600',
                    'letter-spacing': '0.12em',
                    margin: mobile() ? '0 0 14px' : '0 0 18px',
                    'text-transform': 'uppercase',
                  }}
                >
                  Live demo
                </p>
              </div>
              <div
                class="docs-demo-frame"
                style={{
                  background:
                    'linear-gradient(to bottom, color-mix(in srgb, var(--c1) 24%, transparent) 0%, color-mix(in srgb, var(--c1) 5%, transparent) 45%, transparent 62%)',
                  'border-radius': '8px',
                  'box-sizing': 'border-box',
                  'padding-top': '48px',
                  width: '100%',
                }}
              >
                <div
                  style={{
                    margin: '0 auto',
                    'max-width': '900px',
                    width: '100%',
                  }}
                >
                  <HeroDocCollabWindow />
                </div>
              </div>
            </>
          }
        >
          <HomeMobileDocsShot />
        </Show>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Comparison table (Macro vs Notion vs Obsidian vs Google Docs vs Confluence)
// ---------------------------------------------------------------------------

const comparisonColumns: ComparisonColumn[] = [
  { label: 'Macro' },
  { label: 'Notion', logo: LogoNotion },
  { label: 'Obsidian', logo: LogoObsidian },
  { label: 'Google Docs', logo: LogoGoogleDocs },
  { label: 'Confluence', logo: LogoConfluence },
];

const comparisonRows: ComparisonRow[] = [
  {
    feature: 'Version history & fork a past version',
    cells: [true, 'partial', 'partial', 'partial', 'partial'],
  },
  {
    feature: 'Search workspace and connected sources',
    cells: [true, true, 'partial', 'partial', 'partial'],
  },
  {
    feature: 'Real-time collaboration + offline editing',
    cells: [true, 'partial', 'partial', true, false],
  },
  { feature: 'Inline comment threads', cells: [true, true, false, true, true] },
  {
    feature: 'Properties / database experience',
    cells: [true, true, 'partial', false, 'partial'],
  },
  {
    feature: '@mention people, docs, tasks & channels',
    cells: [true, 'partial', 'partial', false, 'partial'],
  },
  {
    feature: 'Markdown-native documents',
    cells: [true, 'partial', true, false, false],
  },
  {
    feature: 'Agents with workspace context',
    cells: [true, 'partial', false, false, 'partial'],
  },
  {
    feature: 'Built-in tasks, CRM & email',
    cells: [true, 'partial', false, false, false],
  },
  {
    feature: 'Live agent cursor in the document',
    cells: [true, false, false, false, false],
  },
  {
    feature: 'Open source (AGPLv3)',
    cells: [true, false, false, false, false],
  },
];

function ComparisonSection() {
  return (
    <section
      aria-label="How Macro Docs compares"
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
        <h2
          style={{
            color: 'var(--c1)',
            'font-family': 'display',
            'font-size': mobile() ? '26px' : '32px',
            // Main's h3 tier -- the smaller section title. /tasks sets its own
            // "How does Macro Tasks stack up?" in .tasks-h3 at 350, which is
            // this heading in the same slot on the sibling page.
            'font-weight': '350',
            'letter-spacing': '-0.015em',
            'line-height': 1.1,
            margin: 0,
          }}
        >
          How does Macro Docs stack up?
        </h2>
      </div>
      <div style={{ width: '100%', 'max-width': '920px', 'min-width': '0' }}>
        <ComparisonTable columns={comparisonColumns} rows={comparisonRows} />
      </div>
      <ComparisonLegend />
      <SectionFaq items={docsFaq} embedded />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Final CTA (shared homepage closing CTA)
// ---------------------------------------------------------------------------

function DocsFinalCta() {
  return (
    <SectionFinalCta
      googleButtonName="documents_final_sign_up_google"
      demoButtonName="documents_final_book_demo"
      mobileButtonName="documents_final_get_started"
    />
  );
}

/**
 * Horizontal taper for the cast shadow's wings, ported from the /channels hero
 * (castShadowMask in the chat branch's RouteChannels).
 *
 * Many small steps rather than a couple of stops: the wings are the only part
 * of the cast shadow that is actually visible, and a short gradient ends them on
 * a discernible edge instead of dissolving. The channels version also damps one
 * side per panel, because its cards sit in a triptych and shade each other —
 * a single centred panel needs the symmetric taper, so that is all this keeps.
 */
function castShadowMask() {
  const wing: [number, number][] = [
    [0, 0],
    [7, 0.05],
    [13, 0.16],
    [20, 0.36],
    [27, 0.62],
    [33, 0.85],
    [40, 1],
  ];
  const stop = (pos: number, alpha: number) =>
    alpha >= 1 ? `black ${pos}%` : `rgb(0 0 0 / ${+alpha.toFixed(3)}) ${pos}%`;
  const left = wing.map(([pos, a]) => stop(pos, a));
  const right = [...wing].reverse().map(([pos, a]) => stop(100 - pos, a));
  return `linear-gradient(to right, ${[...left, ...right].join(', ')})`;
}

/**
 * Grounds a panel the way the /channels hero grounds its cards: a blurred cast
 * shadow thrown out along the floor, plus a tighter contact shadow where the
 * panel meets it.
 *
 * Two layers, not one box-shadow. The cast layer is vertical density only, with
 * its horizontal falloff carried by the mask — a centre-anchored radial would
 * double up with the mask and leave the wings near-transparent. The contact
 * layer radiates from the bottom centre with flat elliptical end caps, which is
 * what reads as the panel actually resting on something.
 *
 * Both sit BEHIND the panel and are lifted a hair, so the blur fringe hugs the
 * bottom edge rather than dispersing below it.
 */
function GroundedPanel(props: { children: JSX.Element }) {
  const mask = castShadowMask();
  // Matches PreviewWindow's card radius, so the ring and sheen sit exactly on
  // the panel's edges rather than cutting across its corners.
  const radius = '12px';
  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <style>{`
        /*
         * Both overlays are scoped here rather than added to PreviewWindow:
         * that component is shared by the email, tasks, channels and calls
         * graphics, and this lighting is meant for the hero panel alone.
         *
         * They paint OVER the panel, which is why the alphas are so low. The
         * panel holds a live editor in an iframe, so there is no way to slip a
         * layer between its background and its content — anything stronger
         * would read as haze over the text rather than light on the glass.
         * pointer-events:none keeps typing and selection reaching the iframe.
         */
        .hero-panel-glint,
        .hero-panel-sheen,
        .hero-panel-wedge {
          border-radius: ${radius};
          inset: 0;
          pointer-events: none;
          position: absolute;
        }
        /* The diagonal wedge, the same device the feature artwork uses for its
           lighting: a tall rectangle rotated 27.2deg, filled with a gradient
           that fades along its own length, clipped to the panel. The rotation
           and the angle are the artwork's own numbers, so the hero and the
           bands below it catch light from the same direction.
           A rotated element rather than a linear-gradient at 207deg because the
           artwork's wedge has a straight leading EDGE where the rectangle ends,
           and that edge is the look; a gradient across the whole panel can only
           fake it with a hard colour stop.
           The rect's box is the artwork's own, converted to percentages of the
           card it sat on (661x993 at -40.8,-433 over 800x500). Keeping it off
           the panel's top left is what makes the visible boundary the rect's
           RIGHT edge, sloping down to the left; pulling the box down instead
           puts its top edge across the panel and the diagonal leans the wrong
           way. The panel spans 37% to 82% of the rect's length, which is where
           the gradient's stops sit.
           3.5% where the artwork uses 15%: this paints over a live iframe, so
           there is nothing to slip it behind. The artwork's own alpha sits on
           a drawing of a document; here it sits on a real one, and anything
           near that weight reads as haze over the text rather than light on
           the glass in front of it. */
        .hero-panel-wedge {
          overflow: hidden;
          z-index: 1;
        }
        .hero-panel-wedge::before {
          background: linear-gradient(
            to bottom,
            color-mix(in srgb, var(--c1) 3.5%, transparent) 37%,
            color-mix(in srgb, var(--c1) 1.2%, transparent) 62%,
            transparent 84%
          );
          content: '';
          height: 198.6%;
          left: -5.1%;
          position: absolute;
          top: -86.6%;
          transform: rotate(27.2deg);
          transform-origin: top left;
          width: 82.6%;
        }
        /* A 1px ring, brightest at the top-left corner. The xor mask paints
           only the ring itself, so nothing tints the panel's face.
           Held to around a third of its first pass: on a 1px line every point
           of alpha reads, and at 34% the corner caught the eye before the
           document inside the panel did.
           An ellipse anchored in the corner, NOT a 135deg linear gradient. A
           linear gradient's progress runs on (x + y), so on a panel this wide
           the same percentage reached far further down the short left edge than
           along the long top edge, and the glint ran most of the side. Explicit
           px radii decouple the two: a long reach across the top, a short one
           down the side, both independent of the panel's proportions. */
        .hero-panel-glint {
          background: radial-gradient(
            560px 190px at 0% 0%,
            color-mix(in srgb, var(--ambient-ink) 11%, transparent) 0%,
            color-mix(in srgb, var(--ambient-ink) 5%, transparent) 30%,
            color-mix(in srgb, var(--ambient-ink) 1.5%, transparent) 60%,
            transparent 100%
          );
          padding: 1px;
          -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
          -webkit-mask-composite: xor;
          mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
          mask-composite: exclude;
          z-index: 2;
        }
        /* The light itself: a wide falloff anchored in the top-left corner. */
        .hero-panel-sheen {
          background: radial-gradient(
            125% 105% at 0% 0%,
            color-mix(in srgb, var(--ambient-ink) 5%, transparent) 0%,
            color-mix(in srgb, var(--ambient-ink) 2.5%, transparent) 32%,
            transparent 68%
          );
          z-index: 1;
        }
      `}</style>
      <span
        aria-hidden="true"
        style={{
          background:
            'linear-gradient(to top, rgb(0 0 0 / 1) 0%, rgb(0 0 0 / 0.74) 34%, rgb(0 0 0 / 0.36) 64%, transparent 96%)',
          bottom: '0',
          display: 'block',
          filter: 'blur(10px)',
          height: '26px',
          left: '-34%',
          '-webkit-mask-image': mask,
          'mask-image': mask,
          'pointer-events': 'none',
          position: 'absolute',
          right: '-34%',
        }}
      />
      <span
        aria-hidden="true"
        style={{
          background:
            'radial-gradient(56% 105% at 50% 100%, rgb(0 0 0 / 1) 0%, rgb(0 0 0 / 0.82) 26%, rgb(0 0 0 / 0.56) 48%, rgb(0 0 0 / 0.3) 70%, rgb(0 0 0 / 0.12) 86%, transparent 100%)',
          'border-radius': '64px / 3.5px',
          bottom: '1px',
          display: 'block',
          filter: 'blur(4px)',
          height: '15px',
          left: '-11%',
          'pointer-events': 'none',
          position: 'absolute',
          right: '-11%',
        }}
      />
      {props.children}
      <span aria-hidden="true" class="hero-panel-wedge" />
      <span aria-hidden="true" class="hero-panel-sheen" />
      <span aria-hidden="true" class="hero-panel-glint" />
    </div>
  );
}

/**
 * The hero's figure: the real editor, embedded and typeable.
 *
 * Just the window — no gradient frame or LIVE DEMO eyebrow. Those belonged to
 * the standalone section this replaces; the hero's figure slot already supplies
 * its own bloom backdrop, and framing on top of that reads as two nested
 * treatments fighting each other.
 */
function HeroLiveDoc() {
  return (
    <Show
      when={mobile()}
      fallback={
        <GroundedPanel>
          <HeroDocCollabWindow />
        </GroundedPanel>
      }
    >
      <HomeMobileDocsShot />
    </Show>
  );
}

/**
 * Closing figure above the comparison table: the workspace illustration that
 * used to lead the page.
 */
/**
 * Notes pinned into the closing figure's own left gutter, revealed on scroll.
 *
 * Three, not eight. The figure contains at least that many capabilities, but a
 * mark only teaches if the visitor can identify what it points at: the comment
 * chip is 9 artwork units and the status circles are 8, which at this figure's
 * roughly 1:1 desktop render is under 10px, and the phone is already claimed by
 * the "Built for mobile" card further up the page. What is left is the three
 * things this artwork shows that nothing else on the page says.
 *
 * `y` is the artwork row each note points at, in the asset's own 884x570 units,
 * and all three are read off the asset rather than eyeballed: the @link line's
 * inline document icon boxes y 77.313-84.687, centre 81; the four task rows sit
 * on a 15-unit pitch at 132/147/162/177, so the block's centre is 154.5; the
 * envelope closing the pull quote boxes y 329.312-336.646, centre 332.98. Every
 * dot lands on x=202, so the three read as one column of annotation rather than
 * three separate pointers. 202 is 6.5 units clear of the document's text
 * column, whose left edge is x=208.5 -- where the blockquote's rule sits and
 * where the section divider and pull-quote card both begin -- so no mark is
 * ever drawn over artwork content, and the leaders run out through the card's
 * own empty left gutter.
 *
 * `drop` is how far that note's leader travels before it runs flat. It is
 * SIGNED: negative lifts the label above its dot, positive drops it below.
 * `leadEnd` is where that flat run stops. Both are per-note, and the three
 * pairs are -36/-22, 56/-18 and 20/-26.
 *
 * One rises and two fall, which is not a pattern so much as three separate
 * answers. Note 1 labels a four-row BLOCK rather than a row, so no reader is
 * matching it to a single line and it can afford the longest travel -- 56 down
 * to an elbow at (146, 210.5), whose diagonal traces the block's lower half
 * and brackets the group. Note 2 pins one email row, where the match has to be
 * exact, so it takes the shortest travel that still reads as a diagonal at 20.
 * Note 0 lifts for a reason past variance: the task block occupies roughly
 * y 103-206, and a down-angled leader from y=81 would park its label beside
 * that block and read as the block's caption. Going up also spends the dead
 * margin at the top of the figure.
 *
 * The three label centres then land at 45/210.5/353 -- gaps of 165.5 and 142.5
 * against ANCHOR gaps of 73.5 and 178.5, so the column of labels paces evenly
 * even though the dots it comes from do not. Clear space between adjacent
 * label boxes is 114.6 and 83.6 units, measured against the real box heights
 * (42.9 for the plain note, 58.9 for the two carrying an eyebrow) rather than
 * the line count, since the eyebrow is what made them unequal.
 *
 * Length variance is bought from the ELBOWS, at 166/146/182, and not from the
 * tips: the flat runs come out 188/164/208 while the three leadEnds stay
 * within 8 units of each other, so the lines arrive at the text near-flush and
 * the difference reads as three lengths rather than as a ragged edge. Pulling
 * note 1's tip right to -10 was tried, and buys a wider spread (156 against
 * 164) at the cost of 26 units of air where the other two have 10 and 14. It
 * looks detached rather than varied: the arrival edge is the part of a leader
 * a reader actually registers, so the tips are the wrong place to spend.
 */
type DocsHeroNote = {
  /* Shown above the sentence, in the page's own eyebrow idiom. Only the two
     notes that describe one specific thing on screen carry it: the first note
     states the general rule -- type @, link anything -- and an EXAMPLE over a
     rule would be a category error. It is overlay-only; the sub-gate caption
     renders the sentences as a plain bulleted list, where a stacked eyebrow
     over two of three bullets costs two lines to say what the bullet already
     says. */
  eyebrow?: string;
  /* A thunk, not a JSX.Element. Every note is rendered TWICE -- once as an
     overlay label above the gate, once as a caption bullet below it -- and a
     Solid JSX element is a real DOM node, not a description of one. Stored as
     a value it is created once, and the second render site MOVES it: the
     caption kept the italic and the overlay silently lost it, leaving "link to
     _ in your workspace" with a double space where the word had been. Calling
     it per site builds each one its own nodes. */
  label: () => JSX.Element;
  y: number;
  drop: number;
  leadEnd: number;
};

const DOCS_HERO_NOTES: DocsHeroNote[] = [
  // The line "Last week's notes: FE Team Meeting Notes 8/10", whose link
  // renders the target document's own title rather than a URL.
  {
    // "anything" italic because it is the load-bearing word: the claim is not
    // that @ links documents, it is that the set of things it links is not
    // enumerated. Rajdhani ships no italic face, so this is a synthesised
    // oblique -- which is why it is one word and not a phrase.
    label: () => (
      <>
        Type @ to insert a live link to <em>anything</em> in your workspace
      </>
    ),
    y: 81,
    drop: -36,
    leadEnd: -22,
  },
  // The four task rows: checkbox, title, status, assignee. Anchored on the
  // block's midline, which falls in the gap between rows two and three on
  // purpose, because the note is about the set and a dot inside one row would
  // single that row out.
  {
    eyebrow: 'Example',
    label: () => 'Task mentions show current status, priority, and assignee',
    y: 154.5,
    drop: 56,
    leadEnd: -18,
  },
  // The envelope and underlined link ending the pull quote. The row centre,
  // not the quote block's centre, which is prose about theme presets. The hash
  // glyph one line below it is a channel mention, not a second email link.
  {
    eyebrow: 'Example',
    label: () =>
      '@linked email threads get shared as live documents, no need to forward or BCC',
    y: 333,
    drop: 20,
    leadEnd: -26,
  },
];

/* The asset is the document window and nothing else now: the phone that used
   to sit at its lower right is gone, and the viewBox is cropped to the
   window's own 801x500 (measured, and with no filter overflow past it). Every
   x in the callout geometry below is unchanged by that -- the crop took the
   empty right and bottom, not the origin -- but the units per rendered pixel
   did change, which is what the cqw label size and DHC_LABEL_W depend on. */
const DHC_ART_W = 801;
const DHC_ART_H = 500;
/**
 * The callout geometry, all of it in the asset's own units, negative x being
 * the page margin to the left of the artwork.
 *
 * A leader leaves its dot at 45 degrees for that note's own `drop` units -- at
 * 45 degrees the drop is also the horizontal run, so it is the only number the
 * elbow needs -- and then runs flat out past the artwork's left edge to that
 * note's own `leadEnd`, so it arrives at the label horizontally: a sentence
 * wants a leader that meets it square, and the diagonal is spent inside the
 * artwork, over the card's empty left gutter, where there is room for it. The
 * three drops run -36/56/20, so the diagonals are 51/79/28 units against flat
 * runs of 188/164/208: still plainly two segments each, which is what the drop
 * has to buy at any value. See the note above DOCS_HERO_NOTES for why those
 * six numbers are what they are.
 *
 * The budget every number here spends is the clear space to the left of the
 * artwork, and it is worth stating how it is arrived at, because it used to be
 * a table of viewport widths and is not one any more. The artwork is 74% of
 * the page column's content box and pinned to its right edge, so that space is
 * the other 26% -- 801 * 26/74, or 281.4 artwork units -- at every width above
 * the 1000px gate this overlay is drawn at. Both terms scale with the column,
 * so the ratio does not move: narrow viewports shrink the artwork and the
 * margin together, and wide ones stop growing both when the column reaches
 * --page-max. The old measurements were taken when the artwork was 80% of the
 * column and centred, which left only about 111px of column margin and made up
 * the rest out of whatever gutter the viewport happened to leave outside the
 * column -- hence a table, and hence 1200px being the worst case, where the
 * column had just reached its max width and the viewport had opened no gutter
 * yet. None of that applies now.
 *
 * DHC_LABEL_W is 232 because that is where the longest note stops taking a
 * third line. Measured in Rajdhani at the 14-unit size: the first two notes
 * reach two lines at 164.0 and 164.8 units, but the email note is half again
 * as long as either and needs 230.3, so it sets the width and the other two
 * spend their second line ragged and short. If this copy is replaced -- it is
 * a placeholder, see above -- that note's two-line width is the number to
 * re-measure, not this one.
 *
 * A label therefore needs DHC_LABEL_W - DHC_LABEL_R = 268 of the 281.4, which
 * leaves 13.4 units between its left edge and the page column's own content
 * edge. That is the real ceiling on both constants: they trade against each
 * other, and 268 is as much as the pair can spend before the labels start
 * hanging into the page's margin instead of the artwork's.
 */
const DHC_DOT_X = 202;
const DHC_LABEL_R = -36;
const DHC_LABEL_W = 232;
/* How far left of the artwork the SVG canvas reaches, which is what bounds
   DHC_LEAD_END -- a leader past this is clipped, silently. 100 units against a
   leader ending at -26. It is not the label budget above and does not have to
   match it: the labels are HTML positioned outside this SVG and are bounded by
   the page column instead. */
const DHC_MARGIN = DHC_ART_W * 0.125;

/*
 * The header bar's right-hand cluster -- three avatars, the Share button, the
 * link icon -- as read off the asset, and the fade that quiets it.
 *
 * It is chrome. The figure is here to show a document with four kinds of link
 * in it, and at full strength this corner is the brightest thing in the frame:
 * the Share button is the only filled surface in the artwork (#16191F inside a
 * #353535 border) and the avatars are the only photographs. Both pull the eye
 * to the one part of the window that has nothing to do with the point.
 *
 * So the image is masked rather than the artwork redrawn -- the controls
 * should still be legible as controls, just quiet. Alpha floors at 0.45 over
 * the cluster and is back to 1 well before it reaches anything that matters:
 * horizontally by x=530, against the nearest content in the upper third
 * ending at x=439.5 and the breadcrumb on the far side of the bar ending at
 * 165.5; vertically by y=129, above which nothing else is drawn right of 439.5
 * at all. The window's own top-right corner and the two edges meeting there go
 * with it, which is the one thing the mask cannot avoid touching and reads as
 * a vignette rather than as damage.
 */
const DHC_CHROME_X: [number, number] = [652, 792.25];
const DHC_CHROME_Y: [number, number] = [8.75, 29.25];
const DHC_CHROME_CX =
  ((DHC_CHROME_X[0] + DHC_CHROME_X[1]) / 2 / DHC_ART_W) * 100;
const DHC_CHROME_CY =
  ((DHC_CHROME_Y[0] + DHC_CHROME_Y[1]) / 2 / DHC_ART_H) * 100;
/* 192 units across and 110 down, which is where the clearances above come
   from. Six stops rather than two: the ramp runs over about 130px of very dark
   artwork at a desktop width, and three stops band visibly there. */
const DHC_CHROME_FADE = `radial-gradient(24% 22% at ${DHC_CHROME_CX}% ${DHC_CHROME_CY}%, rgb(0 0 0 / 0.45) 0%, rgb(0 0 0 / 0.52) 25%, rgb(0 0 0 / 0.66) 48%, rgb(0 0 0 / 0.82) 68%, rgb(0 0 0 / 0.94) 85%, #000 100%)`;

/*
 * PLACEHOLDER COPY -- written to hold the right shape, not to ship as is.
 *
 * DocsFeatureCopy's two-column registration is solved arithmetic against a
 * TWO-line headline and a THREE-line, 430px-wide subtitle (DOCS_HEADLINE_LH
 * and DOCS_HEADLINE_NUDGE, and the derivation above them). Replacing this
 * copy is fine; changing its line count is not, without re-measuring.
 *
 * What the section has to say, for whoever writes the real thing: this is
 * the only beat that shows everything at once. The four bands above it each
 * make one claim -- markdown, agents, @links, history -- and this is the
 * finished document with all four of them in it, which is why the callouts
 * point at three different kinds of link rather than explaining one.
 */
const closingBlock: DocsFeatureBlock = {
  label: 'Macro Docs',
  headline: (
    <>
      Leverage links
      <br />
      to cross-connect your docs.
    </>
  ),
  description: (
    <>
      Link to literally anything that exists in Macro. <br />
      Format a link as text, a card, or an icon. <br />
      Agents can add, edit, and navigate links.
    </>
  ),
};

function DocsClosingFigure() {
  let figure: HTMLDivElement | undefined;
  // '' before mount (the resting, finished state, which is also what the
  // prerender and a reduce visitor ship), 'armed' hidden, 'in' revealing.
  const [phase, setPhase] = createSignal('');

  onMount(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (!('IntersectionObserver' in window) || !figure) return;
    // Armed synchronously rather than on the observer's first callback: that
    // callback is delivered after layout, and arming from it risks a frame of
    // the finished state before it hides. No root — this site scrolls an inner
    // div, and the implicit root already accounts for intermediate clip rects.
    setPhase('armed');
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          setPhase('in');
          io.disconnect();
          return;
        }
      },
      { threshold: 0.35 }
    );
    io.observe(figure);
    onCleanup(() => io.disconnect());
  });

  return (
    <div
      style={{
        'padding-top': mobile() ? '52px' : '84px',
        'padding-bottom': mobile() ? '56px' : '84px',
      }}
    >
      <style>{`
        /*
         * The terminal vocabulary is the site's existing one, taken from the
         * /email compose figure: a 7px accent dot on the feature, a leader at
         * stroke-width 1.5 and opacity 0.45, and bare accent text. No pill, no
         * border, no background, no uppercase.
         *
         * The ink used to be mixed 16% toward white, on the grounds that these
         * labels sit on the card's baked #060709 where bare var(--a0) is under
         * AA. Measured, neither half of that holds: the labels are drawn in
         * the page margin, left of the artwork entirely -- the leaders run out
         * to meet them -- so the ground behind them is the page's #090909, and
         * bare --a0 (#f58c34) is 8.23:1 on that and 8.33:1 on the card, both
         * past AAA rather than under AA. The mix was costing a fifth of the
         * accent's chroma (0.16 to 0.134) to clear a bar that was never close.
         * So: the accent, unmixed.
         */
        .dhc-svg,
        .dhc-notes,
        .dhc-caption {
          --dhc-ink: var(--a0);
        }
        /* The overlay is the enhancement, so it is off by default and the
           caption is on. Gated below, which keeps the gate's overrides
           deliberate instead of a list of silent resets. */
        .dhc-svg,
        .dhc-notes { display: none; }
        /* Widened leftward by exactly the margin, with the viewBox's origin
           pushed the same amount, so one user unit stays one artwork unit and
           x=0 stays the artwork's left edge. The box and the viewBox end up the
           same ratio, so preserveAspectRatio has nothing to do.

           width and height are stated outright rather than left to an inset
           pair, and that is the whole fix for an overlay that used to miss what
           it pointed at. An <svg> carries width/height as geometry attributes,
           and an attribute wins over left/right on an absolutely positioned
           box, so a left: -12.5% / right: 0 pair with width="100%" in the
           markup produced a box 884 units wide against a 994.5-unit viewBox.
           preserveAspectRatio then scaled the whole overlay to 0.889 and
           centred the shortfall, landing every dot about 35 units left and 32
           units below the row it annotates. A CSS declaration outranks the
           attribute, so stating both here is enough -- but it has to be both,
           because an SVG with only a viewBox has no intrinsic size to fall back
           on. */
        .dhc-svg {
          height: 100%;
          left: -${(DHC_MARGIN / DHC_ART_W) * 100}%;
          pointer-events: none;
          position: absolute;
          top: 0;
          width: ${((DHC_ART_W + DHC_MARGIN) / DHC_ART_W) * 100}%;
          z-index: 2;
        }
        .dhc-notes {
          container-type: inline-size;
          inset: 0;
          list-style: none;
          margin: 0;
          padding: 0;
          pointer-events: none;
          position: absolute;
          z-index: 3;
        }
        /* Past 100%, because DHC_LABEL_R is negative: the label's right edge
           is 36 units outside the artwork. The container stays pinned to the
           artwork so every cqw below is still a hundredth of it. */
        .dhc-note {
          position: absolute;
          right: ${((DHC_ART_W - DHC_LABEL_R) / DHC_ART_W) * 100}%;
          /* Ragged right, so the sentences share a left edge and read as a
             column of notes. The leader still arrives at the label's box
             edge, which is now the ragged side -- a short last line leaves a
             little air before the line meets it, and that is the trade for
             three sentences that start in the same place. */
          text-align: left;
          /* translate, not transform: the keyframes animate translate too, and
             animating transform would replace this and drop every label by
             half its own line box. */
          translate: 0 -50%;
        }
        .dhc-note-text {
          color: var(--dhc-ink);
          font-family: rajdhani, body;
          /* Proportional, so every clearance measured in artwork units holds
             at every width. 14 units of 801. */
          font-size: ${(14 / DHC_ART_W) * 100}cqw;
          line-height: 1.4;
          pointer-events: auto;
        }
        /* The page's own eyebrow -- rajdhani 600 at 0.12em, uppercase, the
           same as LIVE DEMO above the demo frame -- restated in artwork units
           so it scales with the figure like everything else here. Neutral
           rather than accent: it is a category marker sitting over an accent
           sentence, and in --dhc-ink it read as the sentence's first line.
           10 units against the sentence's 14 is the ratio that eyebrow keeps
           against its own body copy. */
        .dhc-note-eyebrow {
          color: color-mix(in srgb, var(--c4) 58%, transparent);
          display: block;
          font-size: ${(10 / DHC_ART_W) * 100}cqw;
          font-weight: 600;
          letter-spacing: 0.12em;
          line-height: 1.2;
          margin-bottom: ${(4 / DHC_ART_W) * 100}cqw;
          text-transform: uppercase;
        }
        /* Rajdhani has no italic face, so this is the browser's synthesised
           oblique. It is legible on one word and gets loose over a phrase,
           which is the reason the emphasis is kept to one. */
        .dhc-note-text em { font-style: italic; }
        .dhc-dot { transform-box: fill-box; transform-origin: center; }

        /* Caption for anything under the gate: the same three sentences, which
           is why each was written to stand alone with no pointer. A sibling of
           the artwork, not a child, because .feat-lite-hero-art::before is a
           bloom at inset -14% -10% of its own box and flow content inside it
           would re-centre and stretch that gradient. */
        .dhc-caption {
          display: grid;
          gap: 8px;
          list-style: none;
          margin: 18px auto 0;
          padding: 0;
          width: 80%;
        }
        .dhc-caption li {
          align-items: baseline;
          color: var(--dhc-ink);
          display: flex;
          font-family: rajdhani, body;
          font-size: 13px;
          gap: 8px;
          line-height: 1.45;
        }
        .dhc-caption li::before {
          background: var(--dhc-ink);
          border-radius: 999px;
          content: '';
          flex: none;
          height: 5px;
          translate: 0 -0.28em;
          width: 5px;
        }
        @media (max-width: 699px) {
          .dhc-caption { margin-top: 14px; width: 100%; }
        }

        /*
         * 1000px is arithmetic, not taste: the artwork is 80% of (viewport - 48),
         * so at 1000px it is 762px wide and a 14-unit label renders at 12px,
         * the floor for a sentence on this page. Below that the artwork's own
         * body text is 5 to 7px tall and the notes would be annotating
         * something illegible.
         */
        @media (min-width: 1000px) {
          @supports (width: 1cqw) {
            .dhc-svg { display: block; }
            .dhc-notes { display: block; }
            .dhc-caption { display: none; }

            @media (prefers-reduced-motion: no-preference) {
              /* Every hidden pre-state lives in here and is keyed off a phase
                 only client JS sets, so the stylesheet's resting state is the
                 finished state. That is what the prerender, a reduce visitor
                 and a no-JS visitor all get, immediately. */
              [data-dhc='armed'] .dhc-dot,
              [data-dhc='armed'] .dhc-note { opacity: 0; }
              [data-dhc='armed'] .dhc-lead { stroke-dasharray: 1; stroke-dashoffset: 1; }

              [data-dhc='in'] .dhc-dot {
                animation: dhcDot 180ms cubic-bezier(0.22, 1, 0.36, 1) calc(var(--i) * 120ms) both;
              }
              /* 340, not the dot's 180: the leader is 220 to 229 units long
                 now rather than 26, and at the old duration it arrives as a
                 flick rather than a draw. pathLength=1 normalises the three, so
                 they still draw in step. The note starts at 260, before the
                 leader lands, so the two read as one gesture. */
              [data-dhc='in'] .dhc-lead {
                animation: dhcLead 340ms cubic-bezier(0.22, 1, 0.36, 1) calc(var(--i) * 120ms + 100ms) both;
              }
              [data-dhc='in'] .dhc-note {
                animation: dhcNote 300ms cubic-bezier(0.22, 1, 0.36, 1) calc(var(--i) * 120ms + 260ms) both;
              }
            }
          }
        }

        @keyframes dhcDot {
          from { opacity: 0; scale: 0.4; }
          to { opacity: 1; scale: 1; }
        }
        /* pathLength=1 makes this a length-independent draw that starts at the
           path's own start point, which is the dot: the leader grows outward
           from the feature into the margin, through the elbow, to the label.
           stroke-dasharray is set here and in the armed state rather than on
           the element, so a leader that is not mid-animation carries no dash
           property at all and cannot be anything but solid. */
        @keyframes dhcLead {
          from { stroke-dasharray: 1; stroke-dashoffset: 1; }
          to { stroke-dasharray: 1; stroke-dashoffset: 0; }
        }
        @keyframes dhcNote {
          from { opacity: 0; translate: ${(6 / DHC_ART_W) * 100}cqw -50%; }
          to { opacity: 1; translate: 0 -50%; }
        }
      `}</style>
      <DocsFeatureCopy block={closingBlock} />
      <style>{`
        /*
         * The window is pushed to the right of the column and narrowed to
         * hold its old rendered size. Both are for the labels: they hang off
         * the artwork's left edge and need DHC_LABEL_W - DHC_LABEL_R of room
         * there, and at 80% and centred they had about 111px of column margin
         * to do it in and were spilling into the page's own gutter.
         *
         * 74% right-aligned gives them roughly 290px instead. The window
         * itself barely changes size: it used to be 801 units of an 884-unit
         * artwork -- 90.6% of 80% of the column -- and it is now the whole of
         * 74%, which is within a couple of percent of where it was.
         */
        .dhc-art {
          margin-left: auto;
          margin-right: 0;
          width: 74%;
        }
        /* On the img, not the figure: the figure carries the bloom and the
           reveal, and masking it would take a bite out of both. */
        .dhc-art img {
          -webkit-mask-image: ${DHC_CHROME_FADE};
          mask-image: ${DHC_CHROME_FADE};
          -webkit-mask-repeat: no-repeat;
          mask-repeat: no-repeat;
        }
        @media (max-width: 999px) {
          /* Below the gate the callouts are gone and the caption carries the
             notes, so the window has no reason to sit off-centre. */
          .dhc-art { margin-right: auto; width: 80%; }
        }
        @media (max-width: 699px) {
          .dhc-art { width: 100%; }
        }
      `}</style>
      <div
        style={{
          'box-sizing': 'border-box',
          margin: '0 auto',
          // The gap DocsFeatureBand puts between a copy header and its
          // graphic. This section supplies its own because it is not a band.
          'margin-top': mobile() ? '40px' : '68px',
          'max-width': 'var(--page-max)',
          'padding-inline': mobile() ? '18px' : '24px',
          width: '100%',
        }}
      >
        <div class="feat-lite-hero-art dhc-art" data-dhc={phase()} ref={figure}>
          <img
            src={docsHeroUrl}
            alt="A Macro document @linking last week's notes, four tasks, an email and a channel, with teammate and agent cursors in the text."
            draggable={false}
          />
          {/* Geometry in one overlay in the asset's own units. The asset
              carries width and height alongside its viewBox and the img is
              width:100%/height:auto, so the container box is exactly 884:570
              and one user unit is one artwork unit at every width. Nothing is
              measured, so the page's scale factor never enters. */}
          {/* No width/height attributes: .dhc-svg sets both, and an SVG
              geometry attribute would outrank the inset pair it is sized from.
              See the rule for what that cost. */}
          <svg
            class="dhc-svg"
            viewBox={`${-DHC_MARGIN} 0 ${DHC_ART_W + DHC_MARGIN} ${DHC_ART_H}`}
            fill="none"
            aria-hidden="true"
          >
            {/* No vector-effect: non-scaling-stroke resolves a dash pattern in
                device space, which turned the pathLength=1 draw into a 1px
                dotted line. Without it the stroke scales with the artwork, the
                same as the dot's radius and the label's font size. */}
            <g
              stroke="var(--dhc-ink)"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
              /* 0.6, not the /email figure's 0.45. A leader stays subordinate
                 to the dot it leaves and the sentence it arrives at, but at
                 0.45 over this ground it painted out to #754d2f -- a brown at
                 2.71:1, reading as a faded line rather than a quiet one. */
              opacity="0.6"
            >
              <For each={DOCS_HERO_NOTES}>
                {(note, i) => (
                  <path
                    class="dhc-lead"
                    /* Math.abs on the elbow's x, signed on its y: a negative
                       drop angles the leader UP, but it still has to travel
                       LEFT to reach the label, so only the vertical term takes
                       the sign. */
                    d={`M${DHC_DOT_X} ${note.y}L${DHC_DOT_X - Math.abs(note.drop)} ${note.y + note.drop}H${note.leadEnd}`}
                    pathLength="1"
                    style={{ '--i': String(i()) }}
                  />
                )}
              </For>
            </g>
            <g fill="var(--dhc-ink)">
              <For each={DOCS_HERO_NOTES}>
                {(note, i) => (
                  <circle
                    class="dhc-dot"
                    cx={DHC_DOT_X}
                    cy={note.y}
                    r="3.5"
                    style={{ '--i': String(i()) }}
                  />
                )}
              </For>
            </g>
          </svg>
          <ul class="dhc-notes" aria-label="Notes on this figure">
            <For each={DOCS_HERO_NOTES}>
              {(note, i) => (
                <li
                  class="dhc-note"
                  style={{
                    '--i': String(i()),
                    // A width, not a max-width. The box is offset from the
                    // right past its own containing block, so shrink-to-fit has
                    // nothing left to fit in and collapses the label to its
                    // longest word. Right-aligned text makes the stated width
                    // look identical to a fitted one anyway.
                    width: `${(DHC_LABEL_W / DHC_ART_W) * 100}cqw`,
                    // The note's own drop, so the label centres on the flat
                    // run that reaches it rather than on the dot it came from.
                    top: `${((note.y + note.drop) / DHC_ART_H) * 100}%`,
                  }}
                >
                  <span class="dhc-note-text">
                    <Show when={note.eyebrow}>
                      <span class="dhc-note-eyebrow">{note.eyebrow}</span>
                    </Show>
                    {note.label()}
                  </span>
                </li>
              )}
            </For>
          </ul>
        </div>
        <ul class="dhc-caption" aria-label="Notes on this figure">
          {/* The sentence is wrapped rather than dropped straight into the li,
              because the li is a flex row -- that is how the bullet gets its
              8px -- and a label carrying an <em> arrives as three nodes, which
              flex would otherwise lay out as three items with a gap between
              each. One span, one flex item, one sentence that wraps normally. */}
          <For each={DOCS_HERO_NOTES}>
            {(note) => (
              <li>
                <span>{note.label()}</span>
              </li>
            )}
          </For>
        </ul>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export const RouteDocuments: Component = () => {
  setPageSeo({
    title: 'Macro Docs — Markdown Documents, Wired Into Everything',
    description:
      'Markdown-native, real-time, @linked documents that replace Notion, tied to your tasks, email, channels, and agents through one unified workspace.',
    path: '/documents',
  });

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
        /* Blink for the live carets in the collab / agent-edit graphics. */
        @media (prefers-reduced-motion: no-preference) {
          @keyframes docsCollabBlink { 0%, 55% { opacity: 1; } 56%, 100% { opacity: 0.25; } }
          .docs-collab-caret { animation: docsCollabBlink 1s steps(1) infinite; }
        }
        @media (hover) {
          .docs-final-cta:hover { transform: scale(1.02); }
        }
        ${featureLiteStyles()}
      `}</style>

      <SectionFeatureLite
        eyebrow="Macro Docs"
        headline={
          <>
            {docsHeadlineLines[0]}
            <br />
            {docsHeadlineLines[1]}
          </>
        }
        typedLines={docsHeadlineLines}
        sub="Agent-editable, collaborative, @linked, version-controlled, mobile-friendly, markdown-native documents."
        ctaButtonName="documents_hero_connect_google"
        cards={docsCards}
        cardsRoomy
        heroFigure={HeroLiveDoc}
        afterHero={<PowerInSimplicity />}
      />

      <HomeSectionRule />

      {/* Markdown, demonstrated — the panel types itself and the syntax
          resolves into the blocks and links it stands for. No graphicMaxWidth:
          the frame runs the page's own column, as the tasks page's lifecycle
          stage does, and caps the document inside itself. */}
      <DocsFeatureBand block={markdownBlock} graphic={DocsMarkdownGraphic} />

      <HomeSectionRule />

      {/* The integration thesis — hero statement over the @mention cycle */}
      <DocsIntegrationHero />

      <HomeSectionRule />

      {/* Agents as teammates — copy left, graphic right */}
      <DocsFeatureBand
        block={agentTeammateBlock}
        graphic={DocsAgentTeammateGraphic}
        bleed
      />

      <HomeSectionRule />

      {/* Version history — full-bleed timeline band under its own copy */}
      <VersionHistorySection />

      <HomeSectionRule />

      {/* The workspace shot that used to lead the page, now a closing figure
          before the comparison — the same 80%-and-bloom treatment the hero
          gives its artwork, so it reads as a deliberate second beat. */}
      <DocsClosingFigure />

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
        <DocsFinalCta />
      </div>

      {/* Divider + footer */}
      <div
        style={{
          'padding-bottom': mobile() ? '40px' : '48px',
          'padding-inline': mobile() ? '18px' : '24px',
        }}
      >
        <SectionMoreFeatures currentPath="/documents" footerOnly />
      </div>
    </div>
  );
};
