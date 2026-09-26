import {
  type Component,
  createSignal,
  For,
  type JSX,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import ChatAgentCatchup from '../../assets/graphics/chat-agent-catchup.svg';
import ChatFigAgentSummary from '../../assets/graphics/chat-fig-agent-summary.svg';
import ChatFigCreateTask from '../../assets/graphics/chat-fig-create-task.svg';
import ChatFigRadial from '../../assets/graphics/chat-fig-radial.svg';
import ChatMentionCycle from '../../assets/graphics/chat-mention-cycle.svg';
import LogoDiscord from '../../assets/icons/logo-discord.svg';
import LogoMicrosoftTeams from '../../assets/icons/logo-microsoft-teams.svg';
import LogoSlack from '../../assets/icons/logo-slack.svg';
import { AgentThreadGraphic } from '../components/featureGraphics/AgentThreadGraphic';
import { ChannelPreviewGraphic } from '../components/featureGraphics/ChannelPreviewGraphic';
import {
  type ChannelsHeroPanelProps,
  ChatClosingAgentPanel,
  ChatClosingChannelPanel,
  ChatHeroAgentPanel,
  ChatHeroChannelPanel,
} from '../components/featureGraphics/ChannelsHeroGraphic';
import {
  type ComparisonColumn,
  ComparisonLegend,
  type ComparisonRow,
  ComparisonTable,
} from '../components/sections/ComparisonTable';
import { HeroEyebrow } from '../components/sections/HeroEyebrow';
import { HomeHeroBackdrop } from '../components/sections/HomeAppPreview';
import { HomeSectionRule } from '../components/sections/HomeSectionRule';
import {
  dataSecurityFaqItem,
  type FaqItem,
  SectionFaq,
} from '../components/sections/SectionFaq';
import { SectionMoreFeatures } from '../components/sections/SectionMoreFeatures';
import { TasksLifecycle } from '../components/sections/TasksLifecycle';
import { breakpoint, viewportWidth } from '../utils/utilBreakpoint';
import { CtaIcon, ctaHref, ctaLabel, handleCtaClick } from '../utils/utilCta';
import { setPageSeo } from '../utils/utilSeo';
import { createVisible } from '../utils/utilVisible';

const mobile = () => viewportWidth() < 700;

// ---------------------------------------------------------------------------
// CTAs — matching the email page's pill language: the primary is the `--c1`
// pill, the secondary the quiet bordered "Watch demo" pill (here an anchor to
// the inline demo video further down the page).
// ---------------------------------------------------------------------------

function ConnectGoogleButton(props: { buttonName: string; large?: boolean }) {
  return (
    <a
      href={ctaHref()}
      class="channels-cta-button"
      onClick={(event) => handleCtaClick(event, props.buttonName)}
      style={{
        'align-items': 'center',
        'background-color': 'var(--c1)',
        border: '1px solid transparent',
        'border-radius': '999px',
        'box-sizing': 'border-box',
        color: 'var(--b0)',
        cursor: 'default',
        display: 'inline-flex',
        'font-family': 'body',
        'font-size': props.large ? (mobile() ? '16px' : '17px') : '14px',
        'font-weight': '700',
        gap: props.large ? '8px' : '7px',
        height: props.large ? (mobile() ? '46px' : '48px') : '30px',
        'justify-content': 'center',
        'letter-spacing': '0.01em',
        'line-height': 1,
        overflow: 'hidden',
        padding: props.large ? '0 28px' : '0 18px',
        'text-decoration': 'none',
        transition: 'transform 160ms ease',
        'white-space': 'nowrap',
      }}
    >
      <CtaIcon size={props.large ? 16 : 15} opacity={0.9} />
      {ctaLabel('Connect with Google')}
    </a>
  );
}

// The demo this page used to embed inline; it now plays in the hero modal,
// matching the email/tasks/calls pages.
const HERO_DEMO_VIDEO_ID = '1gDOXUxHo0U';

function WatchDemoLink(props: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      class="channels-cta-button"
      style={{
        'align-items': 'center',
        'background-color': 'color-mix(in srgb, var(--b2) 80%, var(--b0))',
        border: '1px solid color-mix(in srgb, var(--b4) 28%, transparent)',
        'border-radius': '999px',
        'box-sizing': 'border-box',
        color: 'var(--c1)',
        cursor: 'pointer',
        display: 'inline-flex',
        'font-family': 'body',
        'font-size': '14px',
        'font-weight': '700',
        gap: '7px',
        height: '30px',
        'justify-content': 'center',
        'letter-spacing': '0.02em',
        'line-height': 1,
        padding: '0 14px',
        'text-decoration': 'none',
        transition: 'border-color 220ms ease, transform 160ms ease',
        'white-space': 'nowrap',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          'border-bottom': '4px solid transparent',
          'border-left': '7px solid var(--a0)',
          'border-top': '4px solid transparent',
          display: 'block',
          height: '0',
          width: '0',
        }}
      />
      Watch demo
    </button>
  );
}

// ---------------------------------------------------------------------------
// Hero — the email/tasks hero pattern: a sparse left-aligned text column over
// the shared backdrop, then the full-width chat composition tilted in 3D so
// the DM panel (on the right) rotates toward the viewer.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Panel lighting — the treatment the /email mockups wear: EmailTurboInbox's
// .turbo-frame rim over EmailGraphics' surface wash. A soft light pools at the
// top-left, a gentle shade gathers at the bottom-right, and a hairline rim
// catches the light along the top-left edge, glancing off the bottom-right.
// Laid over the SVG rather than baked into it, so re-exporting the artwork
// from Figma keeps it.
// ---------------------------------------------------------------------------

// The rounded corners belong to the artwork, so the overlay has to match them
// at whatever size the panel renders. A percentage radius resolves against the
// box's own width and height, and the aspect ratio is fixed by the artboard —
// so w% / h% lands on a circular corner of exactly rx user units at every
// scale, with nothing to measure.
const artRadius = (w: number, h: number, rx = 14.5) =>
  `${((rx / w) * 100).toFixed(4)}% / ${((rx / h) * 100).toFixed(4)}%`;

function PanelLighting(props: { radius: string; inset?: string }) {
  const box = (): JSX.CSSProperties => ({
    'border-radius': props.radius,
    inset: props.inset ?? '0',
    'pointer-events': 'none',
    position: 'absolute',
    'z-index': 3,
  });
  return (
    <>
      <span aria-hidden="true" style={{ ...box(), background: PANEL_WASH }} />
      <span aria-hidden="true" class="channels-panel-rim" style={box()} />
    </>
  );
}

const PANEL_WASH =
  'radial-gradient(125% 115% at 0% 0%, color-mix(in srgb, var(--ambient-ink) 5%, transparent) 0%, ' +
  'color-mix(in srgb, var(--ambient-ink) 2%, transparent) 22%, transparent 52%), ' +
  'radial-gradient(130% 118% at 100% 100%, color-mix(in srgb, var(--b0) 26%, transparent) 0%, ' +
  'color-mix(in srgb, var(--b0) 9%, transparent) 28%, transparent 58%)';

// ---------------------------------------------------------------------------
// The stage the hero panels sit on. Two modes: standing on a lit floor --
// an up-light behind them, each panel with its own cast and contact shadow,
// which is the top hero; or `floating`, where there is no floor at all and
// the depth comes from the panels' offsets and one soft drop each, which is
// the closing hero.
// ---------------------------------------------------------------------------

