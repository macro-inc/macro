import { For, type JSX } from 'solid-js';
import { viewportWidth } from '../../utils/utilBreakpoint';
import {
  CommentsGraphic,
  RealMentionMenu,
  SlashMenuGraphic,
  SlashMenuPanel,
} from '../featureGraphics/DocumentsGraphics';

type UiCell = {
  title: string;
  body: string;
  Graphic: () => JSX.Element;
};

// A dimmed doc with a trigger char (/ or @) behind a spotlit menu lifted in
// front — the same composition as the Properties spotlight up the page.
function MenuSpotlight(props: {
  trigger: string;
  menu: () => JSX.Element;
  menuWidth: string;
}) {
  return (
    <div
      style={{
        'box-sizing': 'border-box',
        display: 'grid',
        'justify-items': 'center',
        padding: '24px',
        position: 'relative',
        width: '100%',
      }}
    >
      {/* Dimmed doc behind */}
      <div
        aria-hidden="true"
        style={{
          filter: 'saturate(0.85)',
          'mask-image':
            'linear-gradient(to bottom, #000 0%, #000 70%, transparent 100%)',
          '-webkit-mask-image':
            'linear-gradient(to bottom, #000 0%, #000 70%, transparent 100%)',
          opacity: '0.4',
          'pointer-events': 'none',
          width: '100%',
        }}
      >
        <SlashMenuGraphic hideMenu trigger={props.trigger} />
      </div>
      {/* Spotlit menu, lifted in front */}
      <div
        style={{
          'align-items': 'center',
          display: 'grid',
          inset: '0',
          'justify-items': 'center',
          padding: '24px',
          position: 'absolute',
        }}
      >
        <div
          style={{
            position: 'relative',
            width: `min(${props.menuWidth}, 100%)`,
          }}
        >
          <div
            aria-hidden="true"
            style={{
              background:
                'radial-gradient(72% 72% at 50% 50%, color-mix(in srgb, var(--b1) 38%, var(--ambient-ink) 14%) 0%, transparent 72%)',
              inset: '-22% -20%',
              'pointer-events': 'none',
              position: 'absolute',
              'z-index': 0,
            }}
          />
          <div
            style={{
              filter: 'drop-shadow(0 30px 60px rgb(0 0 0 / 0.55))',
              position: 'relative',
              'z-index': 1,
            }}
          >
            {props.menu()}
          </div>
        </div>
      </div>
    </div>
  );
}

function MentionSpotlight() {
  return (
    <MenuSpotlight
      trigger="@"
      menu={() => <RealMentionMenu />}
      menuWidth="340px"
    />
  );
}

function SlashSpotlight() {
  return (
    <MenuSpotlight
      trigger="/"
      menu={() => <SlashMenuPanel />}
      menuWidth="300px"
    />
  );
}

// Markdown-native: a concrete editor snippet where raw markdown syntax sits
// next to the formatted result it renders into, reading as a real document.
const appFont =
  "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const monoFont = "ui-monospace, 'SFMono-Regular', Menlo, monospace";

function MdSyntax(props: { children: JSX.Element }) {
  return (
    <span
      style={{
        color: 'color-mix(in srgb, var(--c4) 75%, transparent)',
        'font-family': monoFont,
        'font-weight': 400,
      }}
    >
      {props.children}
    </span>
  );
}

function MarkdownNativeMock() {
  return (
    <div
      style={{
        'box-sizing': 'border-box',
        display: 'grid',
        'justify-items': 'center',
        padding: '24px',
        position: 'relative',
        width: '100%',
      }}
    >
      <div
        style={{
          'background-color': '#0a0a0a',
          border: '1px solid color-mix(in srgb, var(--c4) 12%, transparent)',
          'border-radius': '12px',
          'box-shadow': '0 22px 60px rgb(0 0 0 / 0.5)',
          'box-sizing': 'border-box',
          display: 'grid',
          gap: '14px',
          'max-width': '360px',
          padding: '22px 24px',
          'text-align': 'left',
          width: '100%',
        }}
      >
        {/* # Heading 1 */}
        <div
          style={{
            color: 'var(--c1)',
            'font-family': appFont,
            'font-size': '22px',
            'font-weight': 600,
            'letter-spacing': '-0.01em',
            'line-height': 1.1,
          }}
        >
          <MdSyntax># </MdSyntax>Release notes
        </div>

        {/* body with **bold** and `code` */}
        <div
          style={{
            color: 'var(--c2)',
            'font-family': appFont,
            'font-size': '14px',
            'line-height': 1.6,
          }}
        >
          We just shipped <MdSyntax>**</MdSyntax>
          <strong style={{ color: 'var(--c1)', 'font-weight': 700 }}>
            realtime sync
          </strong>
          <MdSyntax>**</MdSyntax> and a faster <MdSyntax>`</MdSyntax>
          <span
            style={{
              'background-color':
                'color-mix(in srgb, var(--c4) 12%, transparent)',
              'border-radius': '4px',
              color: 'var(--c1)',
              'font-family': monoFont,
              'font-size': '12.5px',
              padding: '1px 5px',
            }}
          >
            editor
          </span>
          <MdSyntax>`</MdSyntax>.
        </div>

        {/* - [x] checklist */}
        <div style={{ display: 'grid', gap: '9px' }}>
          <div
            style={{
              'align-items': 'center',
              color: 'var(--c1)',
              display: 'flex',
              'font-family': appFont,
              'font-size': '14px',
              gap: '9px',
            }}
          >
            <MdSyntax>- [x]</MdSyntax>
            <span
              aria-hidden="true"
              style={{
                'align-items': 'center',
                'background-color': 'var(--a0)',
                'border-radius': '4px',
                'box-sizing': 'border-box',
                display: 'inline-grid',
                flex: 'none',
                height: '16px',
                'place-items': 'center',
                width: '16px',
              }}
            >
              <svg width="9" height="7" viewBox="0 0 10 8" aria-hidden="true">
                <path
                  d="M1 4l2.6 2.6L9 1"
                  fill="none"
                  stroke="var(--b0)"
                  stroke-width="1.8"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </span>
            <span
              style={{ color: 'var(--c4)', 'text-decoration': 'line-through' }}
            >
              Conflict-free editing
            </span>
          </div>
          <div
            style={{
              'align-items': 'center',
              color: 'var(--c1)',
              display: 'flex',
              'font-family': appFont,
              'font-size': '14px',
              gap: '9px',
            }}
          >
            <MdSyntax>- [ ]</MdSyntax>
            <span
              aria-hidden="true"
              style={{
                border: '1px solid var(--b4)',
                'border-radius': '4px',
                'box-sizing': 'border-box',
                flex: 'none',
                height: '16px',
                width: '16px',
              }}
            />
            <span>Offline replay</span>
          </div>
        </div>
      </div>
    </div>
  );
}

