import { createSignal, For } from 'solid-js';
import { keepLastWords } from '../../utils/utilTypography';
import { MacroMarkIcon } from '../graphics/MacroMarkIcon';

type GlyphKind =
  | 'mail'
  | 'call'
  | 'doc'
  | 'task'
  | 'clock'
  | 'lock'
  | 'connect'
  | 'arrow'
  | 'check';

export function AgentGlyph(props: { kind: GlyphKind }) {
  const paths: Record<GlyphKind, string> = {
    mail: 'M4 5h16v14H4z M4 6l8 7 8-7',
    call: 'M5 4h4l2 5-3 2a14 14 0 0 0 5 5l2-3 5 2v4c0 1-1 2-2 2A19 19 0 0 1 3 6c0-1 1-2 2-2z',
    doc: 'M5 3h9l5 5v13H5z M14 3v6h5 M9 13h6 M9 17h6',
    task: 'M3 6l2 2 4-4 M12 6h9 M3 16l2 2 4-4 M12 16h9',
    clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M12 7v5l3 2',
    lock: 'M5 10h14v11H5z M8 10V7a4 4 0 0 1 8 0v3 M12 14v3',
    connect: 'M8 3v4 M16 3v4 M6 7h12v4a6 6 0 0 1-12 0z M12 17v5',
    arrow: 'M5 12h14 M13 6l6 6-6 6',
    check: 'M5 12l4 4L19 6',
  };
  return (
    <svg
      class="agents-glyph"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d={paths[props.kind]} />
    </svg>
  );
}

function AgentIdentity() {
  return (
    <span class="agents-identity">
      <MacroMarkIcon /> <span>Macro</span>
    </span>
  );
}

const heroSources: {
  kind: GlyphKind;
  title: string;
  person: string;
  excerpt: string;
}[] = [
  {
    kind: 'call',
    title: 'Monday launch call',
    person: 'Sarah · 10:32',
    excerpt: 'Security sign-off is the last blocker. I’ll have it Wednesday.',
  },
  {
    kind: 'doc',
    title: 'Atlas launch plan',
    person: 'Updated by Julia',
    excerpt: 'Target: Thursday. Launch email goes out after sign-off.',
  },
  {
    kind: 'mail',
    title: 'Re: Pilot rollout',
    person: 'Sam → Julia',
    excerpt: 'Our team is ready. Send us the setup guide when you launch.',
  },
];

/** A responsive source-to-action diagram, with text kept live at every size. */
export function AgentHeroGraphic() {
  return (
    <figure
      class="agents-hero-graphic agents-ui"
      aria-label="An agent uses a call, a document, and an email to prepare a launch follow-up"
    >
      <div class="agents-hero-glow" aria-hidden="true" />
      <svg
        class="agents-source-wires"
        viewBox="0 0 1100 470"
        fill="none"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path d="M315 84C410 84 385 188 475 188 M343 230C411 230 410 188 475 188 M320 369C410 369 390 188 475 188" />
        <circle cx="475" cy="188" r="3" />
        <circle cx="315" cy="84" r="2" />
        <circle cx="343" cy="230" r="2" />
        <circle cx="320" cy="369" r="2" />
      </svg>
      <div class="agents-source-stack">
        <For each={heroSources}>
          {(source) => (
            <div class={`agents-source-card agents-source-${source.kind}`}>
              <div class="agents-source-title">
                <AgentGlyph kind={source.kind} />
                <span>{keepLastWords(source.title)}</span>
              </div>
              <div class="agents-source-person">{source.person}</div>
              <p>{keepLastWords(source.excerpt)}</p>
            </div>
          )}
        </For>
      </div>
      <div class="agents-hero-thread">
        <div class="agents-window-bar">
          <AgentIdentity />
          <span class="agents-meta">Atlas launch</span>
        </div>
        <div class="agents-thread-body">
          <div class="agents-user-prompt">
            What’s left before Atlas can&nbsp;launch?
          </div>
          <div class="agents-read-line">
            <AgentGlyph kind="check" /> Read the call, launch plan,
            and&nbsp;email
          </div>
          <p class="agents-hero-answer">Two things before&nbsp;Thursday.</p>
          <ol class="agents-answer-list">
            <li>
              <span>Security sign-off</span>
              <span class="agents-muted">Sarah · Wednesday</span>
            </li>
            <li>
              <span>Launch email + setup guide</span>
              <span class="agents-muted">Julia · After sign-off</span>
            </li>
          </ol>
          <div class="agents-user-prompt agents-followup-prompt">
            Create the tasks and draft the&nbsp;email.
          </div>
          <div class="agents-hero-outputs">
            <span>
              <AgentGlyph kind="task" /> 2 tasks created
            </span>
            <span>
              <AgentGlyph kind="mail" /> Draft ready to review
            </span>
          </div>
        </div>
      </div>
      <figcaption>
        A launch follow-up, from source to next&nbsp;step.
      </figcaption>
    </figure>
  );
}