function HeroPanelStage(props: {
  panels: HeroPanel[];
  shafts?: boolean;
  floating?: boolean;
}) {
  // Full-width band below the text intro, with a soft light pool behind so the
  // windows lift off the near-black background.
  return (
    <div
      style={{
        'box-sizing': 'border-box',
        display: 'grid',
        'justify-items': 'center',
        /* The tall desktop lead-in is headroom for the light shafts, which
         rise well above the panels. Floating panels have none, so the gap
         under the heading closes up. */
        'padding-block': mobile()
          ? '40px 24px'
          : props.floating
            ? '90px 56px'
            : '186px 56px',
        'padding-inline': mobile() ? '18px' : '24px',
        position: 'relative',
        width: '100%',
        overflow: 'visible',
      }}
    >
      {/* Light behind the windows so they pop off the near-black page. On
        desktop it's a directional neutral up-light: a bottom-to-top linear
        wash, brightest at the hero's bottom edge and stopping exactly
        there (it must not bleed into the next section), rising to near
        the panel tops, with masked side edges so the band has no hard
        vertical cutoffs; mobile keeps the quieter centered pool. */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: mobile() ? '8% 0' : '-6% 0 0',
          background:
            mobile() || props.floating
              ? props.floating && !mobile()
                ? /* Floating panels have no floor to light, so the backdrop is an
                 ambient pool centred on the pair instead of a wash rising
                 from the section's bottom edge. */
                  'radial-gradient(58% 62% at 50% 46%, color-mix(in srgb, var(--ambient-ink) 7%, transparent) 0%, color-mix(in srgb, var(--ambient-ink) 3.5%, transparent) 40%, transparent 74%)'
                : 'radial-gradient(56% 64% at 60% 44%, color-mix(in srgb, var(--ambient-ink) 5%, transparent) 0%, color-mix(in srgb, var(--ambient-ink) 4%, transparent) 42%, transparent 70%)'
              : /* Pixel stops so the brightest band spans both base lines.
               The DM sits on the container's 56px bottom padding and the
               channel steps 12px nearer, so the plateau runs 42-58px above
               the hero's end; without that the lit floor falls below the
               panels and their shadows have nothing to read against.

               Above the plateau it is a long, low falloff rather than a
               pool: 760px to reach nothing, against the 460 it ran at, and
               a peak of 0.13 against 0.19. The light should read as the room
               the panels are standing in, not as a lamp behind them. */
                'linear-gradient(to top, transparent 0, rgb(255 255 255 / 0.04) 24px, rgb(255 255 255 / 0.13) 42px, rgb(255 255 255 / 0.13) 58px, rgb(255 255 255 / 0.105) 180px, rgb(255 255 255 / 0.065) 360px, rgb(255 255 255 / 0.028) 560px, transparent 760px)',
          'mask-image':
            mobile() || props.floating
              ? 'none'
              : 'linear-gradient(to right, transparent 0%, black 16%, black 84%, transparent 100%)',
          '-webkit-mask-image':
            mobile() || props.floating
              ? 'none'
              : 'linear-gradient(to right, transparent 0%, black 16%, black 84%, transparent 100%)',
          'pointer-events': 'none',
          'z-index': 0,
        }}
      />
      {/* Labeled sub-heroes side by side: DMs and Channels (dominant). On
        mobile they stack, channels first. */}
      <div
        style={{
          position: 'relative',
          width: '100%',
          'max-width': mobile() ? '440px' : '1120px',
          'z-index': 1,
        }}
      >
        <div
          style={{
            'align-items': mobile() ? 'stretch' : 'end',
            display: 'flex',
            'flex-direction': mobile() ? 'column' : 'row',
            gap: mobile() ? '36px' : '2%',
            'justify-content': 'center',
            width: '100%',
          }}
        >
          <For each={props.panels}>
            {(panel) => (
              <figure
                style={{
                  display: 'grid',
                  gap: mobile() ? '12px' : '16px',
                  'justify-items': 'center',
                  margin: mobile() ? '0 auto' : '0',
                  'max-width': mobile() ? panel.mobileMax : 'none',
                  left: mobile() ? undefined : `${panel.offset.x}px`,
                  'margin-left':
                    !mobile() && panel.overlap?.side === 'left'
                      ? panel.overlap.amount
                      : undefined,
                  'margin-right':
                    !mobile() && panel.overlap?.side === 'right'
                      ? panel.overlap.amount
                      : undefined,
                  position: 'relative',
                  top: mobile() ? undefined : `${panel.offset.y}px`,
                  /* A shallow turn about the upright axis. With perspective() in
                   the transform list the vanishing point sits at the element's
                   transform-origin. Held a quarter of the way up rather than on
                   the floor: the panels' vertical stagger already implies the
                   eye sits a little above their feet, so the bottoms stay
                   nearly flat while the tops carry most of the convergence.
                   The tilt also makes each panel its own stacking context,
                   which is why `layer` sets the paint order. */
                  transform:
                    !mobile() && panel.tilt
                      ? `perspective(1900px) rotateY(${panel.tilt}deg)`
                      : undefined,
                  'transform-origin':
                    !mobile() && panel.tilt ? '50% 75%' : undefined,
                  width: mobile() ? '100%' : panel.width,
                  'z-index': panel.layer,
                }}
              >
                {/* The card + its grounding shadow: a rounded translucent
                  bar sitting BEHIND the card's lower portion — slightly
                  wider than the card, blurred, and lifted so the blur
                  fringe hugs the bottom edge instead of dispersing
                  below it. */}
                <div style={{ position: 'relative', width: '100%' }}>
                  {/* Periwinkle light shaft rising from behind the card, anchored near
                    its base so only its upper reach clears the top edge. Fixed px, so
                    every panel's beam matches whatever the panel's size. */}
                  <Show when={props.shafts}>
                    <span
                      aria-hidden="true"
                      style={{
                        inset: '0',
                        'pointer-events': 'none',
                        position: 'absolute',
                      }}
                    >
                      <span
                        style={{
                          background:
                            'linear-gradient(to top, rgb(178 192 255 / 0.62) 0%, rgb(170 185 255 / 0.28) 55%, transparent 90%)',
                          bottom: '48px',
                          display: 'block',
                          filter: 'blur(9px)',
                          height: '560px',
                          left: '50%',
                          position: 'absolute',
                          transform: 'translateX(-50%)',
                          width: '14px',
                        }}
                      />
                    </span>
                  </Show>
                  {/* On the floor: the panel blocks the up-light and throws a
                    shadow along it. Off it: one soft drop instead, since
                    nothing is there to catch a cast shadow. */}
                  <Show when={!props.floating}>
                    {/* Cast shadow: the panel blocking the up-light, thrown
                      out along the floor. Height is fixed rather than a
                      percentage so it hugs the base identically whatever
                      the panel's size, and the shape is a radial falloff
                      rather than a clipped polygon so its sides dissolve
                      instead of ending on a hard diagonal. */}
                    <span
                      aria-hidden="true"
                      style={{
                        /* Vertical density only — a centre-anchored radial
                         would double up with the mask below and leave the
                         wings (the only visible part) near-transparent. */
                        background:
                          'linear-gradient(to top, rgb(0 0 0 / 0.88) 0%, rgb(0 0 0 / 0.55) 34%, rgb(0 0 0 / 0.2) 64%, transparent 92%)',
                        bottom: `${panel.shadowLift ?? 0}px`,
                        display: 'block',
                        filter: 'blur(10px)',
                        height: '26px',
                        /* Horizontal taper: dense behind the panel, then a
                         long many-stepped dispersal out through the wings,
                         so the ends dissolve rather than stopping on an
                         edge. Reaches wider than the panel to give that
                         falloff room to run. */
                        'mask-image': castShadowMask(
                          mobile() ? null : (panel.shadowInner?.side ?? null),
                          panel.shadowInner?.damp ?? 1
                        ),
                        '-webkit-mask-image': castShadowMask(
                          mobile() ? null : (panel.shadowInner?.side ?? null),
                          panel.shadowInner?.damp ?? 1
                        ),
                        left: '-34%',
                        'pointer-events': 'none',
                        position: 'absolute',
                        right: '-34%',
                      }}
                    />
                    <span
                      aria-hidden="true"
                      style={{
                        /* Density radiates from the shadow's bottom-center:
                         crispest where it meets the card's bottom edge,
                         with a long gentle dissolve out to the wing tips. */
                        background:
                          'radial-gradient(56% 105% at 50% 100%, rgb(0 0 0 / 0.92) 0%, rgb(0 0 0 / 0.66) 26%, rgb(0 0 0 / 0.38) 48%, rgb(0 0 0 / 0.17) 70%, rgb(0 0 0 / 0.06) 86%, transparent 100%)',
                        /* Flat elliptical end caps, wide enough to give the
                         gradient room to taper through the tips. */
                        'border-radius': '64px / 3.5px',
                        bottom: `${1 + (panel.shadowLift ?? 0)}px`,
                        display: 'block',
                        filter: 'blur(4px)',
                        height: '15px',
                        left: '-11%',
                        'pointer-events': 'none',
                        position: 'absolute',
                        right: '-11%',
                      }}
                    />
                  </Show>
                  <Show when={props.floating}>
                    {/* Depth without a ground plane: a wide low-opacity drop
                      under the panel and a tighter one hugging its edge, both
                      straight down. No blur filter and no background on the
                      span -- box-shadow paints outside the border box on its
                      own, and a filter here would shadow the artwork's every
                      glyph rather than the panel's silhouette. */}
                    <span
                      aria-hidden="true"
                      style={{
                        'border-radius': panel.radius,
                        'box-shadow':
                          '0 38px 80px rgb(0 0 0 / 0.58), 0 10px 24px rgb(0 0 0 / 0.38)',
                        inset: '0',
                        'pointer-events': 'none',
                        position: 'absolute',
                      }}
                    />
                  </Show>
                  <Dynamic
                    component={panel.Graphic}
                    role="img"
                    aria-label={panel.alt}
                    style={{
                      display: 'block',
                      height: 'auto',
                      position: 'relative',
                      width: '100%',
                      'z-index': 2,
                    }}
                  />
                  <PanelLighting radius={panel.radius} />
                </div>
              </figure>
            )}
          </For>
        </div>
      </div>
    </div>
  );
}

// The hero's two sub-sections. Desktop widths keep the artboards near their
// natural relative scale (350 and 600px wide) with channels dominant;
// stacked (mobile) order leads with channels instead.
type HeroPanel = {
  label: string;
  /** Real DOM so the hero can animate and its UI text stays crisp at scale. */
  Graphic: Component<ChannelsHeroPanelProps>;
  alt: string;
  width: string;
  mobileMax: string;
  /** Corner radius of the artwork's own frame, for the lighting overlay. */
  radius: string;
  /** Depth nudge, applied as position rather than transform so the shadows
      stay in one shared stacking context (see the figure below). */
  offset: { x: number; y: number };
  /** Lifts this panel's shadows off its base line, in px. */
  shadowLift?: number;
  /** Which wing faces the neighbouring panel, and how far to damp it. */
  shadowInner?: { side: 'left' | 'right' | 'both'; damp: number };
  /** Degrees about the upright axis; positive turns the face to the right. */
  tilt?: number;
  /** Pulls the panel toward its neighbour, in % of the row. */
  overlap?: { side: 'left' | 'right'; amount: string };
  /** Paint order once the panels overlap — the middle one sits on top. */
  layer?: number;
};

