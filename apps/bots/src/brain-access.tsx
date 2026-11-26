import {
  createMemo,
  createSignal,
  For,
  Index,
  Match,
  Show,
  Switch,
} from 'solid-js';
import type {
  AccessDecision,
  AccessOutcome,
  AccessRecord,
  AccessReview,
  BrainAccessScope,
  BrainAccessSource,
  BrainAccessView,
} from './brain-access-source';
import './brain-access.css';

const kindLabels = { login: 'Login', api: 'API', card: 'Card' };

type ReviewAction = AccessDecision['action'];

function RequestOutcome(props: { outcome: AccessOutcome }) {
  return (
    <Switch>
      <Match when={props.outcome.state === 'awaiting-human'}>
        Card matched for human handling. No card details disclosed and no charge
        made.
      </Match>
      <Match when={props.outcome.state === 'linked' && props.outcome}>
        {(linked) => <>Simulated link to {linked().itemName}.</>}
      </Match>
      <Match when={props.outcome.state === 'added'}>
        Item added and shared in this fixture.
      </Match>
      <Match when={props.outcome.state === 'declined'}>
        Request declined in this fixture.
      </Match>
    </Switch>
  );
}

function AccessRecordRow(props: { record: AccessRecord }) {
  return (
    <details class="brain-access-item">
      <summary>
        <strong>{props.record.name}</strong>
        <span>
          {props.record.state === 'granted' ? props.record.level : 'None'}
        </span>
        <span class="brain-access-status" data-state={props.record.state}>
          {
            {
              granted: 'Granted',
              pending: 'Pending',
              'no-access': 'No access',
            }[props.record.state]
          }
        </span>
        <span
          aria-label={
            props.record.state === 'granted'
              ? 'Masked value'
              : 'No usable value'
          }
        >
          {props.record.state === 'granted' ? '••••••••••••' : '—'}
        </span>
        <span class="brain-access-disclosure">
          {props.record.state === 'pending' ? 'Review' : 'Details'}
        </span>
      </summary>
      <div class="brain-access-details">
        <Show when={props.record.state === 'pending' && props.record}>
          {(record) => (
            <p>
              Requested {record().level} access. Existing item requests are
              managed in Tower Passwords.
            </p>
          )}
        </Show>
        <Show when={props.record.state === 'granted' && props.record}>
          {(record) => (
            <p>
              Standing approval {record().standing ? 'on' : 'off'}. Secret
              values stay masked.
            </p>
          )}
        </Show>
        <p>Updated {props.record.updatedAt}</p>
      </div>
    </details>
  );
}

