import GoogleIcon from '@icon/macro-google.svg';
import CardIcon from '@phosphor/credit-card.svg';
import AppleIcon from '@phosphor-fill/apple-logo-fill.svg';
import { createSignal, For, Show } from 'solid-js';

/** Local-only payment interaction for the development-only onboarding preview. */
export function PaymentPreview() {
  const [wallet, setWallet] = createSignal<string>();
  const [hasCardNumber, setHasCardNumber] = createSignal(false);
  return (
    <div class="flex flex-col gap-4">
      <div class="grid grid-cols-2 gap-3">
        <button
          type="button"
          aria-label="Preview Apple Pay"
          onClick={() => setWallet('Apple Pay')}
          class="flex h-11 items-center justify-center gap-1 rounded-lg bg-ink text-lg font-medium text-surface focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink"
        >
          <AppleIcon class="size-5" aria-hidden="true" /> Pay
        </button>
        <button
          type="button"
          aria-label="Preview Google Pay"
          onClick={() => setWallet('Google Pay')}
          class="flex h-11 items-center justify-center gap-1.5 rounded-lg border border-edge bg-surface text-lg font-medium text-ink focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink"
        >
          <GoogleIcon class="size-4" aria-hidden="true" /> Pay
        </button>
      </div>
      <Show when={wallet()}>
        <p role="status" class="text-xs leading-5 text-ink-muted">
          {wallet()} is shown for preview. No payment will be taken.
        </p>
      </Show>
      <div class="flex items-center gap-3 text-[11px] text-ink-extra-muted">
        <span class="h-px flex-1 bg-edge" />
        Or pay with card
        <span class="h-px flex-1 bg-edge" />
      </div>
      <div
        class="flex flex-col gap-3"
        role="group"
        aria-label="Card payment preview"
      >
        <label class="flex flex-col gap-1.5">
          <span class="text-xs text-ink-muted">Card number</span>
          <div class="relative">
            <input
              type="text"
              inputmode="numeric"
              autocomplete="off"
              placeholder="4242 4242 4242 4242"
              maxlength="23"
              onInput={(event) => {
                const digits = event.currentTarget.value.replace(/\D/g, '');
                setHasCardNumber(digits.length >= 15);
              }}
              class="h-11 w-full rounded-lg border border-edge bg-ink/[0.025] pl-3 pr-11 text-sm text-ink placeholder:text-ink-extra-muted focus:outline-2 focus:outline-ink"
            />
            <CardIcon
              class="pointer-events-none absolute right-3 top-1/2 size-5 -translate-y-1/2 text-ink-extra-muted"
              aria-hidden="true"
            />
          </div>
        </label>
        <Show when={hasCardNumber()}>
          <div class="grid grid-cols-2 gap-3">
            <For
              each={[
                ['Expiration', 'MM / YY'],
                ['Security code', 'CVC'],
              ]}
            >
              {([label, placeholder]) => (
                <div class="flex flex-col gap-1.5">
                  <span class="text-xs text-ink-muted">{label}</span>
                  <div class="flex h-11 items-center rounded-lg border border-edge bg-ink/[0.025] px-3 text-sm text-ink-extra-muted">
                    {placeholder}
                  </div>
                </div>
              )}
            </For>
          </div>
          <div class="flex flex-col gap-1.5">
            <span class="text-xs text-ink-muted">Country or region</span>
            <div class="flex h-11 items-center rounded-lg border border-edge bg-ink/[0.025] px-3 text-sm text-ink-muted">
              United States
            </div>
          </div>
          <div class="flex flex-col gap-1.5">
            <span class="text-xs text-ink-muted">ZIP code</span>
            <div class="flex h-11 items-center rounded-lg border border-edge bg-ink/[0.025] px-3 text-sm text-ink-extra-muted">
              12345
            </div>
          </div>
        </Show>
      </div>
    </div>
  );
}
