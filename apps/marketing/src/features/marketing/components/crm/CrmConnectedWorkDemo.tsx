import ArrowUpRight from '@phosphor/arrow-up-right.svg';
import Buildings from '@phosphor/buildings.svg';
import File from '@phosphor/file-text.svg';
import Hash from '@phosphor/hash.svg';
import { createSignal, Show } from 'solid-js';
import { homepagePeople } from '../../core/homepage-demo-people';
import { createEmailWalkthrough } from '../../primitives/createEmailWalkthrough';

/** A company mention opens the same sample record from a plan or a conversation. */
export function CrmConnectedWorkDemo() {
  let root!: HTMLDivElement;
  const [context, setContext] = createSignal<'plan' | 'chat'>('plan');
  const [opened, setOpened] = createSignal(false);
  const [highlighted, setHighlighted] = createSignal(false);
  const playback = createEmailWalkthrough({
    root: () => root,
    steps: 3,
    advance: (step) => {
      setHighlighted(step === 1);
      if (step >= 2) setOpened(true);
    },
    reset: () => {
      setHighlighted(false);
      setOpened(false);
    },
    reduced: () => setOpened(true),
  });
  const changeContext = (value: 'plan' | 'chat') => {
    playback.pause();
    setContext(value);
    setHighlighted(false);
  };
  const openRecord = () => {
    playback.pause();
    setOpened(true);
    setHighlighted(false);
  };
  const mention = () => (
    <button
      type="button"
      class="crm-company-mention"
      data-highlighted={highlighted()}
      aria-label="Open The Meadow customer record"
      aria-controls="crm-linked-record"
      aria-expanded={opened()}
      onClick={openRecord}
    >
      <Buildings />
      The Meadow
      <ArrowUpRight />
    </button>
  );
  return (
    <div
      ref={root}
      class="crm-connected-demo crm-editorial-window glass-input"
      role="group"
      aria-label="A customer record linked from documents and team chat"
    >
      <div
        class="crm-editorial-toolbar crm-context-picker"
        role="group"
        aria-label="Choose a sample context"
      >
        <button
          type="button"
          aria-pressed={context() === 'plan'}
          onClick={() => changeContext('plan')}
        >
          <File />
          Rollout plan
        </button>
        <button
          type="button"
          aria-pressed={context() === 'chat'}
          onClick={() => changeContext('chat')}
        >
          <Hash />
          Customer team
        </button>
      </div>
      <div class="crm-connected-body">
        <div class="crm-linked-context">
          <Show
            when={context() === 'plan'}
            fallback={
              <div class="crm-linked-chat">
                <div class="crm-chat-author">
                  <img src={homepagePeople.julia.photo} alt="" />
                  <strong>Julia Westphal</strong>
                  <span>9:45 AM</span>
                </div>
                <p>
                  The rollout plan for {mention()} is ready. Dana will bring
                  Alex to Thursday’s walkthrough.
                </p>
                <p>
                  Jacob, can you send them the onboarding guide before the call?
                </p>
                <div class="crm-linked-document">
                  <File />
                  <div>
                    <strong>Customer rollout plan</strong>
                    <span>Agenda, owners, and next steps</span>
                  </div>
                </div>
              </div>
            }
          >
            <span class="crm-document-eyebrow">
              <File />
              Team documents
            </span>
            <h3>Customer rollout plan</h3>
            <p class="crm-plan-company">Customer {mention()}</p>
            <h4>Thursday’s walkthrough</h4>
            <p>
              Dana and Alex are bringing their team into Macro. Start with their
              shared inbox, then walk through the launch workspace.
            </p>
            <h4>Before the call</h4>
            <ul>
              <li>Send the onboarding guide</li>
              <li>Confirm who owns the rollout</li>
              <li>Agree on the first team workflow</li>
            </ul>
          </Show>
        </div>
        <aside
          id="crm-linked-record"
          class="crm-linked-record"
          aria-label="Linked customer record"
          data-open={opened()}
        >
          <Show
            when={opened()}
            fallback={
              <div class="crm-record-invitation">
                <Buildings />
                <p>
                  Open the company mention to see the relationship behind the
                  work.
                </p>
              </div>
            }
          >
            <div class="crm-linked-record-label">
              <Buildings />
              Customer record
            </div>
            <span class="crm-company-monogram" aria-hidden="true">
              m.
            </span>
            <h3>The Meadow</h3>
            <p class="crm-linked-domain">meadow.example</p>
            <dl>
              <div>
                <dt>Stage</dt>
                <dd>
                  <span class="crm-linked-stage-dot" />
                  Customer
                </dd>
              </div>
              <div>
                <dt>Owner</dt>
                <dd>
                  <img src={homepagePeople.jacob.photo} alt="" />
                  Jacob
                </dd>
              </div>
              <div>
                <dt>Last interaction</dt>
                <dd>Today, 9:41 AM</dd>
              </div>
            </dl>
            <h4>People</h4>
            <p>Dana Whitfield</p>
            <p>Alex Chen</p>
            <div class="crm-linked-note">
              <span>Latest team note</span>
              <p>Dana will introduce the rest of the team on Thursday.</p>
            </div>
          </Show>
        </aside>
      </div>
    </div>
  );
}
