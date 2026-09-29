import { For, type JSX } from 'solid-js';
import { viewportWidth } from '../../utils/utilBreakpoint';
import {
  Cube,
  IsoFigure,
  IsoLine,
  Tile,
  type Vec2,
} from '../graphics/IsoLineArt';

const v = (x: number, y: number): Vec2 => ({ x, y });

// --- Fig 01 — Status & priority --------------------------------------------
// Two stacked checkboxes: one filled (done), one ticked mid-flight. A priority
// arrow bobs above the stack, reading as "urgency up front."
function FigStatusPriority(props: { mobile: boolean }) {
  return (
    <IsoFigure height={props.mobile ? '108px' : '128px'}>
      {/* Base slab */}
      <g class="tf-part tf-slab">
        <Tile cx={70} cy={82} w={46} t={5} />
      </g>
      {/* Bottom row (done) */}
      <g class="tf-part tf-row-bot">
        <Cube cx={58} cy={64} w={9} h={10} />
        <Cube cx={82} cy={64} w={24} h={7} />
      </g>
      {/* Top row (in-progress) */}
      <g class="tf-part tf-row-top">
        <Cube cx={58} cy={50} w={9} h={10} />
        <Cube cx={82} cy={50} w={18} h={7} />
      </g>
      {/* Priority arrow (bobs up) */}
      <g class="tf-part tf-priority">
        <IsoLine from={v(70, 38)} to={v(70, 32)} />
        <IsoLine from={v(64, 36)} to={v(70, 32)} />
        <IsoLine from={v(76, 36)} to={v(70, 32)} />
      </g>
    </IsoFigure>
  );
}

// --- Fig 02 — Keyboard-first -----------------------------------------------
// A slab with a grid of keycaps — ⌘ + K highlighted in accent.
function FigKeyboard(props: { mobile: boolean }) {
  const cols = 5;
  const rows = 3;
  const step = 10;
  const originX = 40;
  const originY = 35;
  const keys: { cx: number; cy: number }[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      keys.push({
        cx: originX + step * (c + r),
        cy: originY + (step / 2) * (c - r),
      });
    }
  }
  keys.sort((a, b) => a.cy - b.cy);
  return (
    <IsoFigure height={props.mobile ? '108px' : '128px'}>
      <Tile cx={70} cy={70} w={56} t={5} />
      <For each={keys}>
        {(key, i) => (
          <g
            class={`tf-part tf-key${i() === 7 ? ' tf-key--accent' : ''}`}
            style={{ 'animation-delay': `${(i() * 0.045) % 0.63}s` }}
          >
            <Cube cx={key.cx} cy={key.cy} w={3.4} h={4} />
          </g>
        )}
      </For>
      {/* Spacebar */}
      <g class="tf-part tf-key" style={{ 'animation-delay': '0.35s' }}>
        <Cube cx={70} cy={63} w={12} h={3.5} />
      </g>
    </IsoFigure>
  );
}

// --- Fig 03 — GitHub-linked ------------------------------------------------
// A cube (task) connected by a flowing dashed line to a smaller cube (PR).
function FigGithubLinked(props: { mobile: boolean }) {
  return (
    <IsoFigure height={props.mobile ? '108px' : '128px'}>
      {/* Task block */}
      <g class="tf-part tf-task-block">
        <Cube cx={52} cy={68} w={18} h={20} />
      </g>
      {/* Flowing link */}
      <IsoLine
        class="tf-gh-flow"
        from={v(65, 62)}
        to={v(85, 57)}
        dashed
        opacity={0.55}
      />
      {/* PR block */}
      <g class="tf-part tf-pr-block">
        <Cube cx={96} cy={56} w={14} h={16} />
      </g>
      {/* Merge check */}
      <g class="tf-part tf-merge">
        <IsoLine from={v(88, 46)} to={v(92, 42)} />
        <IsoLine from={v(92, 42)} to={v(100, 48)} />
      </g>
    </IsoFigure>
  );
}

// --- Fig 04 — Agents close tasks -------------------------------------------
// A sparkle (agent) hovers above a stack of tasks; the top task rises to meet it.
function FigAgentsClose(props: { mobile: boolean }) {
  // Sparkle shape
  function Sparkle(p: { cx: number; cy: number; scale: number }) {
    return (
      <g
        class="tf-part tf-sparkle"
        style={{ 'transform-box': 'fill-box', 'transform-origin': 'center' }}
      >
        <path
          transform={`translate(${p.cx} ${p.cy}) scale(${p.scale}) translate(-12 -12)`}
          d="M12 4c.5 5 2.6 7.1 7.5 7.6C14.6 12 12.5 14.2 12 19.2c-.5-5-2.6-7.1-7.5-7.6C9.4 11 11.5 8.9 12 4z"
          fill="currentColor"
          stroke="none"
        />
      </g>
    );
  }
  return (
    <IsoFigure height={props.mobile ? '108px' : '128px'}>
      {/* Bottom tasks */}
      <g class="tf-part tf-task-c">
        <Cube cx={68} cy={86} w={28} h={7} />
      </g>
      <g class="tf-part tf-task-b">
        <Cube cx={68} cy={76} w={28} h={7} />
      </g>
      {/* Rising top task */}
      <g class="tf-part tf-task-a">
        <Cube cx={68} cy={64} w={28} h={7} />
      </g>
      {/* Agent sparkle */}
      <Sparkle cx={68} cy={42} scale={0.9} />
    </IsoFigure>
  );
}

type Pillar = {
  slug: string;
  fig: string;
  title: string;
  body: string;
  Graphic: (props: { mobile: boolean }) => JSX.Element;
};

