import { useNavigate } from '@solidjs/router';
import { createSignal, Show } from 'solid-js';
import { analytics } from '../../utils/utilAnalytic';
import {
  isLikelyEmail,
  MOBILE_SIGNUP_SENT_PATH,
  submitMobileSignup,
} from '../../utils/utilMobileSignup';

type FormMobileSignupProps = {
  /** Analytics `button_name` recorded with the submit event. */
  buttonName: string;
  /** Submit-button label. */
  buttonLabel?: string;
  /** Placeholder for the email field. */
  placeholder?: string;
  /**
   * `stacked` — field then full-width CTA (hero).
   * `inline` — CTA nested inside the field (compact header).
   */
  variant?: 'stacked' | 'inline';
};

/**
 * Email capture for mobile visitors: one field, one button, no app load.
 *
 * Submitting emails the visitor a link to open Macro on desktop (see
 * `utilMobileSignup`) and then routes to the confirmation page client-side, so
 * the whole flow stays on the static site.
 */
export function FormMobileSignup(props: FormMobileSignupProps) {
  const navigate = useNavigate();
  const [email, setEmail] = createSignal('');
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const inline = () => props.variant === 'inline';
  let inputRef: HTMLInputElement | undefined;

  const focusEmail = () => {
    // Sync focus from the tap/submit gesture so iOS/Android raise the keyboard.
    inputRef?.focus({ preventScroll: false });
  };

  const submit = async () => {
    if (pending()) return;

    const trimmed = email().trim();
    if (!isLikelyEmail(trimmed)) {
      setError('Enter a valid email address.');
      focusEmail();
      return;
    }

    setError(null);
    setPending(true);
    analytics.track('mobile_signup_submitted', {
      page_location: window.location.href,
      button_name: props.buttonName,
    });

    const result = await submitMobileSignup(trimmed);
    setPending(false);

    if (!result.ok) {
      setError(result.message);
      focusEmail();
      return;
    }
    // Dismiss the virtual keyboard before the route swap — iOS will keep it
    // up if the focused field unmounts without an explicit blur.
    inputRef?.blur();
    // The email rides along in history state as well as session storage, so
    // the confirmation page can name the address (and dedupe its conversion
    // fire) even where storage is unavailable.
    navigate(MOBILE_SIGNUP_SENT_PATH, { state: { email: trimmed } });
  };

  const buttonLabel = () =>
    pending()
      ? 'Sending…'
      : (props.buttonLabel ?? (inline() ? 'Start free' : 'Start for free'));

  return (
    <form
      style={
        inline()
          ? {
              'box-sizing': 'border-box',
              'min-width': '0',
              position: 'relative',
              width: '100%',
            }
          : {
              'box-sizing': 'border-box',
              display: 'grid',
              gap: '10px',
              'max-width': '420px',
              width: '100%',
            }
      }
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <style>{`
        .mobile-signup-field::placeholder {
          color: color-mix(in srgb, var(--c4) 62%, transparent);
        }
        .mobile-signup-field--inline::placeholder {
          font-size: 13px;
        }
        .mobile-signup-field:focus {
          border-color: color-mix(in srgb, var(--a0) 70%, transparent);
        }
        .mobile-signup-submit[disabled] {
          opacity: 0.6;
        }
        /* Invisible expanded hit area around the slim nested CTA (~44px tall). */
        .mobile-signup-submit--inline::before {
          content: '';
          position: absolute;
          top: 50%;
          left: -6px;
          right: -6px;
          height: 44px;
          transform: translateY(-50%);
        }
      `}</style>

      <div
        // Inline header field is visually 32px but needs a ≥44px thumb target.
        // Extra height is canceled with negative margin so the nav doesn't grow.
        onPointerDown={(event) => {
          if (!inline()) return;
          const target = event.target as Node;
          if (inputRef?.contains(target)) return;
          if (
            (event.target as HTMLElement | null)?.closest?.(
              '.mobile-signup-submit'
            )
          )
            return;
          focusEmail();
        }}
        style={
          inline()
            ? {
                'align-items': 'center',
                display: 'flex',
                margin: '-6px 0',
                'min-height': '44px',
                'min-width': '0',
                position: 'relative',
                width: '100%',
              }
            : {
                display: 'grid',
                gap: '10px',
                width: '100%',
              }
        }
      >
        <input
          ref={inputRef}
          class={`mobile-signup-field${inline() ? ' mobile-signup-field--inline' : ''}`}
          type="email"
          name="email"
          autocomplete="email"
          inputmode="email"
          autocapitalize="off"
          spellcheck={false}
          aria-label="Email address"
          aria-invalid={error() ? 'true' : undefined}
          placeholder={props.placeholder ?? 'Your work email'}
          value={email()}
          onInput={(event) => {
            setEmail(event.currentTarget.value);
            if (error()) setError(null);
          }}
          style={{
            'background-color':
              'color-mix(in srgb, var(--b1) 88%, transparent)',
            border: '1px solid color-mix(in srgb, var(--b4) 46%, transparent)',
            'border-radius': '999px',
            'box-sizing': 'border-box',
            color: 'var(--c0)',
            'font-family': 'body',
            // 16px minimum: iOS Safari zooms the page when focusing a smaller field.
            'font-size': '16px',
            height: inline() ? '32px' : '46px',
            outline: 'none',
            padding: inline() ? '0 96px 0 14px' : '0 18px',
            transition: 'border-color 160ms ease',
            width: '100%',
          }}
        />

        <button
          class={
            inline()
              ? 'mobile-signup-submit mobile-signup-submit--inline'
              : 'mobile-signup-submit'
          }
          type="submit"
          disabled={pending()}
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
            'font-size': inline() ? '13px' : '16px',
            'font-weight': '700',
            ...(inline()
              ? {
                  bottom: 'auto',
                  height: '26px',
                  padding: '0 12px',
                  position: 'absolute',
                  right: '3px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                }
              : {
                  height: '46px',
                  padding: '0 22px',
                  width: '100%',
                }),
            'justify-content': 'center',
            'letter-spacing': '0.01em',
            'line-height': 1,
            'white-space': 'nowrap',
          }}
        >
          {buttonLabel()}
        </button>
      </div>

      <Show when={error()}>
        <p
          aria-live="polite"
          style={{
            color: 'var(--a0)',
            'font-family': 'body',
            'font-size': '13px',
            'line-height': 1.4,
            margin: '0',
            'padding-left': '18px',
          }}
        >
          {error()}
        </p>
      </Show>
    </form>
  );
}
