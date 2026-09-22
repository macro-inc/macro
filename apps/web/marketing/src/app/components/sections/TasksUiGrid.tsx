import { For, type JSX } from 'solid-js';
import { viewportWidth } from '../../utils/utilBreakpoint';
import {
  CaptureTaskGraphic,
  CreateTaskCreator,
  KeyboardGraphic,
  PropertiesGraphic,
} from '../featureGraphics/TasksGraphics';

type UiCell = {
  title: string;
  body: string;
  Graphic: () => JSX.Element;
};

// The quick-create modal, given breathing room inside its cell (the component
// itself is bare so the lifecycle/spotlight compositions can also use it).
function CreatorCell() {
  return (
    <div
      style={{
        'box-sizing': 'border-box',
        display: 'grid',
        'justify-items': 'center',
        padding: '24px',
        width: '100%',
      }}
    >
      <div style={{ width: 'min(520px, 100%)' }}>
        <CreateTaskCreator />
      </div>
    </div>
  );
}

// Keycap chords in a 2×2, centered in the cell.
function KeyboardCell() {
  return (
    <div
      style={{
        'box-sizing': 'border-box',
        display: 'grid',
        'justify-items': 'center',
        padding: '32px 24px',
        width: '100%',
      }}
    >
      <div style={{ width: 'min(420px, 100%)' }}>
        <KeyboardGraphic columns={2} />
      </div>
    </div>
  );
}

const cells: UiCell[] = [
  {
    title: 'Quick capture',
    body: 'Turn an email or message into a task in one click, with properties pre-filled.',
    Graphic: CaptureTaskGraphic,
  },
  {
    title: 'Create from anywhere',
    body: 'The task creator floats over any screen — file a task without switching context.',
    Graphic: CreatorCell,
  },
  {
    title: 'Keyboard-first',
    body: 'Status, priority, and assignee are one chord each — triage without touching the mouse.',
    Graphic: KeyboardCell,
  },
  {
    title: 'Custom properties',
    body: 'Story points, due dates, dependencies — add structure only when the team needs it.',
    Graphic: PropertiesGraphic,
  },
];

const GRAPHIC_FADE =
  'linear-gradient(to bottom, #000 0%, #000 76%, transparent 100%)';

export function TasksUiGrid() {
  const mobile = () => viewportWidth() < 700;
  const stacked = () => viewportWidth() < 860;

  return (
    <section
      aria-label="Tasks in action"
      style={{
        'box-sizing': 'border-box',
        display: 'grid',
        'justify-items': 'center',
        'padding-block': mobile() ? '56px' : '80px',
        'padding-inline': mobile() ? '18px' : '24px',
        width: '100%',
      }}
    >
      <div
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
          {(cell, index) => {
            const cols = () => (stacked() ? 1 : 2);
            return (
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
            );
          }}
        </For>
      </div>
    </section>
  );
}
