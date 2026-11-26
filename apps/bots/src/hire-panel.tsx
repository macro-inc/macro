import type { ComputerSize, Quote } from '@macro-inc/sdk/generated/auth';
import { A } from '@solidjs/router';
import { createSignal, For, Show } from 'solid-js';
import { type CheckoutState, createCheckout } from './hire';
import { fixtureCheckout, saveHireReceipt } from './hire-fixture';

const messages = {
  loading: 'Checking the team and available computers…',
  'signed-out': 'Sign in to review Hire.',
  'no-team': 'Your account has no eligible team.',
  denied: 'Hiring is unavailable for this account or team role.',
  trial: 'Computer purchase is unavailable while the team is on trial.',
  'terms-unavailable': 'The team’s purchase terms are unavailable.',
  unavailable: 'The team or current offers could not be verified.',
  submitting: 'Checking the offer and submitting the preview…',
  unknown: 'The result is unconfirmed. Retry the same request to check it.',
  'scope-changed': 'The signed-in account or team changed. Hiring is paused.',
};

const notices = {
  'quote-changed':
    'The offer changed. Review the current terms before confirming.',
  'no-room': 'That computer is unavailable. Choose another size or refresh.',
  declined:
    'The preview payment was declined. Review the offer before trying again.',
  'invalid-profile':
    'Enter a name up to 64 characters and profile fields up to 4,000 characters.',
};

const sizeNames: Record<ComputerSize, string> = {
  standard: 'Standard',
  large: 'Large',
  xl: 'XL',
};

function money(amount: number, currency: string) {
  const format = new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
  });
  return format.format(
    amount / 10 ** (format.resolvedOptions().maximumFractionDigits ?? 2)
  );
}

function recurring(quote: Quote) {
  return `${money(quote.amount, quote.currency)} / ${quote.interval === 'year' ? 'year' : 'month'}`;
}

export default function HirePanel(props: {
  name: string;
  portrait: string;
  width: number;
}) {
  const [state, setState] = createSignal<CheckoutState>({ status: 'idle' });
  const [size, setSize] = createSignal<ComputerSize>();
  const [job, setJob] = createSignal('');
  const [personality, setPersonality] = createSignal('');
  let confirmedPortrait = { portrait: props.portrait, width: props.width };
  const checkout = createCheckout(fixtureCheckout, (next) => {
    setState(next);
    if (next.status === 'accepted') {
      saveHireReceipt({ name: next.agent.name, ...confirmedPortrait });
    }
    if (next.status === 'review') {
      if (
        !next.offers.sizes.some(
          (offer) => offer.size === size() && !offer.soldOut
        )
      ) {
        setSize(undefined);
      }
    }
  });
  const review = () => {
    const current = state();
    if (current.status === 'review') return current;
  };
  const selected = () =>
    review()?.offers.sizes.find((offer) => offer.size === size());
  const message = () => {
    const current = state();
    if (
      current.status === 'idle' ||
      current.status === 'review' ||
      current.status === 'accepted'
    )
      return;
    return messages[current.status];
  };

  return (
    <div class="hire-checkout">
      <Show when={state().status === 'idle'}>
        <button
          type="button"
          class="primary"
          onClick={() => void checkout.load()}
        >
          Review Hire preview
        </button>
      </Show>
      <Show when={review()}>
        {(current) => (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const choice = size();
              if (choice && state().status === 'review') {
                confirmedPortrait = {
                  portrait: props.portrait,
                  width: props.width,
                };
                void checkout.confirm(
                  {
                    name: props.name,
                    jobDescription: job(),
                    personality: personality(),
                  },
                  choice
                );
              }
            }}
          >
            <h3>Hire for {current().team}</h3>
            <label>
              Responsibilities
              <textarea
                value={job()}
                maxLength={4000}
                rows={2}
                onInput={(event) => setJob(event.currentTarget.value)}
              />
            </label>
            <label>
              Personality
              <textarea
                value={personality()}
                maxLength={4000}
                rows={2}
                onInput={(event) => setPersonality(event.currentTarget.value)}
              />
            </label>
            <fieldset>
              <legend>Computer size</legend>
              <For
                each={current().offers.sizes}
                fallback={<p>No computers are offered for this team.</p>}
              >
                {(offer) => (
                  <label class="hire-offer">
                    <input
                      type="radio"
                      name="hire-size"
                      value={offer.size}
                      checked={size() === offer.size}
                      disabled={offer.soldOut}
                      onChange={() => setSize(offer.size)}
                    />
                    <span>
                      <strong>
                        {sizeNames[offer.size]} · {recurring(offer.quote)}
                      </strong>
                      <small>
                        {offer.vcpus} vCPU · {offer.memoryGb} GiB memory ·{' '}
                        {offer.diskGb} GiB disk
                        {offer.soldOut ? ' · Sold out' : ''}
                      </small>
                    </span>
                  </label>
                )}
              </For>
            </fieldset>
            <Show when={selected()}>
              {(offer) => (
                <p>
                  Due today in preview:{' '}
                  {money(offer().dueToday, offer().quote.currency)}
                </p>
              )}
            </Show>
            <Show when={current().notice}>
              {(notice) => <p role="status">{notices[notice()]}</p>}
            </Show>
            <button type="submit" class="primary" disabled={!selected()}>
              Confirm preview Hire
            </button>
            <button type="button" onClick={() => void checkout.load()}>
              Refresh offers
            </button>
          </form>
        )}
      </Show>
      <Show when={message()}>{(copy) => <p role="status">{copy()}</p>}</Show>
      <Show when={state().status === 'unavailable'}>
        <button type="button" onClick={() => void checkout.load()}>
          Retry loading offers
        </button>
      </Show>
      <Show when={state().status === 'unknown'}>
        <button type="button" onClick={() => void checkout.retry()}>
          Retry same request
        </button>
      </Show>
      <Show when={state().status === 'accepted'}>
        <p role="status">Preview Hire accepted. Setting up.</p>
        <A href="/fleet" class="primary">
          View setup in Fleet
        </A>
      </Show>
    </div>
  );
}