const pillars: Pillar[] = [
  {
    slug: 'status',
    fig: 'Fig 01',
    title: 'Status & priority',
    body: 'Set status and priority inline — no modal, no detour.',
    Graphic: FigStatusPriority,
  },
  {
    slug: 'keyboard',
    fig: 'Fig 02',
    title: 'Keyboard-first',
    body: 'Triage, assign, and close tasks without lifting your hands.',
    Graphic: FigKeyboard,
  },
  {
    slug: 'github',
    fig: 'Fig 03',
    title: 'GitHub-linked',
    body: 'Open a PR and the task moves to In Review. Merge and it closes.',
    Graphic: FigGithubLinked,
  },
  {
    slug: 'agents',
    fig: 'Fig 04',
    title: 'Agents close tasks',
    body: 'Assign a task to an agent — it does the work and reports back.',
    Graphic: FigAgentsClose,
  },
];

const tasksFeatureStyles = `
  @keyframes tfFloat { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
  @keyframes tfFlowOut { to { stroke-dashoffset: -14; } }
  @keyframes tfKeyPress {
    0%, 68%, 100% { transform: translateY(0); }
    84% { transform: translateY(2.5px); }
  }
  @keyframes tfStar { 0%, 100% { transform: scale(0.88); opacity: 0.6; } 50% { transform: scale(1.12); opacity: 1; } }
  @keyframes tfRise { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }

  .tf-part {
    transform-box: fill-box;
    transform-origin: center;
    transition: transform 420ms cubic-bezier(0.22, 1, 0.36, 1);
  }
  .tf-gh-flow { animation: tfFlowOut 1.6s linear infinite; }
  .tf-sparkle { animation: tfStar 3.2s ease-in-out infinite; }
  .tf-priority { animation: tfFloat 4s ease-in-out infinite; transform-box: fill-box; transform-origin: center; }
  .tf-task-a { animation: tfRise 3.6s ease-in-out infinite; transform-box: fill-box; transform-origin: center; }

  @media (hover) {
    .tf-pillar--keyboard:hover .tf-key { animation: tfKeyPress 0.7s ease-in-out infinite; transform-box: fill-box; transform-origin: center; }
    .tf-pillar--status:hover .tf-row-top { transform: translateY(-5px); }
    .tf-pillar--github:hover .tf-gh-flow { animation-duration: 0.9s; }
    .tf-pillar--agents:hover .tf-sparkle { animation-duration: 1.8s; }
  }

  @media (prefers-reduced-motion: reduce) {
    .tf-gh-flow, .tf-sparkle, .tf-priority, .tf-task-a { animation: none; }
    .tf-part { transition: none; }
  }
`;

export function TasksFeatureGrid() {
  const mobile = () => viewportWidth() < 700;
  const colCount = () => (mobile() ? 1 : viewportWidth() < 1000 ? 2 : 4);

  return (
    <section
      aria-label="Why Macro Tasks"
      style={{
        'box-sizing': 'border-box',
        display: 'grid',
        'justify-items': 'center',
        'padding-block': mobile() ? '56px' : '80px',
        'padding-inline': mobile() ? '18px' : '24px',
        width: '100%',
      }}
    >
      <style>{tasksFeatureStyles}</style>

      <div style={{ 'max-width': '1160px', width: '100%' }}>
        <div
          style={{
            color: 'color-mix(in srgb, var(--a0) 34%, transparent)',
            display: 'grid',
            'grid-template-columns': `repeat(${colCount()}, minmax(0, 1fr))`,
            width: '100%',
          }}
        >
          <For each={pillars}>
            {(pillar, index) => (
              <div
                class={`tf-pillar tf-pillar--${pillar.slug}`}
                style={{
                  'align-content': 'start',
                  'border-left':
                    index() % colCount() !== 0
                      ? '1px solid color-mix(in srgb, var(--b4) 20%, transparent)'
                      : 'none',
                  'border-top':
                    index() >= colCount()
                      ? '1px solid color-mix(in srgb, var(--b4) 20%, transparent)'
                      : 'none',
                  'box-sizing': 'border-box',
                  display: 'grid',
                  gap: mobile() ? '20px' : '24px',
                  padding: mobile() ? '32px 20px' : '38px 28px',
                }}
              >
                <span
                  style={{
                    color: 'color-mix(in srgb, var(--c4) 60%, transparent)',
                    'font-family': 'rajdhani, body',
                    'font-size': mobile() ? '11px' : '12px',
                    'font-weight': '700',
                    'letter-spacing': '0.14em',
                    'text-transform': 'uppercase',
                  }}
                >
                  {pillar.fig}
                </span>
                <div
                  style={{
                    'align-items': 'center',
                    display: 'flex',
                    'justify-content': 'center',
                    'min-height': mobile() ? '0' : '140px',
                    width: '100%',
                  }}
                >
                  <pillar.Graphic mobile={mobile()} />
                </div>
                <div
                  style={{ display: 'grid', gap: mobile() ? '8px' : '10px' }}
                >
                  <h3
                    style={{
                      color: 'var(--c2)',
                      'font-family': 'body',
                      'font-size': mobile() ? '14px' : '15px',
                      'font-weight': '700',
                      'letter-spacing': '0.07em',
                      'line-height': 1.2,
                      margin: 0,
                      'text-transform': 'uppercase',
                    }}
                  >
                    {pillar.title}
                  </h3>
                  <p
                    style={{
                      color: 'color-mix(in srgb, var(--c4) 62%, transparent)',
                      'font-family': 'body',
                      'font-size': mobile() ? '15px' : '16px',
                      'font-weight': '400',
                      'line-height': 1.5,
                      margin: 0,
                      'max-width': '420px',
                    }}
                  >
                    {pillar.body}
                  </p>
                </div>
              </div>
            )}
          </For>
        </div>
      </div>
    </section>
  );
}