function AccessRequestRow(props: {
  review: AccessReview;
  view: BrainAccessView;
  decide: (decision: AccessDecision) => ReturnType<BrainAccessSource['decide']>;
}) {
  const [action, setAction] = createSignal<ReviewAction>();
  const [message, setMessage] = createSignal('');
  const request = () => props.review.request;
  const card = () => request().kind === 'card';
  const requested = () => {
    const current = request();
    return current.kind === 'card' ? 'Card match' : current.level;
  };
  let summary: HTMLElement | undefined;

  function cancel() {
    setAction(undefined);
    setMessage('');
    summary?.focus();
  }

  function submit(event: SubmitEvent & { currentTarget: HTMLFormElement }) {
    event.preventDefault();

    const form = event.currentTarget;
    const requestId = request().id;
    const currentAction = action();
    let decision: AccessDecision;
    if (currentAction === 'link') {
      const selected = form.querySelector<HTMLInputElement>(
        'input[type="radio"]:checked'
      );
      if (!selected) return;
      decision = { requestId, action: 'link', itemId: selected.value };
    } else if (currentAction === 'add') {
      const name = form.elements.namedItem('itemName');
      if (!(name instanceof HTMLInputElement)) return;
      decision = { requestId, action: 'add', itemName: name.value };
      // Secret fields are uncontrolled and discarded without reading them.
      form.reset();
    } else if (currentAction === 'decline') {
      decision = { requestId, action: 'decline' };
    } else {
      return;
    }

    const result = props.decide(decision);
    if (result === 'resolved') {
      cancel();
    } else {
      setMessage(
        result === 'unavailable'
          ? 'Request unavailable.'
          : 'Action denied for this request.'
      );
    }
  }

  function toggle(next: ReviewAction) {
    setMessage('');
    setAction((previous) => (previous === next ? undefined : next));
  }

  return (
    <details class="brain-access-item">
      <summary
        ref={(element) => {
          summary = element;
        }}
      >
        <strong>
          <span class="brain-access-kind">{kindLabels[request().kind]}</span>
          {request().name}
        </strong>
        <span>
          <Show
            when={props.review.outcome?.state === 'awaiting-human'}
            fallback={<>Requested {requested()}</>}
          >
            Matched · No agent disclosure
          </Show>
        </span>
        <span
          class="brain-access-status"
          data-state={props.review.outcome?.state ?? 'pending'}
        >
          {
            {
              pending: 'Pending',
              linked: 'Linked',
              added: 'Shared',
              'awaiting-human': 'Awaiting human',
              declined: 'Declined',
            }[props.review.outcome?.state ?? 'pending']
          }
        </span>
        <span aria-label="No usable value">—</span>
        <span class="brain-access-disclosure">Review</span>
      </summary>
      <div class="brain-access-details">
        <p>
          <strong>Reason</strong> {request().reason}
        </p>
        <p class="brain-access-meta">
          <span>{kindLabels[request().kind]}</span>
          <span>{props.view.teamName}</span>
          <span>{props.view.viewerLabel}</span>
          <span>Requested {request().requestedAt}</span>
        </p>
        <Show when={card()}>
          <p class="brain-access-card-policy">
            Cards stay with a human. The agent receives no card details, and no
            charge is made.
          </p>
        </Show>

        <Show
          when={props.review.outcome}
          fallback={
            <Show
              when={
                props.review.choices.length > 0 || props.view.canResolveItemless
              }
              fallback={
                <p>
                  No eligible items to link. A team admin can add an item or
                  decline the request.
                </p>
              }
            >
              <div class="brain-access-actions">
                <Show when={props.review.choices.length > 0}>
                  <button
                    type="button"
                    aria-expanded={action() === 'link'}
                    onClick={() => toggle('link')}
                  >
                    Link existing
                  </button>
                </Show>
                <Show when={props.view.canResolveItemless}>
                  <button
                    type="button"
                    aria-expanded={action() === 'add'}
                    onClick={() => toggle('add')}
                  >
                    Add &amp; share new
                  </button>
                  <button
                    type="button"
                    aria-expanded={action() === 'decline'}
                    onClick={() => toggle('decline')}
                  >
                    Decline
                  </button>
                </Show>
              </div>

              <Show when={action()} keyed>
                {(active) => (
                  <form
                    class="brain-access-form"
                    autocomplete="off"
                    onSubmit={submit}
                  >
                    <Switch>
                      <Match when={active === 'link'}>
                        <fieldset>
                          <legend>
                            Choose a team{' '}
                            {kindLabels[request().kind].toLowerCase()} to link
                          </legend>
                          <For each={props.review.choices}>
                            {(item) => (
                              <label class="brain-access-choice">
                                <input
                                  type="radio"
                                  name="item"
                                  value={item.id}
                                  required
                                />
                                <span>{item.name}</span>
                              </label>
                            )}
                          </For>
                        </fieldset>
                      </Match>
                      <Match when={active === 'add'}>
                        <div class="brain-access-fields">
                          <label>
                            Item name
                            <input
                              name="itemName"
                              value={request().name}
                              maxlength={64}
                              required
                            />
                          </label>
                          <Show
                            when={card()}
                            fallback={
                              <label>
                                {request().kind === 'api'
                                  ? 'API key'
                                  : 'Password'}{' '}
                                (masked)
                                <input type="password" required />
                              </label>
                            }
                          >
                            <label>
                              Cardholder <input maxlength={48} required />
                            </label>
                            <label>
                              Card number (masked){' '}
                              <input
                                type="password"
                                inputmode="numeric"
                                required
                              />
                            </label>
                            <label>
                              Expires{' '}
                              <input placeholder="MM/YY" maxlength={7} />
                            </label>
                            <label>
                              Security code (masked){' '}
                              <input
                                type="password"
                                inputmode="numeric"
                                required
                              />
                            </label>
                          </Show>
                        </div>
                      </Match>
                      <Match when={active === 'decline'}>
                        <p>Decline this request for {props.view.agentName}?</p>
                      </Match>
                    </Switch>
                    <div class="brain-access-actions">
                      <button class="primary" type="submit">
                        <Switch>
                          <Match when={active === 'decline'}>
                            Confirm decline
                          </Match>
                          <Match when={card() && active === 'add'}>
                            Add card (human only)
                          </Match>
                          <Match when={card()}>Match card (human only)</Match>
                          <Match when={active === 'add'}>
                            Add &amp; share ({requested()})
                          </Match>
                          <Match when={active === 'link'}>
                            Link &amp; share ({requested()})
                          </Match>
                        </Switch>
                      </button>
                      <button type="button" onClick={cancel}>
                        Cancel
                      </button>
                    </div>
                  </form>
                )}
              </Show>
            </Show>
          }
        >
          {(outcome) => (
            <p role="status">
              <RequestOutcome outcome={outcome()} />
            </p>
          )}
        </Show>
        <Show when={message()}>
          <p role="status">{message()}</p>
        </Show>
      </div>
    </details>
  );
}

