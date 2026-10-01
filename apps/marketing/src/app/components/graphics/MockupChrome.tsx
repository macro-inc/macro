import { For, type JSX, Show } from 'solid-js';

// Shared chrome for the app-mockup / hero windows. Extracted so every panel
// (email, docs, tasks, calls, …) reuses the exact same controls instead of
// duplicating the markup.

export const mockupFont =
  "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

// Inset segmented control (the Signal/Noise/All style). Hover styling lives in
// index.css as `.mockup-tab:hover`.
export function TabsInset(props: {
  tabs: string[];
  active: number;
  onSelect: (index: number) => void;
  compact?: boolean;
  // When compact, hide tabs whose index exceeds this (e.g. 1 keeps first two).
  compactMaxIndex?: number;
}) {
  return (
    <div
      style={{
        'align-items': 'center',
        'background-color': 'rgb(0 0 0 / 0.4)',
        border: '1px solid color-mix(in srgb, var(--c4) 9%, transparent)',
        'border-radius': '9px',
        display: 'flex',
        flex: 'none',
        gap: '2px',
        padding: '2px',
      }}
    >
      <For each={props.tabs}>
        {(tab, index) => {
          const isActive = () => index() === props.active;
          const hidden = () =>
            !!props.compact &&
            props.compactMaxIndex !== undefined &&
            index() > props.compactMaxIndex;
          return (
            <button
              type="button"
              class="mockup-tab"
              onClick={() => props.onSelect(index())}
              style={{
                'background-color': isActive()
                  ? 'color-mix(in srgb, var(--c1) 6%, transparent)'
                  : 'transparent',
                border: isActive()
                  ? '1px solid color-mix(in srgb, var(--c4) 13%, transparent)'
                  : '1px solid transparent',
                'border-radius': '6px',
                'box-shadow': isActive()
                  ? '0 1px 2px rgb(0 0 0 / 0.25)'
                  : 'none',
                color: isActive() ? 'var(--c1)' : 'var(--c4)',
                cursor: 'pointer',
                display: hidden() ? 'none' : 'inline-flex',
                'font-family': mockupFont,
                'font-size': '12.5px',
                'font-weight': '500',
                padding: '4px 10px',
                'white-space': 'nowrap',
              }}
            >
              {tab}
            </button>
          );
        }}
      </For>
    </div>
  );
}

// Bottom "Ask AI" input bar. `trailing` renders inside the (position:relative)
// row alongside the pill — e.g. the email panel's J/K keyboard hints.
export function AskAiBar(props: {
  compact?: boolean;
  placeholder?: string;
  trailing?: JSX.Element;
  // Optional model chip shown before the send button (e.g. "Opus 4.8").
  model?: string;
}) {
  return (
    <div style={{ padding: props.compact ? '7px 13px' : '8px 16px' }}>
      <div
        style={{
          'align-items': 'center',
          display: 'flex',
          gap: '10px',
          'justify-content': 'center',
          position: 'relative',
        }}
      >
        <div
          style={{
            'align-items': 'center',
            'background-color': 'color-mix(in srgb, var(--b1) 80%, var(--b0))',
            border: '1px solid color-mix(in srgb, var(--c4) 16%, transparent)',
            'border-radius': '999px',
            display: 'flex',
            flex: props.compact ? '1' : '0 1 440px',
            gap: '10px',
            'max-width': props.compact ? undefined : '440px',
            'min-width': 0,
            padding: '8px 8px 8px 14px',
          }}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 256 256"
            width="16"
            height="16"
            fill="currentColor"
            style={{
              color: 'color-mix(in srgb, var(--c4) 66%, transparent)',
              display: 'block',
              flex: 'none',
            }}
          >
            <path d="M209.66,122.34a8,8,0,0,1,0,11.32l-82.05,82a56,56,0,0,1-79.2-79.21L147.67,35.73a40,40,0,1,1,56.61,56.55L105,193A24,24,0,1,1,71,159L154.3,74.38A8,8,0,1,1,165.7,85.6L82.39,170.31a8,8,0,1,0,11.27,11.36L192.93,81A24,24,0,1,0,159,47L59.76,147.68a40,40,0,1,0,56.53,56.62l82.06-82A8,8,0,0,1,209.66,122.34Z" />
          </svg>
          <span
            style={{
              color: 'color-mix(in srgb, var(--c4) 60%, transparent)',
              flex: 1,
              'font-family': mockupFont,
              'font-size': props.compact ? '13px' : '14px',
              overflow: 'hidden',
              'text-overflow': 'ellipsis',
              'white-space': 'nowrap',
            }}
          >
            {props.placeholder ?? 'Ask AI, @mention anything'}
          </span>
          <Show when={props.model}>
            <span
              aria-hidden="true"
              style={{
                'align-items': 'center',
                color: 'color-mix(in srgb, var(--c4) 75%, transparent)',
                display: 'inline-flex',
                flex: 'none',
                'font-family': mockupFont,
                'font-size': '12px',
                'font-weight': '500',
                gap: '4px',
                'white-space': 'nowrap',
              }}
            >
              {props.model}
              <svg
                width="9"
                height="9"
                viewBox="0 0 256 256"
                fill="currentColor"
                style={{ display: 'block' }}
              >
                <path d="M213.66,101.66l-80,80a8,8,0,0,1-11.32,0l-80-80A8,8,0,0,1,53.66,90.34L128,164.69l74.34-74.35a8,8,0,0,1,11.32,11.32Z" />
              </svg>
            </span>
          </Show>
          <span
            aria-hidden="true"
            style={{
              'align-items': 'center',
              'background-color': 'var(--a0)',
              'border-radius': '999px',
              color: 'var(--b0)',
              display: 'inline-flex',
              flex: 'none',
              height: '28px',
              'justify-content': 'center',
              width: '28px',
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              aria-hidden="true"
              style={{ display: 'block' }}
            >
              <path
                d="M12 19V5M12 5l-6 6M12 5l6 6"
                fill="none"
                stroke="currentColor"
                stroke-width="2.4"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </span>
        </div>
        {props.trailing}
      </div>
    </div>
  );
}