const cells: UiCell[] = [
  {
    title: '@mention anything',
    body: 'Pull people, docs, tasks, and channels into any page — each renders as a live inline pill.',
    Graphic: MentionSpotlight,
  },
  {
    title: 'Slash commands',
    body: 'Press / to insert headings, tables, code, math, and tasks — every block you need is one keystroke away.',
    Graphic: SlashSpotlight,
  },
  {
    title: 'Comments & history',
    body: 'Comment inline on any selection, resolve threads, and browse the full version history anytime.',
    Graphic: CommentsGraphic,
  },
  {
    title: 'Markdown-native',
    body: 'Type markdown and it formats as you go, with a clean export back to plain markdown anytime.',
    Graphic: MarkdownNativeMock,
  },
];

// The graphic floats above a soft glow and fades into the cell at the bottom,
// matching Linear's feature mocks.
const GRAPHIC_FADE =
  'linear-gradient(to bottom, #000 0%, #000 76%, transparent 100%)';

// Linear-style 2×2 of concrete editor UI snippets (the smaller graphics from the
// old bento), each in a bordered cell with the mock floating above a left-aligned
// caption.
export function DocumentsUiGrid() {
  const mobile = () => viewportWidth() < 700;
  const stacked = () => viewportWidth() < 860;
  const cols = () => (stacked() ? 1 : 2);

  return (
    <section
      aria-label="In every document"
      style={{
        'box-sizing': 'border-box',
        display: 'grid',
        'justify-items': 'center',
        'padding-block': mobile() ? '56px' : '80px',
        'padding-inline': mobile() ? '18px' : '24px',
        width: '100%',
      }}
    >
      <style>{`
        @keyframes docsCaretBlink { 0%, 49% { opacity: 1; } 50%, 100% { opacity: 0; } }
        @media (prefers-reduced-motion: no-preference) {
          .docs-ui-grid .docs-caret { animation: docsCaretBlink 1.1s steps(1) infinite; }
        }
      `}</style>

      <div
        class="docs-ui-grid"
        style={{
          border: '1px solid color-mix(in srgb, var(--b4) 16%, transparent)',
          'border-radius': mobile() ? '16px' : '20px',
          'box-sizing': 'border-box',
          display: 'grid',
          'grid-template-columns': stacked()
            ? '1fr'
            : 'repeat(2, minmax(0, 1fr))',
          'max-width': '100%',
          overflow: 'hidden',
          width: '100%',
        }}
      >
        <For each={cells}>
          {(cell, index) => (
            <div
              style={{
                'border-left':
                  index() % cols() !== 0
                    ? '1px solid color-mix(in srgb, var(--b4) 14%, transparent)'
                    : 'none',
                'border-top':
                  index() >= cols()
                    ? '1px solid color-mix(in srgb, var(--b4) 14%, transparent)'
                    : 'none',
                'box-sizing': 'border-box',
                display: 'grid',
                'grid-template-rows': '1fr auto',
              }}
            >
              <div
                style={{
                  'align-items': 'center',
                  display: 'grid',
                  'justify-items': 'center',
                  'min-height': mobile() ? '0' : '300px',
                  overflow: 'hidden',
                  padding: mobile() ? '16px 0 0' : '20px 0 0',
                  position: 'relative',
                  width: '100%',
                }}
              >
                {/* Soft glow behind the mock */}
                <div
                  aria-hidden="true"
                  style={{
                    background:
                      'radial-gradient(58% 54% at 50% 42%, color-mix(in srgb, var(--ambient-ink) 8%, transparent) 0%, transparent 72%)',
                    inset: '0',
                    'pointer-events': 'none',
                    position: 'absolute',
                  }}
                />
                {/* Mock, faded into the cell at the bottom */}
                <div
                  style={{
                    display: 'grid',
                    'justify-items': 'center',
                    '-webkit-mask-image': GRAPHIC_FADE,
                    'mask-image': GRAPHIC_FADE,
                    position: 'relative',
                    width: '100%',
                  }}
                >
                  <cell.Graphic />
                </div>
              </div>
              <div
                style={{
                  display: 'grid',
                  gap: mobile() ? '8px' : '10px',
                  padding: mobile() ? '2px 22px 30px' : '6px 34px 36px',
                }}
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
                  {cell.title}
                </h3>
                <p
                  style={{
                    color: 'var(--c4)',
                    'font-family': 'body',
                    'font-size': mobile() ? '15px' : '16px',
                    'font-weight': '400',
                    'line-height': 1.5,
                    margin: 0,
                    'max-width': '420px',
                  }}
                >
                  {cell.body}
                </p>
              </div>
            </div>
          )}
        </For>
      </div>
    </section>
  );
}
