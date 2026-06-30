import InfoIcon from '@phosphor/info.svg';
import CaretDownIcon from '@phosphor-icons/core/regular/caret-down.svg?component-solid';
import XIcon from '@phosphor-icons/core/regular/x.svg?component-solid';
import { Tooltip } from '@ui';
import { createEffect, createSignal } from 'solid-js';

// Rendered inside a shadow root so the signature's structural markup (lists,
// headings, bold) keeps its default styling instead of being flattened by the
// app's global CSS reset — the same isolation EmailMessageBody uses for received
// mail. CSS custom properties still pierce the boundary, so --color-ink themes
// any text the signature didn't color itself.
const SHADOW_STYLE = `
  :host { color: var(--color-ink); font-family: inherit; }
  img { max-width: 100%; height: auto; }
  p { margin: 0; }
  a { color: inherit; }
`;

/**
 * Read-only preview of the signature that will be appended to the email on send.
 * The signature is already sanitized server-side; it's rendered as-is so the
 * preview matches what the recipient receives. The dismiss button drops it from
 * this one message (the parent owns the include/exclude state).
 */
export function SignaturePreview(props: {
  /**
   * Server-sanitized signature HTML. Inserted via innerHTML (the shadow root
   * scopes CSS/DOM but does NOT block scripts), so callers MUST pass sanitized
   * HTML — never raw user input. Today the only source is the saved inbox
   * setting, sanitized server-side.
   */
  html: string;
  onDismiss: () => void;
}) {
  let mountEl!: HTMLDivElement;
  // Always starts collapsed to just the bar; the user expands to preview it.
  const [expanded, setExpanded] = createSignal(false);

  createEffect(() => {
    const html = props.html;
    // Lazily attach (idempotent): a shadow root can only be attached once.
    const root = mountEl.shadowRoot ?? mountEl.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${SHADOW_STYLE}</style>${html}`;
    for (const a of root.querySelectorAll('a[href]')) {
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
    }
  });

  return (
    <div class="mt-2 rounded-lg border border-edge-muted">
      <div
        class="flex items-center justify-between gap-2 px-3 py-1.5"
        classList={{ 'border-b border-edge-muted': expanded() }}
      >
        <div class="flex items-center gap-1.5">
          <button
            type="button"
            class="flex items-center gap-1.5 text-xs font-medium text-ink-muted hover:text-ink"
            aria-expanded={expanded()}
            onClick={() => setExpanded((v) => !v)}
          >
            <CaretDownIcon
              class="size-3 transition-transform"
              classList={{ '-rotate-90': !expanded() }}
            />
            Signature
          </button>
          <Tooltip label="Edit your signature in Settings -> Connected accounts." as="span">
            <InfoIcon class="size-3.5 text-ink-muted" />
          </Tooltip>
        </div>
        <Tooltip label="Don't include signature" as="span">
          <button
            type="button"
            class="-m-1 rounded-md p-1 text-ink-muted hover:bg-hover hover:text-ink"
            aria-label="Don't include signature"
            onClick={() => props.onDismiss()}
          >
            <XIcon class="size-3.5" />
          </button>
        </Tooltip>
      </div>
      <div
        ref={mountEl}
        class="px-3 py-2 text-sm"
        classList={{ hidden: !expanded() }}
      />
    </div>
  );
}
