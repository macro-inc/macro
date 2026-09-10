import { For, type JSX, Show } from 'solid-js';

// Marketing chrome reproduced inside the embed so the editor iframe is the FULL
// component (compose card / channel window). That keeps the @-mention menu — a
// fixed popup that can't escape the iframe — inside a tall enough surface to
// render and flip without being clipped.

const appFont = 'var(--font-sans)';

export function Avatar(props: { initials: string; size?: number; color?: string }) {
  const s = () => props.size ?? 26;
  return (
    <span
      aria-hidden="true"
      style={{
        'align-items': 'center',
        'background-color': props.color ?? 'var(--b3)',
        border: '1px solid color-mix(in srgb, var(--c1) 16%, transparent)',
        'border-radius': '999px',
        'box-sizing': 'border-box',
        color: 'var(--c1)',
        display: 'inline-grid',
        flex: 'none',
        'font-family': appFont,
        'font-size': `${Math.round(s() * 0.38)}px`,
        'font-weight': '600',
        height: `${s()}px`,
        overflow: 'hidden',
        'place-items': 'center',
        width: `${s()}px`,
      }}
    >
      {props.initials}
    </span>
  );
}

function NavCaret(props: { dir: 'left' | 'right'; size?: number }) {
  const s = () => props.size ?? 16;
  return (
    <svg width={s()} height={s()} viewBox="0 0 24 24" aria-hidden="true" style={{ display: 'block', flex: 'none' }}>
      <path
        d={props.dir === 'left' ? 'M15 6l-6 6 6 6' : 'M9 6l6 6-6 6'}
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

function HashGlyph(props: { size?: number; color?: string }) {
  const s = () => props.size ?? 15;
  return (
    <svg width={s()} height={s()} viewBox="0 0 24 24" aria-hidden="true" style={{ display: 'block', flex: 'none' }}>
      <path d="M9 4L7 20 M17 4l-2 16 M4 9h16 M3 15h16" fill="none" stroke={props.color ?? 'var(--c4)'} stroke-width="1.7" stroke-linecap="round" />
    </svg>
  );
}

function PaperclipGlyph(props: { size?: number }) {
  const s = () => props.size ?? 16;
  return (
    <svg width={s()} height={s()} viewBox="0 0 24 24" aria-hidden="true" style={{ display: 'block', flex: 'none' }}>
      <path d="M20 11.5l-7.8 7.8a4.5 4.5 0 0 1-6.4-6.4l8-8a3 3 0 0 1 4.3 4.3l-8 8a1.5 1.5 0 0 1-2.2-2.1l7.1-7.2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  );
}

function PhoneGlyph(props: { size?: number }) {
  const s = () => props.size ?? 14;
  return (
    <svg width={s()} height={s()} viewBox="0 0 24 24" aria-hidden="true" style={{ display: 'block', flex: 'none' }}>
      <path d="M6.5 4h3l1.5 4-2 1.5a11 11 0 0 0 5 5l1.5-2 4 1.5v3a2 2 0 0 1-2 2A15 15 0 0 1 4.5 6a2 2 0 0 1 2-2z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  );
}

function ChevronGlyph(props: { size?: number; color?: string }) {
  const s = () => props.size ?? 11;
  return (
    <svg width={s()} height={s()} viewBox="0 0 24 24" aria-hidden="true" style={{ display: 'block', flex: 'none' }}>
      <path d="M6 9l6 6 6-6" fill="none" stroke={props.color ?? 'var(--c4)'} stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  );
}

const DOC_BLUE = '#5b9df0';

function DocFileGlyph(props: { size?: number; color?: string }) {
  const s = () => props.size ?? 16;
  return (
    <svg width={s()} height={s()} viewBox="0 0 24 24" aria-hidden="true" style={{ display: 'block', flex: 'none' }}>
      <rect x="4" y="3" width="16" height="18" rx="2.5" fill="none" stroke={props.color ?? DOC_BLUE} stroke-width="1.7" />
      <path d="M8 8h8 M8 12h8 M8 16h5" fill="none" stroke={props.color ?? DOC_BLUE} stroke-width="1.7" stroke-linecap="round" />
    </svg>
  );
}

// Classic OS pointer used for the synthetic "click" beat.
function PointerCursor(props: { size?: number }) {
  const s = () => props.size ?? 22;
  return (
    <svg width={s()} height={s()} viewBox="0 0 24 24" aria-hidden="true" style={{ display: 'block' }}>
      <path d="M5 2.5l13.5 7.2-5.7 1.3-1.2 5.9z" fill="var(--c1)" stroke="var(--b0)" stroke-width="1.4" stroke-linejoin="round" />
    </svg>
  );
}

function CheckBadge(props: { size?: number }) {
  const s = () => props.size ?? 26;
  return (
    <span
      aria-hidden="true"
      style={{
        'align-items': 'center',
        'background-color': 'color-mix(in srgb, var(--c4) 20%, transparent)',
        'border-radius': '999px',
        color: 'var(--c2)',
        display: 'inline-flex',
        flex: 'none',
        height: `${s()}px`,
        'justify-content': 'center',
        width: `${s()}px`,
      }}
    >
      <svg width={Math.round(s() * 0.58)} height={Math.round(s() * 0.58)} viewBox="0 0 24 24" style={{ display: 'block' }}>
        <path d="M5 12l4.5 4.5L19 7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </span>
  );
}

// The doc-mention pill shown inside the sent channel message.
function DocPill(props: { label: string }) {
  return (
    <span style={{ color: 'var(--c1)', 'font-family': appFont, 'font-weight': '500', margin: '0 2px', 'white-space': 'nowrap' }}>
      <span style={{ 'align-items': 'center', display: 'inline-flex', 'margin-right': '3px', 'vertical-align': 'middle' }}>
        <DocFileGlyph size={13} color="var(--a0)" />
      </span>
      <span style={{ 'text-decoration-line': 'underline', 'text-decoration-color': 'color-mix(in srgb, var(--c4) 50%, transparent)', 'text-underline-offset': '2px' }}>
        {props.label}
      </span>
    </span>
  );
}

// The right-hand document pane that slides in for the split-screen beat.
function DocPane() {
  const body: JSX.CSSProperties = { color: 'var(--c2)', 'font-family': appFont, 'font-size': '13.5px', 'line-height': 1.6, margin: 0 };
  const check = (done: boolean) => (
    <span aria-hidden="true" style={{ 'align-items': 'center', border: done ? '0' : '1.5px solid color-mix(in srgb, var(--c4) 40%, transparent)', 'background-color': done ? 'var(--a2)' : 'transparent', 'border-radius': '5px', color: 'var(--b0)', display: 'inline-grid', flex: 'none', height: '17px', 'place-items': 'center', width: '17px' }}>
      <Show when={done}>
        <svg width="11" height="11" viewBox="0 0 24 24" style={{ display: 'block' }}>
          <path d="M5 12l4.5 4.5L19 7" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </Show>
    </span>
  );
  return (
    <div style={{ 'background-color': '#0D0D0D', 'box-sizing': 'border-box', display: 'grid', 'grid-template-rows': 'auto 1fr', height: '100%', 'min-width': 0, width: '100%' }}>
      <div style={{ 'align-items': 'center', 'border-bottom': '1px solid var(--b2)', display: 'flex', gap: '10px', overflow: 'hidden', padding: '13px 16px' }}>
        <DocFileGlyph size={16} />
        <span style={{ color: 'var(--c1)', 'font-family': appFont, 'font-size': '14.5px', 'font-weight': '600', overflow: 'hidden', 'text-overflow': 'ellipsis', 'white-space': 'nowrap' }}>Q3 Product Roadmap</span>
        <span style={{ 'align-items': 'center', display: 'inline-flex', 'margin-left': 'auto' }}>
          <Avatar initials="JB" size={20} color="var(--b3)" />
          <span style={{ 'margin-left': '-6px' }}>
            <Avatar initials="JW" size={20} color="var(--b4)" />
          </span>
        </span>
      </div>
      <div style={{ 'box-sizing': 'border-box', display: 'grid', gap: '15px', 'align-content': 'start', overflow: 'hidden', padding: '22px' }}>
        <h3 style={{ color: 'var(--c1)', 'font-family': appFont, 'font-size': '21px', 'font-weight': '600', 'letter-spacing': '-0.01em', margin: 0 }}>Q3 Product Roadmap</h3>
        <p style={body}>
          Ship the new workspace to general availability the week of <span style={{ color: 'var(--c1)', 'font-weight': '600' }}>July 14</span>. Owners and dates below — shared automatically with everyone in #go-to-market.
        </p>
        <div style={{ display: 'grid', gap: '11px' }}>
          <div style={{ 'align-items': 'center', display: 'flex', gap: '10px' }}>{check(true)}<span style={body}>Finalize launch timeline</span></div>
          <div style={{ 'align-items': 'center', display: 'flex', gap: '10px' }}>{check(true)}<span style={body}>Lock pricing &amp; packaging</span></div>
          <div style={{ 'align-items': 'center', display: 'flex', gap: '10px' }}>{check(false)}<span style={body}>Draft the announcement post</span></div>
          <div style={{ 'align-items': 'center', display: 'flex', gap: '10px' }}>{check(false)}<span style={body}>Brief the support team</span></div>
        </div>
        <div style={{ 'align-items': 'center', 'background-color': 'color-mix(in srgb, var(--a0) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--a0) 26%, transparent)', 'border-radius': '9px', 'box-sizing': 'border-box', display: 'flex', gap: '9px', padding: '11px 13px' }}>
          <span style={{ color: 'var(--a0)', display: 'inline-flex', flex: 'none' }}><HashGlyph size={14} color="var(--a0)" /></span>
          <span style={{ color: 'var(--c2)', 'font-family': appFont, 'font-size': '12.5px', 'line-height': 1.45 }}>
            Linked from <span style={{ color: 'var(--c1)', 'font-weight': '600' }}>#go-to-market</span> — open right next to the conversation.
          </span>
        </div>
      </div>
    </div>
  );
}

/** The post-send choreography signals, driven by the autoplay. */
export type ChannelScene = {
  sent: () => boolean;
  cursorOn: () => boolean;
  clicked: () => boolean;
  split: () => boolean;
  toast: () => boolean;
};

/** Email compose card. `children` is the live editor column (the body). */
export function EmailCard(props: { children: JSX.Element }) {
  const fieldRow: JSX.CSSProperties = {
    'align-items': 'center',
    'border-bottom': '1px solid var(--b2)',
    display: 'flex',
    flex: 'none',
    gap: '10px',
    'min-height': '21px',
    padding: '12px 16px',
  };
  const labelStyle: JSX.CSSProperties = {
    color: 'var(--c4)',
    flex: 'none',
    'font-family': appFont,
    'font-size': '13px',
    width: '46px',
  };
  return (
    <div
      style={{
        'background-color': 'color-mix(in srgb, var(--b1) 70%, var(--b0))',
        'box-sizing': 'border-box',
        display: 'flex',
        'flex-direction': 'column',
        // Pin to the iframe viewport so nothing in the document flow (or a
        // stray scrollIntoView) can shift the card.
        inset: '0',
        overflow: 'hidden',
        position: 'fixed',
      }}
    >
        <div style={fieldRow}>
          <span style={labelStyle}>From</span>
          <Avatar initials="JB" size={22} color="var(--b3)" />
          <span style={{ color: 'var(--c1)', 'font-family': appFont, 'font-size': '14px' }}>Jacob Beckerman</span>
          <ChevronGlyph size={11} />
          <span style={{ color: 'var(--c4)', 'font-family': appFont, 'font-size': '13px', 'margin-left': 'auto' }}>Cc Bcc</span>
        </div>
        <div style={fieldRow}>
          <span style={labelStyle}>To</span>
          <span
            style={{
              'align-items': 'center',
              'background-color': 'color-mix(in srgb, var(--b3) 70%, transparent)',
              'border-radius': '999px',
              display: 'inline-flex',
              gap: '6px',
              padding: '3px 9px 3px 3px',
            }}
          >
            <Avatar initials="JW" size={18} color="var(--b4)" />
            <span style={{ color: 'var(--c1)', 'font-family': appFont, 'font-size': '13px' }}>Julia Westphal</span>
          </span>
        </div>
        <div style={fieldRow}>
          <span style={labelStyle}>Subject</span>
          <span style={{ color: 'var(--c1)', 'font-family': appFont, 'font-size': '14px' }}>Pitch memo: follow up</span>
        </div>
      {/* Body — the real editor (fills remaining height so the menu has room). */}
      <div style={{ 'box-sizing': 'border-box', flex: '1 1 auto', 'min-height': 0, position: 'relative' }}>
        {props.children}
      </div>
    </div>
  );
}

/** Channel window. `children` is the live editor column (the composer input).
 * `scene` (optional) drives the post-send choreography. */
export function ChannelWindow(props: { children: JSX.Element; scene?: ChannelScene }) {
  const nameStyle: JSX.CSSProperties = { color: 'var(--c1)', 'font-family': appFont, 'font-size': '13.5px', 'font-weight': '600' };
  const timeStyle: JSX.CSSProperties = { color: 'var(--c4)', 'font-family': appFont, 'font-size': '11.5px', 'white-space': 'nowrap' };
  const msgText: JSX.CSSProperties = { color: 'var(--c1)', 'font-family': appFont, 'font-size': '14.5px', 'line-height': 1.55, margin: 0 };
  const priorMessages = [
    { who: 'Gabriel Birman', initials: 'GB', time: '9:58 AM', text: 'are we locking the launch plan today?' },
    { who: 'Julia', initials: 'JW', time: '10:02 AM', text: 'finishing the timeline now — one sec' },
    { who: 'Sarah Chen', initials: 'SC', time: '10:03 AM', text: 'great — let’s share it here once it’s ready' },
  ];
  const composerBg = 'color-mix(in srgb, var(--b1) 80%, var(--b0))';
  const sent = () => props.scene?.sent() ?? false;
  const cursorOn = () => props.scene?.cursorOn() ?? false;
  const clicked = () => props.scene?.clicked() ?? false;
  const split = () => props.scene?.split() ?? false;
  const toast = () => props.scene?.toast() ?? false;

  return (
    <div
      style={{
        'background-color': '#0D0D0D',
        'box-sizing': 'border-box',
        display: 'grid',
        'grid-template-rows': 'auto 1fr auto',
        // Pin to the iframe viewport so nothing in the document flow (or a
        // stray scrollIntoView) can shift the composer off the bottom.
        inset: '0',
        'min-width': 0,
        position: 'fixed',
        'text-align': 'left',
      }}
    >
      <style>{`
        @keyframes chSent { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes chRing { 0% { opacity: 0.9; transform: scale(0.6); } 100% { opacity: 0; transform: scale(1.5); } }
      `}</style>
      {/* Header */}
      <div style={{ 'align-items': 'center', 'border-bottom': '1px solid var(--b2)', display: 'flex', gap: '13px', overflow: 'hidden', padding: '12px 16px' }}>
        <span aria-hidden="true" style={{ 'align-items': 'center', color: 'var(--c4)', display: 'inline-flex', flex: 'none', gap: '4px' }}>
          <NavCaret dir="left" />
          <NavCaret dir="right" />
        </span>
        <span style={{ 'align-items': 'center', color: 'var(--c1)', display: 'inline-flex', 'font-family': appFont, 'font-size': '15px', 'font-weight': '600', gap: '6px' }}>
          <HashGlyph size={15} /> go-to-market
        </span>
        <span style={{ 'align-items': 'center', display: 'inline-flex', gap: '10px', 'margin-left': 'auto' }}>
          <span style={{ display: 'inline-flex' }}>
            <Avatar initials="GB" size={22} color="var(--b4)" />
            <span style={{ 'margin-left': '-7px' }}>
              <Avatar initials="JW" size={22} color="var(--b3)" />
            </span>
          </span>
          <span style={{ 'align-items': 'center', color: 'var(--c2)', display: 'inline-flex', 'font-family': appFont, 'font-size': '12.5px', gap: '6px', 'white-space': 'nowrap' }}>
            <PhoneGlyph size={14} /> Call
          </span>
        </span>
      </div>

      {/* Messages */}
      <div style={{ 'box-sizing': 'border-box', display: 'flex', 'flex-direction': 'column', gap: '17px', 'justify-content': 'flex-end', 'min-height': 0, overflow: 'hidden', padding: '18px' }}>
        <For each={priorMessages}>
          {(m) => (
            <div style={{ 'align-items': 'flex-start', display: 'flex', gap: '10px' }}>
              <Avatar initials={m.initials} size={28} color="var(--b3)" />
              <div style={{ display: 'grid', gap: '2px', 'min-width': 0, width: '100%' }}>
                <div style={{ 'align-items': 'baseline', display: 'flex', gap: '8px' }}>
                  <span style={nameStyle}>{m.who}</span>
                  <span style={timeStyle}>{m.time}</span>
                </div>
                <p style={msgText}>{m.text}</p>
              </div>
            </div>
          )}
        </For>

        {/* The message the viewer just "sent", carrying the @mention */}
        <Show when={sent()}>
          <div style={{ 'align-items': 'flex-start', animation: 'chSent 320ms ease both', display: 'flex', gap: '10px' }}>
            <Avatar initials="JB" size={28} color="var(--b3)" />
            <div style={{ display: 'grid', gap: '2px', 'min-width': 0, width: '100%' }}>
              <div style={{ 'align-items': 'baseline', display: 'flex', gap: '8px' }}>
                <span style={nameStyle}>Jacob</span>
                <span style={timeStyle}>10:04 AM</span>
              </div>
              <p style={msgText}>
                Final plan is locked in{' '}
                <span style={{ display: 'inline-flex', position: 'relative', 'vertical-align': 'middle' }}>
                  <DocPill label="Q3 Product Roadmap" />
                  {/* synthetic click ring */}
                  <Show when={clicked()}>
                    <span
                      aria-hidden="true"
                      style={{ border: '2px solid color-mix(in srgb, var(--a0) 70%, transparent)', 'border-radius': '10px', inset: '-6px', animation: 'chRing 460ms ease-out both', 'pointer-events': 'none', position: 'absolute' }}
                    />
                  </Show>
                  {/* synthetic cursor */}
                  <span
                    aria-hidden="true"
                    style={{
                      bottom: '-12px',
                      opacity: cursorOn() ? 1 : 0,
                      position: 'absolute',
                      right: '-10px',
                      transform: cursorOn() ? 'translate(0,0)' : 'translate(30px, 22px)',
                      transition: 'opacity 360ms ease, transform 420ms ease',
                      'z-index': 6,
                    }}
                  >
                    <PointerCursor size={22} />
                  </span>
                </span>
              </p>
            </div>
          </div>
        </Show>
      </div>

      {/* Composer — the real editor */}
      <div style={{ 'border-top': '1px solid var(--b2)', 'box-sizing': 'border-box', padding: '12px 16px', position: 'relative' }}>
        <div style={{ 'background-color': composerBg, border: '1px solid color-mix(in srgb, var(--c4) 16%, transparent)', 'border-radius': '12px', 'box-sizing': 'border-box', position: 'relative' }}>
          <div style={{ 'box-sizing': 'border-box', position: 'relative' }}>{props.children}</div>
          <div style={{ 'align-items': 'center', display: 'flex', gap: '12px', padding: '0 12px 10px' }}>
            <span style={{ color: 'var(--c4)', display: 'inline-flex' }}>
              <PaperclipGlyph size={16} />
            </span>
            <span style={{ color: 'var(--c4)', 'font-family': appFont, 'font-size': '14px', 'font-weight': '600' }}>Aa</span>
            <span aria-hidden="true" style={{ 'align-items': 'center', 'background-color': 'var(--a0)', 'border-radius': '999px', color: 'var(--b0)', display: 'inline-flex', flex: 'none', height: '28px', 'justify-content': 'center', 'margin-left': 'auto', width: '28px' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" style={{ display: 'block' }}>
                <path d="M12 19V5M12 5l-6 6M12 5l6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </span>
          </div>
        </div>
      </div>

      {/* Doc pane — slides in from the right for the split-screen beat */}
      <div
        aria-hidden="true"
        style={{
          'border-left': '1px solid color-mix(in srgb, var(--c4) 18%, transparent)',
          bottom: 0,
          'box-shadow': '-30px 0 60px rgb(0 0 0 / 0.45)',
          'box-sizing': 'border-box',
          overflow: 'hidden',
          position: 'absolute',
          right: 0,
          top: 0,
          transform: split() ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 560ms cubic-bezier(0.22, 1, 0.36, 1)',
          width: '46%',
          'z-index': 3,
        }}
      >
        <DocPane />
      </div>

      {/* Share toast, bottom-right */}
      <div
        aria-hidden="true"
        style={{
          'align-items': 'center',
          'background-color': 'color-mix(in srgb, var(--b1) 92%, var(--b0))',
          border: '1px solid color-mix(in srgb, var(--c4) 20%, transparent)',
          'border-radius': '12px',
          bottom: '92px',
          'box-shadow': '0 20px 50px rgb(0 0 0 / 0.45)',
          'box-sizing': 'border-box',
          display: 'flex',
          gap: '11px',
          'max-width': 'calc(100% - 28px)',
          opacity: toast() ? 1 : 0,
          padding: '13px 15px',
          'pointer-events': 'none',
          position: 'absolute',
          right: '18px',
          transform: toast() ? 'translateY(0)' : 'translateY(16px)',
          transition: 'opacity 340ms ease, transform 340ms ease',
          'z-index': 7,
        }}
      >
        <CheckBadge size={26} />
        <div style={{ display: 'grid', gap: '2px', 'min-width': 0 }}>
          <span style={{ color: 'var(--c1)', 'font-family': appFont, 'font-size': '13.5px', 'font-weight': '600' }}>Shared to #go-to-market</span>
          <span style={{ color: 'var(--c4)', 'font-family': appFont, 'font-size': '12.5px' }}>Q3 Product Roadmap · everyone now has access</span>
        </div>
      </div>
    </div>
  );
}