const examples = [
  {
    label: 'Launch status',
    prompt: 'Are we ready to launch Atlas?',
    answer:
      'Almost. Security sign-off is due Wednesday. The launch email can go out Thursday, once Sarah clears the review.',
    sources: [
      {
        kind: 'call' as const,
        title: 'Monday launch call',
        meta: 'Sarah · 10:32',
        excerpt:
          'Security sign-off is the last blocker. I’ll have it Wednesday.',
      },
      {
        kind: 'doc' as const,
        title: 'Atlas launch plan',
        meta: 'Julia · Launch checklist',
        excerpt: 'Target: Thursday. Launch email goes out after sign-off.',
      },
    ],
  },
  {
    label: 'Customer context',
    prompt: 'What does Sam need from us?',
    answer:
      'The setup guide when Atlas launches. Sam’s team is ready for the pilot; they’re waiting on our instructions.',
    sources: [
      {
        kind: 'mail' as const,
        title: 'Re: Pilot rollout',
        meta: 'Sam → Julia',
        excerpt: 'Our team is ready. Send us the setup guide when you launch.',
      },
      {
        kind: 'doc' as const,
        title: 'Atlas launch plan',
        meta: 'Julia · Customer handoff',
        excerpt: 'Include the setup guide in the launch email to Sam’s team.',
      },
    ],
  },
  {
    label: 'Last decision',
    prompt: 'Why did we move the launch?',
    answer:
      'To leave time for the security review. The team moved Atlas from Tuesday to Thursday, keeping sign-off ahead of the customer email.',
    sources: [
      {
        kind: 'call' as const,
        title: 'Monday launch call',
        meta: 'Sarah · 10:48',
        excerpt:
          'Let’s move to Thursday so we have time to review before anything goes out.',
      },
      {
        kind: 'doc' as const,
        title: 'Atlas launch plan',
        meta: 'Julia · Decision log',
        excerpt:
          'Moved from Tuesday to Thursday. Security sign-off stays a launch requirement.',
      },
    ],
  },
];

export function AgentContextDemo() {
  const [active, setActive] = createSignal(0);
  const [source, setSource] = createSignal(0);
  const example = () => examples[active()];
  return (
    <div class="agents-context-demo agents-ui">
      <div class="agents-example-label">Explore a workspace example</div>
      <div
        class="agents-example-choices"
        role="group"
        aria-label="Choose an example question"
      >
        <For each={examples}>
          {(item, index) => (
            <button
              type="button"
              aria-pressed={active() === index()}
              onClick={() => {
                setActive(index());
                setSource(0);
              }}
            >
              {item.label}
            </button>
          )}
        </For>
      </div>
      <div class="agents-answer-window">
        <div class="agents-window-bar">
          <AgentIdentity />
          <span class="agents-meta">Ask your workspace</span>
        </div>
        <div
          class="agents-context-answer"
          aria-live="polite"
          aria-atomic="true"
        >
          <div class="agents-demo-question">
            {keepLastWords(example().prompt)}
          </div>
          <p>{keepLastWords(example().answer)}</p>
        </div>
        <div class="agents-sources">
          <span class="agents-sources-label">Sources</span>
          <div
            class="agents-source-buttons"
            role="group"
            aria-label="Read an answer source"
          >
            <For each={example().sources}>
              {(item, index) => (
                <button
                  type="button"
                  aria-pressed={source() === index()}
                  onClick={() => setSource(index())}
                >
                  <AgentGlyph kind={item.kind} />
                  <span>{item.title}</span>
                </button>
              )}
            </For>
          </div>
        </div>
      </div>
      <div class="agents-source-excerpt" aria-live="polite" aria-atomic="true">
        <div>
          <AgentGlyph kind={example().sources[source()].kind} />
          <span>{example().sources[source()].meta}</span>
          <span class="agents-source-excerpt-label">Source excerpt</span>
        </div>
        <blockquote>
          “{keepLastWords(example().sources[source()].excerpt)}”
        </blockquote>
      </div>
    </div>
  );
}