// Underlines in the graphics are drawn rather than typeset. Figma exports them
// as text-decoration="underline", and Chrome ignores text-decoration-thickness
// and text-underline-offset on SVG <text> — they compute to `auto` even when set
// inline — so the only way to control weight and offset is to draw the rule.
// Runs once per graphic after the webfont settles, since the measured width
// depends on it. Geometry is in user units, so it holds at any rendered scale.
const SVG_NS = 'http://www.w3.org/2000/svg';
// Thickness tracks the type, as an underline should, but never thins below a
// device pixel — the graphics render at scales from ~0.8x to ~2.7x, and a
// purely type-relative rule fell to 0.33px on the smallest and vanished.
const UNDERLINE_THICKNESS = 0.05; // of the run's font size
const UNDERLINE_MIN_PX = 1.15;
const UNDERLINE_OFFSET = 0.13; // below the baseline, of the font size
const UNDERLINE_SKIP = 0.1; // clearance punched around descenders
let underlineId = 0;

function drawSvgUnderlines(root: ParentNode) {
  for (const text of root.querySelectorAll<SVGTextElement>(
    'svg text[text-decoration="underline"]'
  )) {
    const svg = text.ownerSVGElement;
    const tspan = text.querySelector<SVGTSpanElement>('tspan');
    const size = Number(text.getAttribute('font-size')) || 10;
    let x: number, baseline: number, width: number;
    try {
      width = tspan
        ? tspan.getComputedTextLength()
        : text.getComputedTextLength();
      x = Number(tspan?.getAttribute('x') ?? text.getAttribute('x') ?? NaN);
      baseline = Number(
        tspan?.getAttribute('y') ?? text.getAttribute('y') ?? NaN
      );
    } catch {
      continue;
    }
    if (!svg || !width || Number.isNaN(x) || Number.isNaN(baseline)) continue;

    const y = baseline + size * UNDERLINE_OFFSET;

    // Stroked line with a non-scaling stroke, so the width is set in CSS px and
    // does not shrink with the graphic's viewBox scale. The width itself is
    // still derived from the type size, so bigger art gets a proportionally
    // heavier rule, with a floor so the smallest never disappears.
    const vb = svg.viewBox.baseVal;
    const scale = vb?.width ? svg.getBoundingClientRect().width / vb.width : 1;
    const strokePx = Math.max(
      size * UNDERLINE_THICKNESS * scale,
      UNDERLINE_MIN_PX
    );
    const rule = document.createElementNS(SVG_NS, 'line');
    rule.setAttribute('x1', String(x));
    rule.setAttribute('x2', String(x + width));
    rule.setAttribute('y1', String(y));
    rule.setAttribute('y2', String(y));
    rule.setAttribute('stroke', text.getAttribute('fill') ?? 'currentColor');
    rule.setAttribute('stroke-width', String(+strokePx.toFixed(2)));
    rule.setAttribute('vector-effect', 'non-scaling-stroke');

    // Skip-ink: a luminance mask showing the rule everywhere except where the
    // glyphs — outlined by a stroke to leave clearance — sit on top of it.
    underlineId += 1;
    const id = `svg-underline-${underlineId}`;
    const mask = document.createElementNS(SVG_NS, 'mask');
    mask.setAttribute('id', id);
    mask.setAttribute('maskUnits', 'userSpaceOnUse');
    // The region must be stated. It defaults to -10%..120% of the VIEWPORT,
    // not of the masked element, so any run sitting outside the viewBox is
    // masked away wholesale — which is what silently erased the underlines on
    // the scrolling list, whose rows run to y=107 inside a 51-unit viewBox.
    mask.setAttribute('x', String(x - size));
    mask.setAttribute('y', String(y - size));
    mask.setAttribute('width', String(width + size * 2));
    mask.setAttribute('height', String(size * 2));
    const show = document.createElementNS(SVG_NS, 'rect');
    show.setAttribute('x', String(x - size));
    show.setAttribute('y', String(y - size));
    show.setAttribute('width', String(width + size * 2));
    show.setAttribute('height', String(size * 2));
    show.setAttribute('fill', '#fff');
    const knockout = text.cloneNode(true) as SVGTextElement;
    knockout.removeAttribute('text-decoration');
    knockout.setAttribute('fill', '#000');
    knockout.setAttribute('stroke', '#000');
    knockout.setAttribute('stroke-width', String(size * UNDERLINE_SKIP));
    knockout.setAttribute('paint-order', 'stroke');
    mask.append(show, knockout);
    (
      svg.querySelector('defs') ??
      svg.insertBefore(document.createElementNS(SVG_NS, 'defs'), svg.firstChild)
    ).append(mask);
    rule.setAttribute('mask', `url(#${id})`);

    text.removeAttribute('text-decoration');
    text.after(rule);
  }
}

// Horizontal taper for a panel's cast shadow. The wings are the only part the
// panel doesn't cover, and the two panels' wings meet in the gap between them —
// where two translucent blacks would otherwise stack into a darker seam. So the
// wing facing the neighbour is damped: `inner` scales its alpha, pulling that
// side back so the shadows meet without compounding.
function castShadowMask(inner: 'left' | 'right' | 'both' | null, damp = 1) {
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
  const dampLeft = inner === 'left' || inner === 'both';
  const dampRight = inner === 'right' || inner === 'both';
  const left = wing.map(([pos, a]) => stop(pos, dampLeft ? a * damp : a));
  const right = [...wing]
    .reverse()
    .map(([pos, a]) => stop(100 - pos, dampRight ? a * damp : a));
  return `linear-gradient(to right, ${[...left, ...right].join(', ')})`;
}

// One definition per panel; the two heroes select from them. Both run them
// flat and facing the reader -- the top hero side by side on its floor, the
// closing hero staggered and overlapping in open space.
const heroPanel = {
  dms: {
    label: 'DMs',
    Graphic: ChatHeroAgentPanel,
    alt: 'A direct message with a Macro agent that created a task, pushed a PR, and replied in a channel',
    mobileMax: '320px',
    radius: artRadius(350, 400),
    offset: { x: 8, y: 0 },
    // Small panel, so its wing yields to the larger one in the gap.
    shadowInner: { side: 'right', damp: 0.28 },
  },
  channels: {
    label: 'Channels',
    Graphic: ChatHeroChannelPanel,
    alt: 'A Macro Chat channel with an @mention, a shared image, a shared email thread, and an @Macro agent reply',
    mobileMax: '440px',
    radius: artRadius(600, 590),
    offset: { x: 0, y: 12 },
    shadowLift: 2,
    shadowInner: { side: 'left', damp: 0.7 },
  },
} satisfies Record<string, Omit<HeroPanel, 'width'>>;

// Widths keep each pairing near the artboards' natural ratio (350 / 600).
const heroPanels = (stacked: boolean): HeroPanel[] => {
  const pair: HeroPanel[] = [
    { ...heroPanel.dms, width: '32%' },
    { ...heroPanel.channels, width: '54%' },
  ];
  return stacked ? [pair[1], pair[0]] : pair;
};

const heroClosingPair = (stacked: boolean): HeroPanel[] => {
  // Same two windows as the top hero, showing a different day: the panels
  // are the same components with a second scene, so the page closes on the
  // product it opened on without closing on the same screenshot.
  // Both panels stay flat and face the reader; the depth is positional. The
  // smaller one rides higher and tucks behind its neighbour's left edge, so
  // the pair reads as two planes at different distances rather than two
  // objects standing on a floor. `layer` sets which is in front.
  const pair: HeroPanel[] = [
    {
      ...heroPanel.dms,
      Graphic: ChatClosingAgentPanel,
      alt: 'A direct message with a Macro agent catching the reader up on a channel and filing what is unresolved as tasks',
      width: '30%',
      offset: { x: 8, y: -68 },
      overlap: { side: 'right', amount: '-5%' },
      layer: 1,
    },
    {
      ...heroPanel.channels,
      Graphic: ChatClosingChannelPanel,
      alt: 'A Macro Chat channel where a design-system sweep is handed round, linked to a doc and a task, and picked up by an agent',
      width: '50%',
      layer: 2,
    },
  ];
  return stacked ? [pair[1], pair[0]] : pair;
};

