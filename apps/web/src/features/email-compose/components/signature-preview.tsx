import CaretDownIcon from '@icon/system/regular/caret-down.svg?component-solid';
import InfoIcon from '@icon/system/regular/info.svg';
import XIcon from '@icon/system/regular/x.svg?component-solid';
import { sanitizeEmailHtml } from '@macro-inc/email-renderer';
import { Tooltip } from '@ui';
import { createEffect, createSignal, on, Show } from 'solid-js';

// Rendered inside a shadow root so the signature's structural markup (lists,
// headings, bold) keeps its default styling instead of being flattened by the
// app's global CSS reset — the same isolation EmailMessageBody uses for received
// mail. Near-black text on the always-white surface below (not theme ink):
// recipients see the signature on white, and pasted light-UI content would
// otherwise show as white boxes in dark mode. Links keep the UA default blue,
// matching what mail clients do with unstyled anchors. Paragraph margins are
// deliberately NOT reset here: recipients' clients don't reset them either, so
// the preview shows the signature's real spacing (the editor inlines margin:0
// on its <p>s at save time — see SignatureEditor's currentHtml).
const SHADOW_STYLE = `
  :host { color: #1f1f1f; font-family: inherit; }
  img { max-width: 100%; height: auto; }
`;

/** Shared by settings and compose; raw drafts are sanitized before mounting. */
export function SignatureContent(props: {
  html: string;
  label?: string;
  prepareLinks?: (root: ShadowRoot) => void;
}) {
  let mountEl!: HTMLDivElement;
  createEffect(
    on(
      () => props.html,
      (html) => {
        const root =
          mountEl.shadowRoot ?? mountEl.attachShadow({ mode: 'open' });
        root.innerHTML = `<style>${SHADOW_STYLE}</style>${sanitizeEmailHtml(html)}`;
        for (const anchor of root.querySelectorAll('a[href]')) {
          anchor.setAttribute('target', '_blank');
          anchor.setAttribute('rel', 'noopener noreferrer');
        }
        props.prepareLinks?.(root);
      }
    )
  );
  return (
    <div
      ref={mountEl}
      role="region"
      aria-label={props.label ?? 'Signature preview'}
      class="ph-no-capture min-w-0 overflow-auto rounded-lg bg-[white] px-4 py-3 text-base [contain:content]"
    />
  );
}

/**
 * Read-only preview of the signature that will be appended to the email on send.
 * Shares the isolated HTML renderer with settings. The dismiss button drops it from
 * this one message (the parent owns the include/exclude state).
 */
export function SignaturePreview(props: {
  /** Saved inbox signature HTML. */
  html: string;
  mobile: boolean;
  prepareLinks?: (root: ShadowRoot) => void;
  onDismiss: () => void;
  dismissable?: boolean;
}) {
  // Always starts collapsed to just the bar; the user expands to preview it.
  const [expanded, setExpanded] = createSignal(false);

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
          {/* Hover-only guidance; hidden on mobile where tooltips never show
              (Settings still points mobile users to desktop). */}
          <Show when={!props.mobile}>
            <Tooltip label="Edit your signature in Settings → Email." as="span">
              <InfoIcon class="size-3.5 text-ink-muted" />
            </Tooltip>
          </Show>
        </div>
        <Show when={props.dismissable !== false}>
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
        </Show>
      </div>
      <Show when={expanded()}>
        <SignatureContent html={props.html} prepareLinks={props.prepareLinks} />
      </Show>
    </div>
  );
}
