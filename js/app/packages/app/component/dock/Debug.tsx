import { activeScope } from '@core/hotkey/state';
import { createSignal } from 'solid-js';

const [debugOpen, setDebugOpen] = createSignal(true);

export function Debug() {
  return (
    <div
      onMouseLeave={(e) => {
        if (!debugOpen()) e.currentTarget.style.opacity = '0.5';
      }}
      onMouseEnter={(e) => {
        if (!debugOpen()) e.currentTarget.style.opacity = '1';
      }}
      style={{
        transform: debugOpen() ? 'translateX(0)' : 'translateX(100%)',
        outline: '1px solid rgb(239 68 68)',
        opacity: debugOpen() ? '1' : '0.5',
        'font-family': 'monospace',
        transition: 'all 500ms',
        'font-size': '0.75rem',
        'line-height': '1rem',
        cursor: 'var(--cursor-pointer)',
        right: '-0.5rem',
        bottom: '100%',
        top: '300px',
      }}
      onClick={() => setDebugOpen((p) => !p)}
      title="Click to keep open"
    >
      <h3
        style={{
          'transform-origin': 'bottom right',
          'background-color': 'var(--ink)',
          transform: 'rotate(-90deg)',
          padding: '1px 0.25rem',
          'white-space': 'nowrap',
          position: 'absolute',
          bottom: '7ch',
          right: '100%',
        }}
      >
        Debug
      </h3>
      <ol
        style={{
          'background-color': 'rgba(var(--ink-rgb), 0.5)',
          'list-style-position': 'inside',
          'list-style-type': 'decimal',
          'flex-direction': 'column',
          padding: '1lh 1ch',
          display: 'flex',
        }}
      >
        <li
          style={{
            'white-space': 'nowrap',
            display: 'list-item',
          }}
        >
          <span
            style={{
              'background-color': 'var(--ink)',
              padding: '1px 0.25rem',
            }}
          >
            {activeScope()}
          </span>
        </li>
      </ol>
    </div>
  );
}