function ChannelsHero(props: { onWatchDemo: () => void }) {
  return (
    <div
      style={{
        display: 'flow-root',
        position: 'relative',
        width: '100%',
        'min-width': '0',
      }}
    >
      <HomeHeroBackdrop subtle neutral />

      <section
        style={{
          'box-sizing': 'border-box',
          display: 'grid',
          'justify-items': 'center',
          'padding-bottom': '0',
          // Desktop gutters live on the column below, not here, so the hero's
          // left edge lands on the same line as every other section's at any
          // width: those are a 1160 box with 24px of padding, and splitting
          // the two across these elements reproduces that exactly. On the
          // phone the section keeps the gutter, since the column has none.
          'padding-inline': mobile() ? '18px' : '0',
          'padding-top': '132px',
          position: 'relative',
          'z-index': 1,
          width: '100%',
        }}
      >
        <div
          style={{
            'box-sizing': 'border-box',
            display: 'grid',
            gap: mobile() ? '20px' : '26px',
            'grid-template-columns': 'minmax(0, 1fr)',
            /* Left, not centred: the hero now opens on the same edge the
               founder's letter, the integration statement and the closing
               hero all sit on, so the page reads down one line instead of
               stepping in and out. The panels below stay centred. */
            'justify-items': 'start',
            'max-width': '1160px',
            'padding-inline': mobile() ? '0' : '24px',
            'text-align': 'left',
            width: '100%',
          }}
        >
          <HeroEyebrow label="Macro Chat" mobile={mobile} />
          {/* The hero shares the homepage's Slab weight, with its own size. */}
          <h1
            style={slabTitle({
              size: mobile()
                ? 'clamp(34px, 9vw, 46px)'
                : 'clamp(48px, 4.6vw, 60px)',
              weight: '315',
            })}
          >
            <span style={titleLine(0)}>Focused chat</span>
            <span style={titleLine(1)}>for teams and agents</span>
          </h1>
          <p
            style={{
              color: 'var(--c4)',
              'font-family': 'cyberreader, body',
              'font-size': mobile() ? '16.5px' : '19px',
              'font-weight': '300',
              'line-height': 1.6,
              margin: '0',
              'max-width': mobile() ? '100%' : '64ch',
              'text-wrap': 'balance',
            }}
          >
            Integrated with your documents, emails, and tasks. <br />
            AI agents at the ready to take on tasks and catch you up.
          </p>
          <div
            style={{
              'align-items': 'center',
              display: 'flex',
              'flex-wrap': 'wrap',
              gap: '14px',
              'margin-top': mobile() ? '2px' : '6px',
            }}
          >
            <ConnectGoogleButton buttonName="channels_hero_connect_google" />
            <WatchDemoLink onClick={props.onWatchDemo} />
          </div>
        </div>
      </section>

      <HeroPanelStage panels={heroPanels(mobile())} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Founder's letter — why the product exists, in place of a demo reel. Mirrors
// the tasks page's section: one centred column that both the heading and the
// body live inside, so they share a left edge by construction rather than by
// two matching max-widths that could drift apart.
// ---------------------------------------------------------------------------

function ChannelsFounderLetter() {
  return (
    <section
      aria-label="Why we built Macro Chat"
      style={{
        'box-sizing': 'border-box',
        margin: '0 auto',
        'max-width': '1160px',
        padding: mobile() ? '56px 18px' : '112px 24px',
        width: '100%',
      }}
    >
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
            'font-size': mobile() ? '26px' : '32px',
            'font-weight': '315',
            'letter-spacing': '-0.015em',
            'line-height': 1.12,
            margin: mobile() ? '0 0 40px' : '0 0 56px',
            'text-align': 'left',
            'text-wrap': 'balance',
          }}
        >
          Great teams need great comms.
        </h2>
        <div style={{ display: 'grid', gap: mobile() ? '18px' : '22px' }}>
          {/* Cyberreader rather than the site's Rajdhani `body`: this is a
              longer read than anything else on the page, and cyberreader — a
              blend of Rajdhani's edge and Inter's readability — is what the
              home page reaches for at length. It ships as discrete faces
              rather than a variable axis, so 300 is the real Light file. */}
          <p
            style={{
              color: 'var(--c4)',
              'font-family': 'cyberreader, body',
              'font-size': mobile() ? '16.5px' : '18px',
              'font-weight': '300',
              'line-height': 1.6,
              margin: '0',
              'text-align': 'left',
              'text-wrap': 'pretty',
            }}
          >
            For too many work teams, chat is a source of distraction. It's not
            the teams' fault, it's just that most chat tools aren't well suited
            for efficient, focused work. They're islands where people talk about
            the work they do in other apps. They add social media-esque bells
            and whistles to what should be a simple, precise tool for
            communication.
            <br />
            <br />
            Macro Chat lives in the same workspace as your email, docs, and
            tasks. It removes the chasm between communication and execution with
            powerful @mentions for instant sharing, built-in task management,
            and agents that track and take on work without you having to leave
            the thread.
          </p>
          <p
            style={{
              color: 'var(--c2)',
              'font-family': 'cyberreader, body',
              'font-size': mobile() ? '16.5px' : '18px',
              'font-weight': '300',
              'line-height': 1.6,
              margin: '0',
              'text-align': 'left',
              'text-wrap': 'pretty',
            }}
          >
            - Jacob Beckerman, CEO and founder of Macro
          </p>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Second hero — the integration thesis. A hero-scale statement over the
// abstract workspace-web diagram: teammates' messages flow into a channel,
// and what they @mention flows out to email, docs, and tasks. Deliberately a
// different graphic register from the UI mockups — same line-art language as
// the fig cards, blown up to full width.
// ---------------------------------------------------------------------------

function ChannelsIntegrationHero() {
  return (
    <section
      aria-label="Deeply integrated with your workspace"
      style={{
        'box-sizing': 'border-box',
        display: 'grid',
        gap: mobile() ? '36px' : '64px',
        'justify-items': 'center',
        margin: '0 auto',
        'max-width': '1160px',
        /* Bottom-heavy now that the section has a ground of its own: the
           box's mass is all in its top half -- headline, paragraph, then a
           single strip of artwork -- so an even split pools the slack above
           the headline where there is already plenty, and leaves a thin line
           of ink sitting close to a hard edge. Half again the opening 96,
           and the phone keeps the same ratio against its 64. Matches what
           /documents settled on for the same beat. */
        padding: mobile() ? '64px 18px 96px' : '96px 24px 144px',
        position: 'relative',
        width: '100%',
        // Own stacking context, so the section lighting below (z-index -1)
        // stays scoped to this section rather than escaping into the page's
        // stacking order.
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
      {/* The widest title-to-copy gap on the page, and deliberately so:
          this block sits on its own lit ground, which closes in around the
          type and made the same number read tighter here than it does
          anywhere the section floats on the page background. */}
      <div
        style={{
          display: 'grid',
          gap: mobile() ? '20px' : '28px',
          'justify-items': 'start',
          'justify-self': 'start',
        }}
      >
        <h2 style={slabTitle()}>
          <span style={titleLine(0)}>Deeply integrated</span>
          <span style={titleLine(1)}>with your workspace.</span>
        </h2>
        <p
          style={{
            color: 'var(--c4)',
            'font-family': 'cyberreader, body',
            'font-size': mobile() ? '17px' : '19px',
            'font-weight': '300',
            'line-height': 1.6,
            margin: '0',
            'max-width': '44ch',
            opacity: 0.72,
            'text-align': 'left',
          }}
        >
          @mention a task, channel, document, email thread, agent, or company to
          share it with the whole channel.
        </p>
      </div>
      {/* The animated mention row: a chat message whose @mention window
          cycles through linkable items — the scrollme list steps up one
          12px row every few seconds (animation lives in the SVG's style). */}
      <ChatMentionCycle
        role="img"
        aria-label="A chat message @mentioning workspace items — the mention cycles through docs, tasks, charts, and people you can link to"
        style={{
          display: 'block',
          height: 'auto',
          margin: '0 auto',
          /* As large as can fit the viewport while leaving room for the
             shift below. */
          'max-width': mobile() ? '100%' : 'min(1217px, 65vw)',
          /* Radial fade centered on the cycling window (62.3% x, 63.5% y of
             the card) so the animation is the brightest thing and the card
             dissolves toward its edges. */
          'mask-image':
            'radial-gradient(72% 240% at 62.3% 63.5%, black 30%, rgb(0 0 0 / 0.55) 60%, transparent 96%)',
          '-webkit-mask-image':
            'radial-gradient(72% 240% at 62.3% 63.5%, black 30%, rgb(0 0 0 / 0.55) 60%, transparent 96%)',
          /* Two things want to be centred and cannot both be. The message
             row's ink runs x 9-295 of the 342-unit card, centred at 44.4%;
             the cycling window sits further right, centred at 61.5%. Pinning
             either one throws the other out by the full 17 points.

             So neither: the shift balances them about the section's centre
             instead, leaving each about 5.8% out on its own side. At -8% the
             animation was centred to within 2.4% but the message ink sat
             9.2% left, which read as the whole card being off-axis. The
             radial fade above already tells the eye where to look, so the
             geometry is free to serve the composition. */
          transform: mobile() ? 'none' : 'translateX(-2.7%)',
          width: '100%',
        }}
      />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Video + sub-feature cards — mirrors the tasks page's TasksFeatureCards: a
// centered statement, the inline demo (facade until clicked), then a
// three-across row of fig cards.
// ---------------------------------------------------------------------------

/* The three figures share no geometry of their own: their ink measures
   401x211, 111x111 and 534x403. Sized a width apiece they came out 568, 370
   and 462 across and 303, 366 and 375 tall -- every row a different size,
   and no two lined up on anything. Two of the three were also windows onto a
   larger drawing rather than whole pictures: the agent summary's artboard
   padded 46 units of nothing onto its left and cut 44 units off its right,
   mid-sentence, and the task figure showed 62% of its own width. Both
   artboards have since been refitted to their ink.

   What holds the three together now is the panel: one frame, the same size
   in every row, with the art contained and centred inside it. `fill` is all
   a card gets to say about size and it is a share of that frame rather than
   a width -- it evens out optical weight, since a filled disc carries
   further than an open line drawing, and it is not a way for a figure to set
   its own scale again. */
const CARD_STAGE_W = 640;
const CARD_STAGE_RATIO = '4 / 3';

const channelsCards = [
  {
    Graphic: ChatFigAgentSummary,
    /* The figure plays itself in: the four people and their messages
       arrive, their connectors run down into the agent, and the summary
       writes itself last. Keyed by class names carried in the asset. */
    anim: 'cfa',
    // Wide and open: fills the frame's width and takes the air above and
    // below, which is the shape of the drawing rather than a shortfall.
    fill: 1,
    fig: '01',
    title: 'Tag team with agents',
    desc: '@Macro summons an agent with full work context. Summarize, draft, or hand off tasks.',
  },
  {
    Graphic: ChatFigRadial,
    /* The selection travels: it comes round the ring clockwise and eases
       onto the segment it belongs to, which lights up as it lands. */
    anim: 'cfr',
    // A filled disc against two open drawings: held back so the three read
    // at the same strength rather than at the same size.
    fill: 0.88,
    fig: '02',
    title: '@mention to instantly share',
    desc: '@mention a doc, task, or email to give every member access.',
  },
  {
    Graphic: ChatFigCreateTask,
    /* Plays out the thing it is describing: the message lands, the action
       menu opens on it, the cursor presses Create Task, and the task comes
       back. */
    anim: 'cft',
    /* Over 1, so it reads at the size it did before the artboard grew
       twice to hold its shadows. The frame's 9% padding absorbs the extra,
       so nothing is clipped. */
    fill: 1.08,
    /* Its weight is all in the task card, bottom right, so the drawing
       balances left of where its bounding box says it should sit. At 2.5%
       of the artboard the message clears the frame's own padding; much
       past that and the bubble starts crowding the left edge. */
    nudge: '-2.5%',
    fig: '03',
    title: 'Turn a message into a task',
    desc: 'Any message can become a task. Create and track issues without leaving the chat.',
  },
];

function ChannelsFeatureCards() {
  return (
    <section
      style={{
        'box-sizing': 'border-box',
        margin: '0 auto',
        'max-width': '1160px',
        /* Roomier than the 80/56 it ran at, which left the three columns
           crowding the rules above and below — the sections either side of it
           sit at 96-112, so it was the tightest band on the page despite
           carrying the most. */
        padding: mobile() ? '80px 18px' : '120px 24px',
        width: '100%',
      }}
    >
      {/* The agent-summary figure's entrance. Four people say something,
          four connectors run their lines down into the trunk, the trunk
          runs into the agent, and only then does the summary appear -- the
          order the thing being described actually happens in.

          The connectors draw with stroke-dashoffset, which is why the asset
          carries stroked centrelines now: Figma had outlined them to filled
          ribbons, and a fill has no dash to offset. Every lead is
          pathLength 100, so one offset draws them all at the same rate
          whatever their length, and each runs from its own dot toward the
          trunk because that is the direction its path is authored in.

          Opacity and a small lift rather than a scale: a node is three
          separate elements (avatar, bubble, dots) and each would scale
          about its own centre, which pulls them apart on the way in. */}
      <style>{`
        .cfa .cfa-n1, .cfa .cfa-n2, .cfa .cfa-n3, .cfa .cfa-n4, .cfa .cfa-summary { opacity: 0; }
        .cfa .cfa-lead, .cfa .cfa-trunk { stroke-dasharray: 100; stroke-dashoffset: 100; }

        .cfa-play .cfa-n1 { animation: cfa-in 420ms cubic-bezier(0.22, 0.8, 0.32, 1) 120ms both; }
        .cfa-play .cfa-n2 { animation: cfa-in 420ms cubic-bezier(0.22, 0.8, 0.32, 1) 290ms both; }
        .cfa-play .cfa-n3 { animation: cfa-in 420ms cubic-bezier(0.22, 0.8, 0.32, 1) 460ms both; }
        .cfa-play .cfa-n4 { animation: cfa-in 420ms cubic-bezier(0.22, 0.8, 0.32, 1) 630ms both; }
        .cfa-play .cfa-lead1 { animation: cfa-draw 620ms cubic-bezier(0.4, 0, 0.2, 1) 380ms both; }
        .cfa-play .cfa-lead2 { animation: cfa-draw 620ms cubic-bezier(0.4, 0, 0.2, 1) 550ms both; }
        .cfa-play .cfa-lead3 { animation: cfa-draw 620ms cubic-bezier(0.4, 0, 0.2, 1) 720ms both; }
        .cfa-play .cfa-lead4 { animation: cfa-draw 620ms cubic-bezier(0.4, 0, 0.2, 1) 890ms both; }
        /* Last, and only once every lead has reached it: the trunk is the
           one segment that is four messages arriving rather than one. */
        .cfa-play .cfa-trunk { animation: cfa-draw 480ms cubic-bezier(0.4, 0, 0.2, 1) 1420ms both; }
        .cfa-play .cfa-summary { animation: cfa-in 520ms ease-out 1820ms both; }

        @keyframes cfa-in {
          from { opacity: 0; translate: 0 4px; }
          to { opacity: 1; translate: none; }
        }
        @keyframes cfa-draw {
          from { stroke-dashoffset: 100; }
          to { stroke-dashoffset: 0; }
        }
        /* The radial's selection comes round the ring. It is one wedge
           turned about the wheel's centre rather than six that take it in
           turns to light up, so -300deg is five segments back: the wedge
           starts on the lower right, travels clockwise -- rotation grows
           clockwise, the y axis pointing down -- and stops just short of a
           full turn, on the segment that is actually selected.

           It ratchets rather than sweeps. step-end holds each keyframe's
           value until the next one is due, so the wedge sits squarely on a
           segment and then jumps a whole 60deg to the next, never landing
           across a spoke. The deceleration is in the spacing rather than
           in an easing curve -- an easing function would ease the jumps,
           not the pauses. The dwells run 63, 112, 203, 364 and 658ms, each
           about 1.8 times the one before, so it leaves fast and arrives
           slowly.

           Each icon lights while the selection is over it. The groups in
           the asset paint with currentColor, so one animated color property
           carries both the stroked icons and the filled ones, and every
           keyframe pair matches a stop above: i0 is the lower right where
           the wedge starts, then round to i5, its home. Only i5 is still
           lit at the end.

           Its resting frame is the start of the trip rather than the end,
           so nothing jumps when the class arrives. */
        /* The beam is aimed at the middle of the selection's home segment
           in the asset, so it takes the same rotation, the same origin and
           the same keyframes -- it is lit from under the @ and swings with
           the selection rather than chasing it. */
        .cfr .cfr-sel,
        .cfr .cfr-glow,
        .cfr .cfr-beam {
          rotate: -300deg;
          transform-box: view-box;
          transform-origin: 55.5px 55.5px;
        }
        /* The asset draws this one orange, since it is the selected
           segment when nothing is moving. It waits its turn here. */
        .cfr .cfr-i5 { color: #BFBFBF; }

        .cfr-play .cfr-sel,
        .cfr-play .cfr-glow,
        .cfr-play .cfr-beam { animation: cfr-spin 1400ms step-end 220ms both; }
        .cfr-play .cfr-i0 { animation: cfr-i0 1400ms step-end 220ms both; }
        .cfr-play .cfr-i1 { animation: cfr-i1 1400ms step-end 220ms both; }
        .cfr-play .cfr-i2 { animation: cfr-i2 1400ms step-end 220ms both; }
        .cfr-play .cfr-i3 { animation: cfr-i3 1400ms step-end 220ms both; }
        .cfr-play .cfr-i4 { animation: cfr-i4 1400ms step-end 220ms both; }
        .cfr-play .cfr-i5 { animation: cfr-i5 1400ms step-end 220ms both; }

        @keyframes cfr-spin {
          0% { rotate: -300deg; }
          4.5% { rotate: -240deg; }
          12.5% { rotate: -180deg; }
          27% { rotate: -120deg; }
          53% { rotate: -60deg; }
          100% { rotate: 0deg; }
        }
        @keyframes cfr-i0 {
          0% { color: #FF8F00; }
          4.5% { color: #BFBFBF; }
        }
        @keyframes cfr-i1 {
          0% { color: #BFBFBF; }
          4.5% { color: #FF8F00; }
          12.5% { color: #BFBFBF; }
        }
        @keyframes cfr-i2 {
          0% { color: #BFBFBF; }
          12.5% { color: #FF8F00; }
          27% { color: #BFBFBF; }
        }
        @keyframes cfr-i3 {
          0% { color: #BFBFBF; }
          27% { color: #FF8F00; }
          53% { color: #BFBFBF; }
        }
        @keyframes cfr-i4 {
          0% { color: #BFBFBF; }
          53% { color: #FF8F00; }
          100% { color: #BFBFBF; }
        }
        @keyframes cfr-i5 {
          0% { color: #BFBFBF; }
          100% { color: #FF8F00; }
        }

        /* The third figure is a sequence rather than an entrance: every
           beat waits on the one before it, because the point is the order
           things happen in. The cursor carries its own arrival and its
           press in one animation -- it travels in over the first 62%, dips
           1.5 units into the button at 70%, and lifts off again -- so the
           press cannot drift away from the arrival the way two separately
           delayed animations would. The button's own squash is timed to
           that dip, and the task only appears after it. */
        .cft .cft-msg, .cft .cft-menu, .cft .cft-cursor, .cft .cft-task { opacity: 0; }
        .cft .cft-btn { transform-box: fill-box; transform-origin: center; }
        /* Until the task exists there is nothing to sit beside, so the
           message holds the middle of the card: 116.75 175.25 is the gap
           between the message's own centre and the artboard's. It gives the
           space back on the way out, as the task comes in. */
        .cft .cft-stage { translate: 116.75px 175.25px; }

        .cft-play .cft-msg { animation: cft-in 420ms cubic-bezier(0.22, 0.8, 0.32, 1) 120ms both; }
        .cft-play .cft-menu { animation: cft-open 300ms cubic-bezier(0.22, 0.8, 0.32, 1) 720ms both; }
        .cft-play .cft-cursor { animation: cft-point 900ms cubic-bezier(0.33, 0, 0.2, 1) 1020ms both; }
        .cft-play .cft-btn { animation: cft-press 240ms ease-out 1640ms both; }
        .cft-play .cft-stage { animation: cft-settle 460ms cubic-bezier(0.4, 0, 0.2, 1) 1700ms both; }
        .cft-play .cft-task { animation: cft-in 520ms cubic-bezier(0.22, 0.8, 0.32, 1) 1920ms both; }

        @keyframes cft-in {
          from { opacity: 0; translate: 0 5px; }
          to { opacity: 1; translate: none; }
        }
        /* Down out of the message it belongs to, not up off the page. */
        @keyframes cft-open {
          from { opacity: 0; translate: 0 -4px; }
          to { opacity: 1; translate: none; }
        }
        @keyframes cft-point {
          0% { opacity: 0; translate: 16px 13px; }
          22% { opacity: 1; }
          62% { opacity: 1; translate: none; }
          70% { translate: 1.5px 1.2px; }
          80% { translate: none; }
          100% { opacity: 1; translate: none; }
        }
        @keyframes cft-press {
          0% { scale: 1; }
          40% { scale: 0.955; }
          100% { scale: 1; }
        }
        @keyframes cft-settle {
          from { translate: 116.75px 175.25px; }
          to { translate: none; }
        }

        @media (prefers-reduced-motion: reduce) {
          .cfa .cfa-n1, .cfa .cfa-n2, .cfa .cfa-n3, .cfa .cfa-n4, .cfa .cfa-summary {
            animation: none;
            opacity: 1;
          }
          .cfa .cfa-lead, .cfa .cfa-trunk { animation: none; stroke-dashoffset: 0; }
          .cfr .cfr-sel, .cfr .cfr-glow, .cfr .cfr-beam { animation: none; rotate: 0deg; }
          .cfr .cfr-i0, .cfr .cfr-i1, .cfr .cfr-i2,
          .cfr .cfr-i3, .cfr .cfr-i4, .cfr .cfr-i5 { animation: none; }
          .cfr .cfr-i5 { color: #FF8F00; }
          .cft .cft-msg, .cft .cft-menu, .cft .cft-cursor, .cft .cft-task {
            animation: none;
            opacity: 1;
          }
          .cft .cft-btn { animation: none; }
          .cft .cft-stage { animation: none; translate: none; }
        }
      `}</style>

      <div
        style={{
          display: 'grid',
          'grid-template-columns': 'minmax(0, 1fr)',
          width: '100%',
        }}
      >
        <For each={channelsCards}>
          {(card, index) => {
            /* Alternating sides. Odd rows put the copy on the left, even
               rows on the right, which is what keeps three rows of the same
               shape from reading as a list. Both halves are placed by grid
               column rather than by DOM order, so the source order stays
               graphic-then-copy -- which is the order the phone stacks them
               in, and the order a screen reader gets either way. */
            const flip = () => !mobile() && index() % 2 === 1;
            /* The animation rides the class, so dropping the class resets
               it: scroll away and every element returns to its resting
               frame, scroll back and it plays from the top.

               The margin is asymmetric on purpose. Pulling the root's
               bottom edge up 30% holds the start until a good part of the
               frame is actually on screen, rather than firing the moment
               its top edge clears the fold and letting the reader arrive
               halfway through. The top edge is left alone so the reset
               happens once the figure is properly gone -- inset there too,
               it would blink back to nothing while still in view. */
            let frameEl: HTMLDivElement | undefined;
            const playing = createVisible(() => frameEl, '0px 0px -30% 0px');
            return (
              <article
                style={{
                  'align-items': 'center',
                  /* No rule between the rows any more: the panels are the
                     rhythm, and a hairline between two framed blocks read
                     as a third edge competing with them. */
                  'box-sizing': 'border-box',
                  'column-gap': mobile() ? '0' : '56px',
                  display: 'grid',
                  /* Not a half each: the figures are the argument here and
                     the copy is a caption on them, so the frame takes the
                     larger share. At an even split the task figure had to
                     shrink until its own type stopped being readable. */
                  'grid-template-columns': mobile()
                    ? 'minmax(0, 1fr)'
                    : flip()
                      ? `minmax(0, ${CARD_STAGE_W}px) minmax(0, 1fr)`
                      : `minmax(0, 1fr) minmax(0, ${CARD_STAGE_W}px)`,
                  padding: mobile() ? '30px 0' : '48px 8px',
                  'row-gap': mobile() ? '20px' : '0',
                }}
              >
                {/* The frame. Two of these drawings are windows onto a
                    larger product surface, and a window needs an edge --
                    floating in the page, the same crop read as a mistake.
                    Same ground, hairline and top bloom as the integration
                    section's, so it is the page's own panel rather than a
                    new one. */}
                <div
                  ref={frameEl}
                  class={
                    card.anim
                      ? playing()
                        ? `${card.anim} ${card.anim}-play`
                        : card.anim
                      : undefined
                  }
                  style={{
                    'aspect-ratio': CARD_STAGE_RATIO,
                    /* The page has no global border-box rule, and without
                       this the frame's padding lands outside the ratio. */
                    'box-sizing': 'border-box',
                    /* Barely off the page. The frame is here to give the
                       cropped figures an edge, not to be a surface in its
                       own right, so it sits about a third of the way from
                       the page ground to the integration section's -- far
                       enough to read as a panel, not far enough to become
                       one.

                       Lit from below rather than from the top, which is the
                       other way up from the integration section's ground.
                       A linear wash carries the lower half and the bloom
                       concentrates it at the floor, so the panel opens
                       downward into the page instead of sitting under a
                       skylight. */
                    'background-color':
                      'color-mix(in srgb, #16191F 32%, var(--b0))',
                    'background-image':
                      'radial-gradient(80% 42% at 50% 100%, color-mix(in srgb, var(--ambient-ink) 4.5%, transparent) 0%, transparent 100%), ' +
                      'linear-gradient(to bottom, transparent 30%, color-mix(in srgb, var(--c1) 2.6%, transparent) 100%)',
                    border:
                      '1px solid color-mix(in srgb, var(--c1) 5%, transparent)',
                    'border-radius': mobile() ? '14px' : '18px',
                    /* A centring grid rather than a positioned box. The art
                       used to be absolute with inset 0, and an absolutely
                       positioned child's containing block is the padding
                       box -- so the frame's padding was doing nothing at
                       all and every figure ran to the frame's own edge. */
                    display: 'grid',
                    'grid-column': mobile() ? undefined : flip() ? '1' : '2',
                    'grid-row': mobile() ? undefined : '1',
                    overflow: 'hidden',
                    'place-items': 'center',
                    /* The frame's own margin, so every figure is inset by
                       the same amount and `fill` is left to do nothing but
                       even out weight. Without it the three sat at 4%, 11%
                       and 0% off their edges. A percentage on all four
                       sides resolves against the width either way, so the
                       margin is the same number of pixels all round. */
                    padding: '9%',
                    width: '100%',
                  }}
                >
                  {/* Both dimensions set, so the artboard's own ratio
                      letterboxes it inside the frame rather than sizing it
                      -- preserveAspectRatio is doing the containing, which
                      is why no figure needs a width any more. */}
                  <card.Graphic
                    aria-hidden="true"
                    style={{
                      color: 'color-mix(in srgb, var(--a0) 60%, var(--b0))',
                      display: 'block',
                      height: `${((card.fill ?? 1) * 100).toFixed(2)}%`,
                      translate: (card as { nudge?: string }).nudge,
                      /* Nearer full strength than the 0.8 it ran at loose on
                         the page: the frame is what holds these back now, so
                         the art does not also have to be faint to stay
                         behind the copy. */
                      opacity: 0.9,
                      width: `${((card.fill ?? 1) * 100).toFixed(2)}%`,
                    }}
                  />
                </div>
                {/* Pushed to the row's outer edge, opposite the frame, so
                    the copy's far edge lines up with the frame's across all
                    three rows. Left-aligned inside it either way -- the
                    block mirrors, the reading does not. */}
                <div
                  style={{
                    display: 'grid',
                    gap: mobile() ? '8px' : '12px',
                    'grid-column': mobile() ? undefined : flip() ? '2' : '1',
                    'grid-row': mobile() ? undefined : '1',
                    height: 'max-content',
                    'justify-self': mobile()
                      ? undefined
                      : flip()
                        ? 'end'
                        : 'start',
                    'max-width': mobile() ? '100%' : '30em',
                    width: '100%',
                  }}
                >
                  {/* The slot was always here and always empty. A number
                      rather than a word: three rows alternating sides read
                      as a zigzag until something says which order they go
                      in -- and with no head on the section, the numbers are
                      the only thing that does. */}
                  <Show when={card.fig}>
                    <span
                      style={{
                        color: 'color-mix(in srgb, var(--a0) 78%, transparent)',
                        'font-family': 'rajdhani, body',
                        'font-size': mobile() ? '11px' : '12.5px',
                        'font-weight': '700',
                        'letter-spacing': '0.18em',
                        'text-transform': 'uppercase',
                      }}
                    >
                      {card.fig}
                    </span>
                  </Show>
                  <h2
                    style={{
                      color: 'var(--c2)',
                      'font-family': 'body',
                      'font-size': mobile() ? '16px' : '16.5px',
                      'font-weight': '700',
                      'letter-spacing': '0.07em',
                      'line-height': 1.2,
                      margin: '0',
                      'text-transform': 'uppercase',
                      'text-wrap': 'balance',
                    }}
                  >
                    {card.title}
                  </h2>
                  <p
                    style={{
                      color: mobile()
                        ? 'color-mix(in srgb, var(--c4) 70%, transparent)'
                        : 'color-mix(in srgb, var(--c4) 55%, transparent)',
                      'font-family': 'body',
                      'font-size': mobile() ? '15px' : '15px',
                      'font-weight': '500',
                      'line-height': 1.45,
                      margin: '0',
                      'text-wrap': 'pretty',
                    }}
                  >
                    {card.desc}
                  </p>
                </div>
              </article>
            );
          }}
        </For>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Split spotlight section — agents. Layout and type mirror the
// tasks page's FeatureSplit sections.
// ---------------------------------------------------------------------------

// The page's section-title tier, settled on the closing hero and shared from
// here so the three cannot drift apart: the slab display face at
// clamp(40, 4.2vw, 52), weight 315, tight tracking and 1.12 leading.
//
// `titleLine` is the other half of the treatment and the part that is easy
// to miss -- these titles break where the writing wants them to rather than
// where the measure happens to run out, and each line after the first takes
// 0.16em of extra space. At 1.12 the leading is tight enough that two banked
// lines would otherwise read as one block of type.
const slabTitle = (opts?: {
  size?: string;
  weight?: string;
}): JSX.CSSProperties => ({
  color: 'var(--c1)',
  'font-family': 'display',
  'font-size':
    opts?.size ??
    (mobile() ? 'clamp(32px, 9vw, 40px)' : 'clamp(40px, 4.2vw, 52px)'),
  'font-weight': opts?.weight ?? '315',
  'letter-spacing': '-0.015em',
  'line-height': 1.12,
  margin: '0',
  'text-align': 'left',
  'text-wrap': 'balance',
});
const titleLine = (i: number): JSX.CSSProperties => ({
  display: 'block',
  'margin-top': i ? '0.16em' : undefined,
});

// Brightens a key word to the full text color inside otherwise-muted body copy.
function _Hi(props: { children: JSX.Element }) {
  return <span style={{ color: 'var(--c1)' }}>{props.children}</span>;
}

type ChatFeatureBlock = {
  label: string;
  /** The section's entire copy: a single sentence set in the slab face at a
      light weight, replacing a heavy headline plus a bulleted list — one
      statement beside the graphic instead of two registers of text. */
  headline: JSX.Element;
  /** One quiet line under the sentence — a detail, not a second paragraph. */
  subtext?: JSX.Element;
  heroShot: Component;
};

// Copy-left / graphic-right feature section, lifted from the tasks page. On
// desktop (>=1030px) the heading and body sit beside the graphic; at
// medium/narrow it gives way to a simple stacked column (copy above graphic).
function FeatureSplit(props: {
  block: ChatFeatureBlock;
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
          gap: stacked() ? '48px' : '56px',
          'grid-template-columns': stacked()
            ? 'minmax(0, 1fr)'
            : props.reverse
              ? 'minmax(0, 1.35fr) minmax(0, 1fr)'
              : 'minmax(0, 1fr) minmax(0, 1.35fr)',
          margin: '0 auto',
          'max-width': 'var(--page-max)',
          width: '100%',
        }}
      >
        {/* Heading + body copy (right column when reversed; always first when
            stacked, so copy stays above the graphic on mobile) */}
        <div
          style={{
            display: 'grid',
            gap: mobile() ? '17px' : '24px',
            'grid-column': stacked() ? undefined : props.reverse ? '2' : '1',
            'justify-items': 'start',
          }}
        >
          {/* The shared tier. It used to run at 30/350, a step down, on the
              grounds that this one is a sentence rather than a phrase -- but
              a smaller title in the same face read as a different level of
              the page rather than as the same beat. The block carries its
              own line breaks, like the other two. */}
          <h2 style={{ ...slabTitle(), 'max-width': '16em' }}>
            {props.block.headline}
          </h2>
          <Show when={props.block.subtext}>
            <p
              style={{
                color: 'var(--c4)',
                'font-family': 'cyberreader, body',
                'font-size': mobile() ? '15.5px' : '17px',
                'font-weight': '300',
                'line-height': 1.55,
                margin: '0',
                'max-width': '34em',
                'text-align': 'left',
                'text-wrap': 'pretty',
              }}
            >
              {props.block.subtext}
            </p>
          </Show>
        </div>
        {/* The section graphic (left column when reversed), lifted off the page
            by a subtle radial glow behind it. */}
        <div
          style={{
            'grid-column': stacked() ? undefined : props.reverse ? '1' : '2',
            'grid-row': stacked() ? undefined : '1',
            position: 'relative',
            width: '100%',
          }}
        >
          <div
            aria-hidden="true"
            style={{
              // A wide, slow halo rather than a tight one: the box is grown
              // well past the graphic and the ramp runs all the way to its
              // edge, so nothing is clipped and there is no visible boundary
              // where the light stops. The stops are close together on
              // purpose -- a radial with two stops banded across a glow this
              // large.
              background:
                'radial-gradient(50% 50% at 50% 48%, ' +
                'color-mix(in srgb, var(--ambient-ink) 13%, transparent) 0%, ' +
                'color-mix(in srgb, var(--ambient-ink) 12%, transparent) 14%, ' +
                'color-mix(in srgb, var(--ambient-ink) 10%, transparent) 28%, ' +
                'color-mix(in srgb, var(--ambient-ink) 7.5%, transparent) 42%, ' +
                'color-mix(in srgb, var(--ambient-ink) 5%, transparent) 56%, ' +
                'color-mix(in srgb, var(--ambient-ink) 3%, transparent) 70%, ' +
                'color-mix(in srgb, var(--ambient-ink) 1.2%, transparent) 84%, ' +
                'transparent 100%)',
              inset: '-53% -34%',
              'pointer-events': 'none',
              position: 'absolute',
              'z-index': 0,
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

const agentsBlock: ChatFeatureBlock = {
  label: 'Macro Chat',
  headline: (
    <>
      <span style={titleLine(0)}>Built-in agents</span>
      <span style={titleLine(1)}>can take on work.</span>
    </>
  ),
  subtext: <>Power up with custom skills, routines, and 3rd party MCPs.</>,
  heroShot: AgentThreadGraphic,
};

// The agent-catchup illustration (523×224 artboard) — @Macro summarizing a
// channel, exported from the design file.
function _AgentCatchupGraphic() {
  return (
    <div style={{ display: 'grid', 'justify-items': 'center', width: '100%' }}>
      {/* No PanelLighting here, unlike the hero panels. The window is only
          460x184 of the 523x224 artboard and the skills menu hangs off its
          bottom-right corner, overlapping the window it belongs to — so an
          overlay inset to the window paints over the menu's upper half and
          leaves its lower half clear, which reads as the menu having gone
          translucent. Nothing rectangular can light the window without
          catching the menu, and the artwork carries its own rim anyway. */}
      {/* Inlined rather than an <img>: the export keeps its text live, and
          only inline SVG can see the page's Inter @font-face. */}
      <ChatAgentCatchup
        role="img"
        aria-label="@Macro summarizing missed channel messages"
        style={{
          display: 'block',
          filter: 'drop-shadow(0 30px 60px rgb(0 0 0 / 0.45))',
          height: 'auto',
          'user-select': 'none',
          width: 'min(560px, 100%)',
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Preview toggle — the channel list opening its message pane. Title still to
// come; the graphic is carrying the section on its own for now.
// ---------------------------------------------------------------------------

function ChannelsPreviewSection() {
  return (
    <section
      style={{
        'box-sizing': 'border-box',
        margin: '0 auto',
        'max-width': '1160px',
        padding: mobile() ? '80px 18px' : '120px 24px',
        width: '100%',
      }}
    >
      <ChannelPreviewGraphic />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Closing hero — the statement line over the full channel window illustration.
// ---------------------------------------------------------------------------

function ChannelsClosingHero() {
  return (
    <section
      aria-label="Beautiful channels, built for productive teams"
      style={{
        'box-sizing': 'border-box',
        display: 'grid',
        gap: mobile() ? '40px' : '64px',
        'justify-items': 'center',
        margin: '0 auto',
        'max-width': '1160px',
        padding: mobile() ? '72px 18px 64px' : '112px 24px 96px',
        width: '100%',
      }}
    >
      <div
        style={{
          display: 'grid',
          gap: mobile() ? '16px' : '22px',
          'justify-items': 'start',
          'justify-self': 'start',
        }}
      >
        <h2 style={slabTitle()}>
          <span style={titleLine(0)}>Beautiful channels,</span>
          <span style={titleLine(1)}>built for productive teams.</span>
        </h2>
        <p
          style={{
            color: 'var(--c4)',
            'font-family': 'cyberreader, body',
            'font-size': mobile() ? '16.5px' : '18px',
            'font-weight': '300',
            /* Double-leaded, and the break is the one in the markup: two
               deliberate lines under the title read as a pair of statements
               rather than as a wrapped paragraph. */
            'line-height': 2,
            margin: '0',
            'text-align': 'left',
          }}
        >
          Less dopamine hijacking.
          <br />
          More features to keep you focused and in flow state.
        </p>
        {/* Its own top margin rather than a third grid gap: the double-leaded
            copy above already carries half a line of air under its last
            baseline, so the block gap alone reads as more space here than it
            does between the title and the copy. */}
        <div style={{ 'margin-top': mobile() ? '6px' : '10px' }}>
          <ConnectGoogleButton buttonName="channels_closing_connect_google" />
        </div>
      </div>
      {/* The panels again to close the page — flat, but offset from each
          other in space rather than standing on the lit floor the top hero
          uses, over a ghost of the channel list behind them. */}
      <div
        style={{ isolation: 'isolate', position: 'relative', width: '100%' }}
      >
        {/* The same list view the section above opens, held on its first
            frame and dropped back to a wash: it reads as the room the panels
            are floating in front of rather than a third graphic. Wider than
            the panels so it shows through the bands either side of them, and
            set left rather than centred on them. That is about where the
            list's ink is: its right third is mostly the whitespace after
            short messages, so a centred ghost showed rows on the left and
            nothing at all on the right. Shifted, the timestamp column lands
            in the right-hand band and the whitespace goes behind the panels
            where it costs nothing. Desktop only — stacked, the panels cover
            the width and the ghost would only be noise around them. */}
        <Show when={!mobile()}>
          <div
            aria-hidden="true"
            style={{
              left: '-6%',
              /* Horizontal on the outer box, vertical on the inner one, in
                 place of the radial this started as. A radial's alpha falls
                 with distance from the centre, and the ink that shows in the
                 right-hand band -- the timestamp column -- sits at 94% of the
                 artboard's width, far enough out that the radial had already
                 taken it to nothing while the channel names on the left, no
                 further from the centre but bigger and brighter, still read.
                 A plateau with soft ends holds both. Two nested elements
                 rather than one with mask-composite: the same result without
                 the prefixed compositing keywords. */
              'mask-image':
                'linear-gradient(to right, transparent 0%, #000 11%, #000 89%, transparent 100%)',
              '-webkit-mask-image':
                'linear-gradient(to right, transparent 0%, #000 11%, #000 89%, transparent 100%)',
              opacity: '0.22',
              'pointer-events': 'none',
              position: 'absolute',
              right: '-6%',
              top: '50%',
              translate: '0 -50%',
              'z-index': 0,
            }}
          >
            <div
              style={{
                'mask-image':
                  'linear-gradient(to bottom, transparent 0%, #000 20%, #000 80%, transparent 100%)',
                '-webkit-mask-image':
                  'linear-gradient(to bottom, transparent 0%, #000 20%, #000 80%, transparent 100%)',
              }}
            >
              <ChannelPreviewGraphic still />
            </div>
          </div>
        </Show>
        <div style={{ position: 'relative', 'z-index': 1 }}>
          <HeroPanelStage panels={heroClosingPair(mobile())} floating />
        </div>
      </div>
    </section>
  );
}

const channelsFaq: FaqItem[] = [
  {
    q: 'How is Macro Chat different from Slack?',
    a: (
      <>
        Macro Chat includes channels, threads, and emoji. It also shares an
        inbox with email and tasks, and @Macro can use the workspace context
        available to it.
      </>
    ),
  },
  {
    q: 'What happens when I @mention a doc or task?',
    a: (
      <>
        Everyone in the channel gets access to it automatically. There are no
        separate permission dialogs or manual sharing steps.
      </>
    ),
  },
  {
    q: 'Does it have threads?',
    a: (
      <>
        Yes. Replies stay below the parent message in an inline, forum-style
        thread.
      </>
    ),
  },
  {
    q: 'What can @Macro do in a channel?',
    a: (
      <>
        Type @Macro to ask an agent to summarize missed conversation, draft
        replies, or answer questions using the workspace context available to
        it.
      </>
    ),
  },
  {
    q: 'Can I search across everything?',
    a: <>Yes. One search covers channels, email, docs, and tasks.</>,
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
// Comparison table (Macro vs Slack vs Discord vs Microsoft Teams)
// ---------------------------------------------------------------------------

const comparisonColumns: ComparisonColumn[] = [
  { label: 'Macro' },
  { label: 'Slack', logo: LogoSlack },
  { label: 'Discord', logo: LogoDiscord },
  { label: 'Teams', logo: LogoMicrosoftTeams },
];

const comparisonRows: ComparisonRow[] = [
  { feature: 'Channels, threads & emoji', cells: [true, true, true, true] },
  {
    feature: 'Threaded replies / forum discussions',
    cells: [true, true, true, true],
  },
  {
    feature: 'Search messages, people & files',
    cells: [true, true, 'partial', true],
  },
  {
    feature: 'Agents with full-workspace context',
    cells: [true, 'partial', false, 'partial'],
  },
  {
    feature: 'Built-in tasks, docs & email',
    cells: [true, false, false, 'partial'],
  },
  { feature: 'Email and chat in one app', cells: [true, false, false, false] },
  {
    feature: '@mention a doc or task to auto-share it',
    cells: [true, false, false, false],
  },
  { feature: 'Open source (AGPLv3)', cells: [true, false, false, false] },
];

function ComparisonSection() {
  return (
    <section
      aria-label="How Macro Chat compares"
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
            'font-weight': '315',
            'letter-spacing': '-0.015em',
            'line-height': 1.12,
            margin: 0,
          }}
        >
          How does Macro Chat stack up?
        </h2>
        <p
          style={{
            color: 'var(--c4)',
            'font-family': 'cyberreader, body',
            'font-size': mobile() ? '15px' : '17px',
            'font-weight': '300',
            'line-height': 1.55,
            margin: '16px auto 0',
            'max-width': '620px',
            'text-wrap': 'balance',
          }}
        >
          Macro Chat brings team conversations into the same workspace as email,
          tasks, and docs.
        </p>
      </div>
      <div style={{ width: '100%', 'max-width': '920px', 'min-width': '0' }}>
        <ComparisonTable columns={comparisonColumns} rows={comparisonRows} />
      </div>
      <ComparisonLegend />
      <SectionFaq items={channelsFaq} embedded />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Final CTA
// ---------------------------------------------------------------------------

function ChannelsFinalCta() {
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
          gap: mobile() ? '18px' : '24px',
          'justify-items': mobile() ? 'start' : 'center',
          'max-width': '585px',
        }}
      >
        <h2
          style={{
            ...slabTitle({ size: mobile() ? '38px' : '48px' }),
            'text-align': mobile() ? 'left' : 'center',
          }}
        >
          <span style={titleLine(0)}>Quieter channels.</span>
          <span style={titleLine(1)}>Better work.</span>
        </h2>
        <p
          style={{
            color: 'var(--c4)',
            'font-family': 'cyberreader, body',
            'font-size': mobile() ? '17px' : '19px',
            'font-weight': '300',
            'line-height': 1.6,
            margin: '0',
          }}
        >
          It takes 30 seconds to connect your workspace and bring channels,
          email, tasks, and agents into one shared memory.
        </p>
      </div>
      <ConnectGoogleButton buttonName="channels_final_connect_google" large />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export const RouteChannels: Component = () => {
  setPageSeo({
    title: 'Macro Chat — Team Chat Wired into Everything',
    description:
      'Macro Chat combines Slack-speed team chat with inline threads, @mention sharing, a unified inbox, and AI agents — all in one workspace with your email, docs, and tasks.',
    path: '/channels',
  });

  const [heroDemoOpen, setHeroDemoOpen] = createSignal(false);

  let pageRef: HTMLDivElement | undefined;
  onMount(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setHeroDemoOpen(false);
    };
    window.addEventListener('keydown', onKey);
    onCleanup(() => window.removeEventListener('keydown', onKey));

    const run = () => pageRef && drawSvgUnderlines(pageRef);
    // Width comes from the measured text, so wait for Inter before drawing.
    if (document.fonts?.ready) document.fonts.ready.then(run);
    else run();
  });

  return (
    <div
      ref={pageRef}
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
        /* The graphics' exported text is live rather than outlined, so it is
           rasterised by the browser. macOS defaults to subpixel antialiasing,
           which thickens stems and made every label read a notch heavier than
           the Figma design; grayscale AA matches the source. */
        svg text {
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
        }

        /* The /email panels' rim, lifted from EmailTurboInbox's .turbo-frame:
           a 1px gradient border drawn with the masked padding-box recipe, so
           the light catches the top-left edge and only glances off the
           bottom-right.

           Corner pools rather than /email's single 135deg sweep. A linear
           gradient reaches the same distance along the top edge as it does
           down the left one, and at 24% of the diagonal that was about half of
           each. An ellipse anchored in the corner sets its horizontal and
           vertical reach separately, so the run along the top can stop well
           before the run down the side does: the first pair of percentages is
           how far right the light carries, then how far down. */
        .channels-panel-rim {
          padding: 1px;
          background:
            radial-gradient(32% 38% at 0% 0%,
              color-mix(in srgb, var(--ambient-ink) 17%, transparent) 0%,
              color-mix(in srgb, var(--ambient-ink) 6%, transparent) 46%,
              transparent 100%),
            radial-gradient(24% 30% at 100% 100%,
              color-mix(in srgb, var(--ambient-ink) 11%, transparent) 0%,
              transparent 100%);
          -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
          -webkit-mask-composite: xor;
          mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
          mask-composite: exclude;
        }

        @media (hover) {
          .channels-cta-button:hover { transform: scale(1.02); }
        }
      `}</style>

      <ChannelsHero onWatchDemo={() => setHeroDemoOpen(true)} />

      <HomeSectionRule />

      {/* Why the product exists, before the page shows what it does */}
      <ChannelsFounderLetter />

      {/* The channel list opening its preview pane — the first thing the page
          shows after the letter makes its case */}
      <ChannelsPreviewSection />

      <HomeSectionRule />

      {/* Second hero: the integration thesis over the animated mention row */}
      <ChannelsIntegrationHero />

      <HomeSectionRule />

      {/* Video + sub-feature cards */}
      <ChannelsFeatureCards />

      <HomeSectionRule />

      {/* Agents lead the feature sections — reversed: graphic left, copy right */}
      <FeatureSplit block={agentsBlock} reverse align="start" />

      <HomeSectionRule />

      {/* The complete task lifecycle animation, shared with the Tasks page. */}
      <TasksLifecycle
        title={
          <>
            <span style={titleLine(0)}>Drive tasks</span>
            <span style={titleLine(1)}>directly in the channel.</span>
          </>
        }
        description="Turn any message into a task, track it through the work, and close the loop without leaving the channel."
      />

      <HomeSectionRule />

      {/* Closing hero */}
      <ChannelsClosingHero />

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
        <ChannelsFinalCta />
      </div>

      {/* Divider + footer */}
      <div
        style={{
          'padding-bottom': mobile() ? '40px' : '48px',
          'padding-inline': mobile() ? '18px' : '24px',
        }}
      >
        <SectionMoreFeatures currentPath="/channels" footerOnly />
      </div>

      {/* Hero demo, matching the email/tasks/calls pages: the YouTube iframe —
          and its branding — only loads once the modal is opened. */}
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