function ScopedAccess(props: {
  scope: BrainAccessScope;
  source: BrainAccessSource;
}) {
  const [revision, setRevision] = createSignal(0);
  const view = createMemo(() => {
    revision();
    return props.source.read(props.scope);
  });

  function decide(decision: AccessDecision) {
    const result = props.source.decide(props.scope, decision);
    if (result === 'resolved') setRevision((previous) => previous + 1);
    return result;
  }

  return (
    <Show
      when={view()}
      fallback={
        <section class="panel">
          <h2>Access unavailable</h2>
        </section>
      }
    >
      {(access) => (
        <div class="brain-access">
          <section class="panel brain-access-panel" aria-label="Account">
            <header>
              <h2>
                Account{' '}
                <span>
                  {access().agentName} · {access().teamName}
                </span>
              </h2>
              <span class="brain-access-status">Unavailable</span>
            </header>
            <div class="brain-access-panel-body">
              <strong>Account access is unavailable</strong>
              <p>
                {access().settingUp ? 'Setup is in progress. ' : ''}Grant and
                revoke actions are disabled while account status is unknown.
              </p>
              <dl class="brain-access-account-meta">
                <div>
                  <dt>Agent</dt>
                  <dd>{access().agentName}</dd>
                </div>
                <div>
                  <dt>Team</dt>
                  <dd>{access().teamName}</dd>
                </div>
                <div>
                  <dt>Writes</dt>
                  <dd>Disabled while unknown</dd>
                </div>
              </dl>
            </div>
          </section>

          <section class="panel brain-access-panel" aria-label="Passwords">
            <header>
              <h2>
                Passwords <span>{access().agentName} only</span>
              </h2>
              <span>{access().viewerLabel}</span>
            </header>
            <Show
              when={access().records.length || access().reviews.length}
              fallback={
                <p class="brain-access-panel-body">
                  No password grants or requests for {access().agentName}.
                </p>
              }
            >
              <div class="brain-access-columns" aria-hidden="true">
                <span>Item</span>
                <span>Access</span>
                <span>Status</span>
                <span>Value</span>
                <span>Action</span>
              </div>
              <Index each={access().records}>
                {(record) => <AccessRecordRow record={record()} />}
              </Index>
              <Show when={access().reviews.length > 0}>
                <h3 class="brain-access-section-label">
                  Missing item requests ·{' '}
                  {access().reviews.filter(({ outcome }) => !outcome).length}{' '}
                  pending
                </h3>
                <Index each={access().reviews}>
                  {(review) => (
                    <Show when={review().request.id} keyed>
                      <AccessRequestRow
                        review={review()}
                        view={access()}
                        decide={decide}
                      />
                    </Show>
                  )}
                </Index>
              </Show>
            </Show>
            <footer>
              Team vault stays in Tower Passwords. Changes here are simulated.
            </footer>
          </section>
        </div>
      )}
    </Show>
  );
}

export function BrainAccess(props: {
  scope: BrainAccessScope;
  source: BrainAccessSource;
}) {
  const scope = createMemo(() => ({ ...props.scope }), undefined, {
    equals: (previous, next) =>
      previous?.viewer === next.viewer &&
      previous.team === next.team &&
      previous.agent === next.agent,
  });

  return (
    <Show when={props.source} keyed>
      {(source) => (
        <Show when={scope()} keyed>
          {(current) => <ScopedAccess scope={current} source={source} />}
        </Show>
      )}
    </Show>
  );
}
