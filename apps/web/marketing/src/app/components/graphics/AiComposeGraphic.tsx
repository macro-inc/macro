import { createSignal, For, type JSX, onCleanup, Show } from 'solid-js';
import IconCheck from '../../../assets/icons/phosphor/check.svg';
import IconFunnel from '../../../assets/icons/phosphor/funnel-simple.svg';
import IconSearch from '../../../assets/icons/phosphor/magnifying-glass.svg';
import IconPaperPlaneTilt from '../../../assets/icons/phosphor/paper-plane-tilt-fill.svg';
import IconSparkle from '../../../assets/icons/phosphor/sparkle.svg';
import avatarJacobWork from '../../../assets/people/jacob-work.webp';
import { PhoneFrame, PhoneScreenContent } from '../utils/UtilPhoneFrame';

const appFont =
  "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

function ChevronGlyph(props: { size?: number }) {
  const s = props.size ?? 11;
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      aria-hidden="true"
      style={{ display: 'block', flex: 'none' }}
    >
      <path
        d="M6 9l6 6 6-6"
        fill="none"
        stroke="var(--c4)"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

// Icons are thunks (not pre-built JSX): a module-level JSX element is a DOM
// node created once, so it can't survive the phone remounting — the circles
// would end up empty. Calling the thunk per render creates a fresh node.
const stepIcon: JSX.CSSProperties = {
  display: 'block',
  height: '11px',
  width: '11px',
};
const reasoningSteps = [
  {
    label: 'Finding all your investors',
    icon: () => <IconSearch style={stepIcon} />,
  },
  { label: 'Found cap table', icon: () => <IconCheck style={stepIcon} /> },
  { label: 'Pruning email list', icon: () => <IconFunnel style={stepIcon} /> },
  {
    label: 'Thought for 32 seconds',
    icon: () => <IconSparkle style={stepIcon} />,
  },
];

export function AiComposeGraphic(props: { onExpand?: () => void } = {}) {
  const compact = () => true;
  const [expanded, setExpanded] = createSignal(false);
  const [flying, setFlying] = createSignal(false);
  const [sent, setSent] = createSignal(false);
  let sendTimers: ReturnType<typeof setTimeout>[] = [];
  const handleSend = () => {
    if (flying()) return;
    sendTimers.forEach(clearTimeout);
    setFlying(true);
    setSent(false);
    sendTimers = [
      setTimeout(() => setSent(true), 360),
      setTimeout(() => {
        setFlying(false);
        setSent(false);
      }, 1800),
    ];
  };
  onCleanup(() => sendTimers.forEach(clearTimeout));
  const bodyText: JSX.CSSProperties = {
    color: 'var(--c1)',
    'font-family': appFont,
    'font-size': compact() ? '12.5px' : '13.5px',
    'line-height': 1.5,
    margin: '0',
  };
  const fieldRow: JSX.CSSProperties = {
    'align-items': 'center',
    'border-bottom': '1px solid var(--b2)',
    display: 'flex',
    gap: '12px',
    padding: '10px 14px',
  };
  const fieldLabel: JSX.CSSProperties = {
    color: 'var(--c4)',
    'font-family': appFont,
    'font-size': '12.5px',
    width: '48px',
    flex: 'none',
  };

  return (
    <PhoneFrame small>
      <style>{`
        @media (hover) {
          .email-send-btn:hover { transform: scale(1.03); }
        }
        .email-send-btn { transition: transform 160ms ease; }
        .email-send-plane { transition: transform 120ms ease; }
        .email-draft-body { caret-color: var(--a0); cursor: text; }
        .email-draft-body:focus { background: color-mix(in srgb, var(--a0) 4%, transparent); }
        @media (prefers-reduced-motion: no-preference) {
          @keyframes emailPlaneFly {
            0% { transform: translate(0, 0) rotate(0); opacity: 1; }
            42% { transform: translate(16px, -14px) rotate(14deg); opacity: 0; }
            43% { transform: translate(-12px, 9px) rotate(0); opacity: 0; }
            100% { transform: translate(0, 0) rotate(0); opacity: 1; }
          }
          .email-send-btn.is-flying .email-send-plane { animation: emailPlaneFly 700ms cubic-bezier(0.4, 0, 0.2, 1); }
        }
      `}</style>
      <PhoneScreenContent zoom={0.75}>
        <div
          style={{
            'background-color': 'var(--b2)',
            border: '1px solid color-mix(in srgb, var(--c4) 14%, transparent)',
            'border-radius': '14px',
            'box-sizing': 'border-box',
            'justify-self': 'end',
            'margin-bottom': '30px',
            'max-width': '80%',
            padding: '11px 14px',
            position: 'relative',
          }}
        >
          <span
            style={{
              color: 'var(--c1)',
              'font-family': appFont,
              'font-size': compact() ? '13px' : '14px',
              'line-height': 1.5,
            }}
          >
            We're launching on Product Hunt soon. Write me an email to investors
            notifying them and asking them to help spread the word on Wednesday.
          </span>
        </div>

        <div style={{ display: 'grid', gap: '10px' }}>
          <div
            style={{
              display: 'grid',
              'grid-template-columns': '18px 1fr',
              'column-gap': '10px',
            }}
          >
            <For each={reasoningSteps}>
              {(step, i) => (
                <>
                  <div
                    style={{
                      'align-items': 'center',
                      display: 'flex',
                      'flex-direction': 'column',
                      'row-gap': '3px',
                    }}
                  >
                    <span
                      style={{
                        'align-items': 'center',
                        'background-color':
                          i() === reasoningSteps.length - 1
                            ? 'color-mix(in srgb, var(--a0) 18%, transparent)'
                            : 'color-mix(in srgb, var(--c1) 8%, transparent)',
                        'border-radius': '999px',
                        color:
                          i() === reasoningSteps.length - 1
                            ? 'var(--a0)'
                            : 'var(--c2)',
                        display: 'inline-flex',
                        flex: 'none',
                        height: '18px',
                        'justify-content': 'center',
                        width: '18px',
                      }}
                    >
                      {step.icon()}
                    </span>
                    <Show when={i() < reasoningSteps.length - 1}>
                      <span
                        aria-hidden="true"
                        style={{
                          'background-color':
                            'color-mix(in srgb, var(--c1) 20%, transparent)',
                          'border-radius': '1px',
                          flex: '1',
                          'min-height': '14px',
                          width: '1px',
                        }}
                      />
                    </Show>
                  </div>
                  <span
                    style={{
                      'align-self': 'center',
                      color:
                        i() === reasoningSteps.length - 1
                          ? 'var(--c2)'
                          : 'var(--c4)',
                      'font-family': appFont,
                      'font-size': '12.5px',
                      'line-height': 1.4,
                      'padding-bottom':
                        i() < reasoningSteps.length - 1 ? '16px' : '0',
                    }}
                  >
                    {step.label}
                  </span>
                </>
              )}
            </For>
          </div>

          <p
            style={{
              color: 'var(--c2)',
              'font-family': appFont,
              'font-size': compact() ? '12.5px' : '13.5px',
              'line-height': 1.5,
              margin: '0',
            }}
          >
            Drafted it. Left the To field empty so you can drop in Alex,
            BoxGroup, and the rest of the cap table.
          </p>
        </div>

        <div
          style={{
            'background-color': 'var(--b0)',
            border: '1px solid color-mix(in srgb, var(--c4) 16%, transparent)',
            'border-radius': '10px',
            'box-shadow': '0 18px 48px rgb(0 0 0 / 0.3)',
            'box-sizing': 'border-box',
            overflow: 'hidden',
          }}
        >
          <div style={fieldRow}>
            <span style={fieldLabel}>From</span>
            <img
              src={avatarJacobWork}
              alt=""
              width="18"
              height="18"
              loading="lazy"
              style={{
                border:
                  '1px solid color-mix(in srgb, var(--c4) 14%, transparent)',
                'border-radius': '999px',
                'box-sizing': 'border-box',
                display: 'block',
                flex: 'none',
                height: '18px',
                'object-fit': 'cover',
                width: '18px',
              }}
            />
            <span
              style={{
                color: 'var(--c1)',
                'font-family': appFont,
                'font-size': '13px',
                'min-width': 0,
                overflow: 'hidden',
                'text-overflow': 'ellipsis',
                'white-space': 'nowrap',
              }}
            >
              Jacob Beckerman
            </span>
            <ChevronGlyph size={10} />
            <span
              style={{
                color: 'var(--c4)',
                display: 'flex',
                flex: 'none',
                'font-family': appFont,
                'font-size': '12.5px',
                gap: '10px',
                'margin-left': 'auto',
              }}
            >
              <span>Cc</span>
              <span>Bcc</span>
            </span>
          </div>
          <div style={fieldRow}>
            <span style={fieldLabel}>To</span>
            <span
              style={{
                color: 'var(--b4)',
                'font-family': appFont,
                'font-size': '13px',
              }}
            >
              Recipients
            </span>
          </div>
          <div style={fieldRow}>
            <span style={fieldLabel}>Subject</span>
            <span
              style={{
                color: 'var(--c1)',
                'font-family': appFont,
                'font-size': '13.5px',
                'min-width': 0,
                overflow: 'hidden',
                'text-overflow': 'ellipsis',
                'white-space': 'nowrap',
              }}
            >
              Macro launches on Product Hunt: July 1
            </span>
          </div>
          <div style={{ position: 'relative' }}>
            <div
              contenteditable={true}
              spellcheck={false}
              class="email-draft-body"
              style={{
                display: 'grid',
                gap: compact() ? '9px' : '11px',
                'max-height': expanded()
                  ? 'none'
                  : compact()
                    ? '96px'
                    : '108px',
                outline: 'none',
                overflow: 'hidden',
                padding: '14px 14px 8px',
              }}
            >
              <p style={bodyText}>Hey,</p>
              <p style={bodyText}>
                Quick heads up: we're launching Macro on Product Hunt on{' '}
                <strong style={{ color: 'var(--c1)' }}>July 1</strong>.
              </p>
              <p style={bodyText}>
                This is the V1 launch: Macro as the open source company OS, one
                platform replacing Slack + Notion + Linear + Superhuman.
              </p>
              <p
                style={{
                  ...bodyText,
                  color: 'var(--c1)',
                  'font-weight': '600',
                }}
              >
                How you can help:
              </p>
              <ul
                style={{
                  ...bodyText,
                  display: 'grid',
                  gap: '5px',
                  margin: '0',
                  'padding-left': '18px',
                }}
              >
                <li>Upvote + comment the morning of July 1</li>
                <li>Repost / quote our launch tweet</li>
                <li>Forward to founders &amp; eng leaders in your network</li>
              </ul>
              <p style={bodyText}>
                Aiming for #1 Product of the Day: the first hour matters most.
              </p>
              <p style={bodyText}>Jacob</p>
            </div>
            <Show when={!expanded()}>
              <button
                type="button"
                onClick={() => {
                  setExpanded(true);
                  props.onExpand?.();
                }}
                style={{
                  'align-items': 'flex-end',
                  background:
                    'linear-gradient(to bottom, transparent 0, var(--b0) 78%)',
                  border: '0',
                  bottom: '0',
                  cursor: 'pointer',
                  display: 'flex',
                  height: '70px',
                  'justify-content': 'center',
                  left: '0',
                  padding: '0 0 8px',
                  position: 'absolute',
                  right: '0',
                }}
              >
                <span
                  style={{
                    'align-items': 'center',
                    color: 'var(--c4)',
                    display: 'flex',
                    'font-family': "'rajdhani', body",
                    'font-size': '11px',
                    'font-weight': '700',
                    gap: '8px',
                    'letter-spacing': '0.1em',
                    'text-transform': 'uppercase',
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      background: 'var(--b3)',
                      height: '1px',
                      width: '20px',
                    }}
                  />
                  Show more
                  <span
                    aria-hidden="true"
                    style={{
                      background: 'var(--b3)',
                      height: '1px',
                      width: '20px',
                    }}
                  />
                </span>
              </button>
            </Show>
          </div>
          <div
            style={{
              'align-items': 'center',
              'border-top': '1px solid var(--b2)',
              display: 'flex',
              'justify-content': 'space-between',
              padding: '10px 14px',
            }}
          >
            <span
              style={{
                color: 'var(--c4)',
                'font-family': appFont,
                'font-size': '14px',
              }}
            >
              Aa
            </span>
            <button
              type="button"
              class={`email-send-btn${flying() ? ' is-flying' : ''}`}
              onClick={handleSend}
              style={{
                'align-items': 'center',
                'background-color': 'var(--a0)',
                border: '0',
                'border-radius': '999px',
                'box-sizing': 'border-box',
                color: 'var(--b0)',
                cursor: 'pointer',
                display: 'inline-flex',
                'font-family': 'body',
                'font-size': '13px',
                'font-weight': '700',
                gap: '7px',
                height: '30px',
                'justify-content': 'center',
                'letter-spacing': '0.045em',
                'line-height': 1,
                padding: '0 16px',
                'text-transform': 'uppercase',
              }}
            >
              <span
                class="email-send-plane"
                aria-hidden="true"
                style={{ 'align-items': 'center', display: 'inline-flex' }}
              >
                <IconPaperPlaneTilt
                  style={{ display: 'block', height: '14px', width: '14px' }}
                />
              </span>
              {sent() ? 'Sent' : 'Send'}
            </button>
          </div>
        </div>
      </PhoneScreenContent>
    </PhoneFrame>
  );
}
