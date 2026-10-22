import Logo from '@icon/macro-logo.svg';
import Arrow from '@phosphor/arrow-up-right.svg';
import Calendar from '@phosphor/calendar-blank.svg';
import Chat from '@phosphor/chats-circle.svg';
import Check from '@phosphor/check.svg';
import Mail from '@phosphor/envelope.svg';
import Doc from '@phosphor/file-text.svg';
import Task from '@phosphor/list-checks.svg';
import Call from '@phosphor/phone-call.svg';
import Sparkle from '@phosphor/sparkle.svg';
import { For, type JSX } from 'solid-js';

function Tile(props: {
  id: string;
  title: string;
  description: string;
  links: { href: string; label: string }[];
  children: JSX.Element;
}) {
  return (
    <section
      class={`macro-feature-tile macro-tile-${props.id}`}
      id={props.id}
      aria-labelledby={`${props.id}-title`}
    >
      <div class="macro-tile-art" aria-hidden="true">
        {props.children}
      </div>
      <div class="macro-tile-copy">
        <h2 id={`${props.id}-title`}>{props.title}</h2>
        <p>{props.description}</p>
        <div class="macro-tile-links">
          <For each={props.links}>
            {(link) => (
              <a href={link.href}>
                {link.label}
                <Arrow aria-hidden="true" />
              </a>
            )}
          </For>
        </div>
      </div>
    </section>
  );
}

/** Small editorial illustrations; the full product pages hold interactive demos. */
export function HomepageTiles() {
  return (
    <div class="macro-feature-grid">
      <Tile
        id="email"
        title="Good conversations. Less back-and-forth."
        description="Email and team chat, connected. Share a live email thread in a channel and work on the reply together."
        links={[
          { href: '/email', label: 'Email' },
          { href: '/channels', label: 'Chat' },
        ]}
      >
        <div class="macro-mail-card macro-mini-card">
          <div class="macro-mini-heading">
            <Mail />
            <span>Project kickoff</span>
            <span class="macro-mini-time">9:41</span>
          </div>
          <strong>Let’s make it happen.</strong>
          <p>Hi Julia, the team is ready for Monday.</p>
          <div class="macro-mini-lines">
            <i />
            <i />
          </div>
        </div>
        <div class="macro-chat-card macro-mini-card">
          <div class="macro-mini-heading">
            <Chat />
            <span># launch</span>
          </div>
          <p>
            <b>Julia</b> Shared the thread. We’re all set.
          </p>
          <span class="macro-inline-mention">
            <Mail /> Project kickoff
          </span>
        </div>
      </Tile>
      <Tile
        id="documents"
        title="From the first thought to the final done."
        description="Write together in live documents. Turn messages into tasks, link the plan, and keep everyone on the same page."
        links={[
          { href: '/documents', label: 'Docs' },
          { href: '/tasks', label: 'Tasks' },
        ]}
      >
        <div class="macro-doc-card macro-mini-card">
          <span class="macro-mini-eyebrow">
            <Doc /> TEAM WORKSPACE
          </span>
          <strong>The next big thing</strong>
          <p>A little clarity goes a long way.</p>
          <div class="macro-highlight-line">
            Let’s build something great.<span>Julia</span>
          </div>
          <div class="macro-mini-lines">
            <i />
            <i />
          </div>
        </div>
        <div class="macro-task-card macro-mini-card">
          <span>
            <Check /> Write the launch plan
          </span>
          <span>
            <Check /> Share it with the team
          </span>
          <span>
            <Task /> Make it happen
          </span>
        </div>
      </Tile>
      <Tile
        id="coding-agents"
        title="A helping hand. With the whole picture."
        description="Bring your agents into the conversation. They can read your work, edit documents, and take a task through to a pull request."
        links={[
          { href: '/agents', label: 'Agents' },
          { href: '/github', label: 'GitHub' },
        ]}
      >
        <div class="macro-agent-orbit">
          <span>
            <Mail />
          </span>
          <span>
            <Doc />
          </span>
          <span>
            <Task />
          </span>
        </div>
        <div class="macro-agent-core">
          <Logo />
        </div>
        <div class="macro-agent-message macro-mini-card">
          <Sparkle />
          <div>
            <strong>Ready for your review.</strong>
            <p>I updated the plan and opened a pull request.</p>
          </div>
          <Check />
        </div>
      </Tile>
      <Tile
        id="spreadsheet"
        title="Everything adds up. Together."
        description="Sheets and databases your whole team can work in. Bring in your Google Sheets and let agents help with the next step."
        links={[{ href: '/demo', label: 'Explore the workspace' }]}
      >
        <div class="macro-sheet-card macro-mini-card">
          <div class="macro-sheet-title">
            Launch budget <span>● Saved</span>
          </div>
          <div class="macro-sheet-table">
            <span />
            <span>A</span>
            <span>B</span>
            <span>C</span>
            <span>1</span>
            <b>Channel</b>
            <b>Budget</b>
            <b>Status</b>
            <span>2</span>
            <em>Design</em>
            <em>$2,400</em>
            <em>
              <i>Ready</i>
            </em>
            <span>3</span>
            <em>Content</em>
            <em class="macro-selected-cell">$1,800</em>
            <em>
              <i>Ready</i>
            </em>
            <span>4</span>
            <em>Launch</em>
            <em>$4,200</em>
            <em>In progress</em>
            <span>5</span>
            <b>Total</b>
            <b>$8,400</b>
            <b />
          </div>
        </div>
      </Tile>
      <Tile
        id="crm"
        title="A little more personal. A lot less admin."
        description="A CRM built from your email. Keep companies, contacts, and conversations connected, with agents to help with the follow-up."
        links={[{ href: '/crm', label: 'CRM' }]}
      >
        <div class="macro-pipeline">
          <div>
            <span>
              <i /> In conversation
            </span>
            <div class="macro-mini-card">
              <b class="macro-company-icon">K</b>
              <strong>Keystone</strong>
              <p>Product walkthrough</p>
            </div>
          </div>
          <div>
            <span>
              <i /> Proposal
            </span>
            <div class="macro-mini-card">
              <b class="macro-company-icon">B</b>
              <strong>Bookend</strong>
              <p>Ready for the next chapter</p>
            </div>
          </div>
        </div>
        <div class="macro-crm-note macro-mini-card">
          <Mail />
          <span>Every conversation, right here.</span>
        </div>
      </Tile>
      <Tile
        id="calls"
        title="Be in the conversation. Keep every detail."
        description="Calls, transcripts, and calendar in your workspace. Ask an agent to turn the conversation into a plan and a follow-up."
        links={[{ href: '/calls', label: 'Calls' }]}
      >
        <div class="macro-calendar-card macro-mini-card">
          <Calendar />
          <span>MONDAY</span>
          <strong>24</strong>
          <div>
            <i /> Team catch-up <small>10:00 – 10:30</small>
          </div>
        </div>
        <div class="macro-call-card macro-mini-card">
          <div class="macro-call-avatars">
            <span>JB</span>
            <span>JL</span>
            <span>GS</span>
          </div>
          <div class="macro-waveform">
            <For each={[12, 25, 17, 33, 43, 24, 36, 16, 28, 42, 31, 19, 10]}>
              {(height) => <i style={{ height: `${height}px` }} />}
            </For>
          </div>
          <span class="macro-call-label">
            <Call /> A good idea starts here.
          </span>
        </div>
      </Tile>
    </div>
  );
}
