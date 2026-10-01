import {
  type Component,
  createEffect,
  createSignal,
  For,
  type JSX,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import IconPlus from '../../../assets/icons/icon-plus.svg';
import IconSidebar from '../../../assets/icons/square-sidebar.svg';
import IconCall from '../../../assets/icons/wide-call.svg';
import IconChannels from '../../../assets/icons/wide-channel.svg';
import IconCompany from '../../../assets/icons/wide-company.svg';
import IconEmail from '../../../assets/icons/wide-email.svg';
import IconDocuments from '../../../assets/icons/wide-file-md.svg';
import IconAi from '../../../assets/icons/wide-star.svg';
import IconTasks from '../../../assets/icons/wide-task.svg';
import { HeroCallsWindow } from '../featureGraphics/CallsGraphics';
import { HeroChannelWindow } from '../featureGraphics/ChannelsGraphics';
import { HeroCompanyWindow } from '../featureGraphics/CrmGraphics';
import { HeroDocWindow } from '../featureGraphics/DocumentsGraphics';
import { HeroAppWindow } from '../featureGraphics/EmailGraphics';
import { HeroTaskWindow } from '../featureGraphics/TasksGraphics';
import { AgentThreadWindow } from '../graphics/AgentThreadWindow';
import {
  AnimatedChatIcon,
  AnimatedDiagramIcon,
  AnimatedEmailIcon,
  AnimatedFileCodeIcon,
  AnimatedFileMdIcon,
  AnimatedSnippetIcon,
  AnimatedStarIcon,
  AnimatedTaskIcon,
} from '../graphics/CreateMenuIcons';
import { MacroMarkIcon } from '../graphics/MacroMarkIcon';

// The homepage "app preview" — a clickable Macro window. The left rail mirrors
// the real product nav; selecting a section swaps the main panel to that
// feature's hero graphic (the same windows shown at the top of each feature
// page). Trimmed to the sections that have a hero, every item interactive.

// Faux-app chrome — Inter, same as the hero windows in the main panel.
const appFont =
  "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export type AppSection = {
  key: string;
  label: string;
  icon: Component<{ style?: JSX.CSSProperties }>;
  graphic: Component;
};

// Order mirrors the real product rail (Inbox / Search / Agents / Email / CRM /
// Files / Tasks / Channels / Calls); we only list the sections that have a hero
// graphic, keeping Agents above Email exactly as the app does.
const SECTIONS: AppSection[] = [
  { key: 'agents', label: 'Agents', icon: IconAi, graphic: AgentThreadWindow },
  { key: 'email', label: 'Email', icon: IconEmail, graphic: HeroAppWindow },
  { key: 'crm', label: 'CRM', icon: IconCompany, graphic: HeroCompanyWindow },
  { key: 'files', label: 'Files', icon: IconDocuments, graphic: HeroDocWindow },
  { key: 'tasks', label: 'Tasks', icon: IconTasks, graphic: HeroTaskWindow },
  {
    key: 'channels',
    label: 'Channels',
    icon: IconChannels,
    graphic: HeroChannelWindow,
  },
  { key: 'calls', label: 'Calls', icon: IconCall, graphic: HeroCallsWindow },
];

// A second rail group below "Workspace": a few unread channels, mirroring the
// macro app's "Unread" section. Decorative — each opens the Channels view.
const UNREAD_CHANNELS: { name: string; count: number }[] = [
  { name: 'bug-reports', count: 1 },
];

// Shared row style for the rail's nav items — mirrors the macro SideNav NavRow:
// rounded-md, gap-2, py-1 px-2, text-sm muted, bright when active.
function navItemStyle(
  selected: boolean,
  mobileV: boolean,
  collapsedV: boolean
): JSX.CSSProperties {
  return {
    'align-items': 'center',
    border: '0',
    'border-radius': '6px',
    // Linear's sidebar: mid-gray (~#A8AEB8) labels, 13px / medium weight, 28px
    // rows. Active item stays bright; the rest sit notably lower.
    color: selected ? 'var(--c1)' : 'var(--c4)',
    cursor: 'default',
    display: 'inline-flex',
    flex: mobileV ? 'none' : undefined,
    'font-family': appFont,
    'font-size': '13px',
    'font-weight': '400',
    gap: collapsedV ? '0' : '9px',
    'justify-content': collapsedV ? 'center' : undefined,
    'line-height': 1,
    padding: collapsedV ? '8px' : mobileV ? '9px 12px' : '6px 8px',
    'text-align': 'left',
    'white-space': 'nowrap',
  };
}

// Group heading in the rail — mirrors the macro SideNav.Group label (text-xs,
// muted). `topGap` adds the inter-group spacing the macro nav gets from gap-2.
function NavGroupLabel(props: { topGap?: boolean; children: JSX.Element }) {
  return (
    <div
      style={{
        'align-items': 'center',
        color: 'color-mix(in srgb, var(--c4) 76%, transparent)',
        display: 'flex',
        'font-family': appFont,
        'font-size': '11px',
        'font-weight': '500',
        height: '24px',
        'letter-spacing': '0.01em',
        'margin-top': props.topGap ? '12px' : '0',
        padding: '0 8px',
        'white-space': 'nowrap',
      }}
    >
      {props.children}
    </div>
  );
}

export const APP_PREVIEW_HEIGHT = {
  desktop: 608, // 16:9 at the 1080px max width
  mobile: 480,
} as const;

type CreateTile = {
  key: string;
  label: string;
  shortcut: string;
  icon: Component<{ triggerAnimation?: boolean }>;
};

const CREATE_TILES: CreateTile[] = [
  { key: 'doc', label: 'Doc', shortcut: 'D', icon: AnimatedFileMdIcon },
  { key: 'task', label: 'Task', shortcut: 'T', icon: AnimatedTaskIcon },
  {
    key: 'snippet',
    label: 'Snippet',
    shortcut: 'S',
    icon: AnimatedSnippetIcon,
  },
  { key: 'email', label: 'Email', shortcut: 'E', icon: AnimatedEmailIcon },
  { key: 'message', label: 'Message', shortcut: 'M', icon: AnimatedChatIcon },
  { key: 'agent', label: 'Agent', shortcut: 'A', icon: AnimatedStarIcon },
  { key: 'canvas', label: 'Canvas', shortcut: 'N', icon: AnimatedDiagramIcon },
  { key: 'code', label: 'Code', shortcut: 'O', icon: AnimatedFileCodeIcon },
];

// Sidebar collapse control shown in the rail header (matches the real app's
// "shrink sidebar" affordance).
function _SidebarPanelGlyph() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.7"
      aria-hidden="true"
      style={{ display: 'block' }}
    >
      <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
      <path d="M9 4.5v15" stroke-linecap="round" />
    </svg>
  );
}

function ShortcutKey(props: { label: string; muted?: boolean }) {
  return (
    <span
      aria-hidden="true"
      style={{
        'align-items': 'center',
        'background-color': props.muted
          ? 'transparent'
          : 'color-mix(in srgb, var(--b2) 70%, var(--b0))',
        border: `1px solid color-mix(in srgb, var(--b4) ${props.muted ? '7%' : '9%'}, transparent)`,
        'border-radius': '5px',
        'box-sizing': 'border-box',
        color: props.muted ? 'var(--c4)' : 'var(--c3)',
        display: 'inline-grid',
        'font-family': appFont,
        'font-size': '11px',
        'font-weight': '600',
        height: '20px',
        'line-height': 1,
        'min-width': '20px',
        padding: '0 5px',
        'place-items': 'center',
      }}
    >
      {props.label}
    </span>
  );
}

function AppPreviewCreatePalette(props: {
  open: boolean;
  onClose: () => void;
  mobile: () => boolean;
}) {
  // -1 = nothing highlighted; the "selected" look is driven by hover.
  const [selected, setSelected] = createSignal(-1);

  // Ported from the app launcher's "hold shift" flourish: pressing Shift while
  // the menu is open flashes the ⇧ key accent and ripples a border out once per
  // press, to hint the open-in-new-split gesture.
  let shiftRippleRef: HTMLSpanElement | undefined;
  const [shiftActive, setShiftActive] = createSignal(false);
  const playShiftRipple = () => {
    if (!shiftRippleRef) return;
    shiftRippleRef.classList.remove('rippling');
    void shiftRippleRef.offsetWidth; // reflow so the animation restarts
    shiftRippleRef.classList.add('rippling');
  };
  // Drop the held state whenever the menu closes.
  createEffect(() => {
    if (!props.open) setShiftActive(false);
  });

  onMount(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        props.onClose();
        return;
      }
      if (event.key === 'Shift' && props.open && !event.repeat) {
        setShiftActive(true);
        playShiftRipple();
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Shift') setShiftActive(false);
    };
    // Capture phase so the Shift press reaches us even if something else on the
    // page also handles it.
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    onCleanup(() => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
    });
  });

  return (
    <Show when={props.open}>
      <div
        role="presentation"
        onClick={props.onClose}
        style={{
          'align-items': 'center',
          'backdrop-filter': 'blur(2px)',
          background: 'color-mix(in srgb, var(--b0) 52%, transparent)',
          'box-sizing': 'border-box',
          display: 'grid',
          inset: '0',
          'justify-items': 'center',
          padding: props.mobile() ? '16px' : '24px',
          position: 'absolute',
          'z-index': '20',
        }}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Create New"
          onClick={(event) => event.stopPropagation()}
          style={{
            'background-color': 'color-mix(in srgb, var(--b1) 92%, var(--b0))',
            border: '1px solid color-mix(in srgb, var(--b4) 18%, transparent)',
            'border-radius': '16px',
            'box-shadow': 'var(--shadow-panel-lg)',
            'box-sizing': 'border-box',
            display: 'grid',
            gap: '14px',
            'max-width': '100%',
            padding: props.mobile() ? '14px' : '18px 20px 20px',
            position: 'relative',
            width: props.mobile() ? 'min(100%, 360px)' : 'min(100%, 544px)',
          }}
        >
          <style>{`
            @keyframes appShiftRipple {
              0%   { transform: scale(1); opacity: 0.55; }
              100% { transform: scale(2.2); opacity: 0; }
            }
            .shift-ripple.rippling {
              animation: appShiftRipple 0.35s cubic-bezier(0.2, 0.8, 0.4, 1) forwards;
            }
            @media (prefers-reduced-motion: reduce) {
              .shift-ripple.rippling { animation: none; opacity: 0; }
            }
            /* Suppress the browser focus ring on the decorative tiles — pressing
               Shift would otherwise flip them into :focus-visible and show it. */
            .app-preview-create-tile:focus,
            .app-preview-create-tile:focus-visible {
              outline: none;
            }
          `}</style>
          <div
            style={{
              'align-items': 'center',
              display: 'flex',
              'flex-wrap': 'wrap',
              gap: '10px 16px',
              'justify-content': 'space-between',
              // Full-bleed bottom divider matching the app panel headers.
              margin: props.mobile() ? '0 -14px' : '0 -20px',
              padding: props.mobile() ? '0 14px 12px' : '0 20px 14px',
              'border-bottom':
                '1px solid color-mix(in srgb, var(--b4) 16%, transparent)',
            }}
          >
            <span
              style={{
                color: 'var(--c1)',
                'font-family': appFont,
                'font-size': props.mobile() ? '16px' : '17px',
                'font-weight': '500',
              }}
            >
              Create new
            </span>
            <span
              style={{
                'align-items': 'center',
                color: 'var(--c4)',
                display: 'inline-flex',
                'font-family': appFont,
                'font-size': '12px',
                'font-weight': '500',
                gap: '6px',
              }}
            >
              Hold{' '}
              <span
                style={{
                  display: 'inline-flex',
                  'place-items': 'center',
                  position: 'relative',
                }}
              >
                <span
                  ref={shiftRippleRef}
                  class="shift-ripple"
                  aria-hidden="true"
                  style={{
                    border: '1px solid var(--a0)',
                    'border-radius': '5px',
                    inset: '0',
                    opacity: '0',
                    'pointer-events': 'none',
                    position: 'absolute',
                  }}
                />
                <span
                  aria-hidden="true"
                  style={{
                    'align-items': 'center',
                    'background-color': shiftActive()
                      ? 'color-mix(in srgb, var(--a0) 12%, transparent)'
                      : 'transparent',
                    border: shiftActive()
                      ? '1px solid var(--a0)'
                      : '1px solid color-mix(in srgb, var(--b4) 7%, transparent)',
                    'border-radius': '5px',
                    'box-sizing': 'border-box',
                    color: shiftActive() ? 'var(--a0)' : 'var(--c4)',
                    display: 'inline-grid',
                    'font-family': appFont,
                    'font-size': '11px',
                    'font-weight': '600',
                    height: '20px',
                    'line-height': 1,
                    'min-width': '20px',
                    padding: '0 5px',
                    'place-items': 'center',
                    transition:
                      'background-color 150ms ease, border-color 150ms ease, color 150ms ease',
                  }}
                >
                  ⇧
                </span>
              </span>{' '}
              to launch in new split
            </span>
          </div>

          <div
            onMouseLeave={() => setSelected(-1)}
            style={{
              display: 'grid',
              gap: '8px',
              'grid-template-columns': props.mobile()
                ? 'repeat(2, minmax(0, 1fr))'
                : 'repeat(4, minmax(0, 1fr))',
              // Pull out by the tile's inner inset (10px padding + 1px border) so
              // the tile text aligns with the "Create new" title above it.
              margin: '0 -11px',
            }}
          >
            <For each={CREATE_TILES}>
              {(tile, index) => {
                const active = () => selected() === index();
                return (
                  <button
                    type="button"
                    class="app-preview-create-tile"
                    aria-pressed={active()}
                    onMouseEnter={() => setSelected(index())}
                    onClick={() => setSelected(index())}
                    style={{
                      'aspect-ratio': '1.05',
                      'background-color': active()
                        ? 'color-mix(in srgb, var(--a0) 3%, var(--b1))'
                        : 'color-mix(in srgb, var(--b2) 42%, var(--b0))',
                      // Warm glow from the top-left on the active card to echo
                      // the main panel's lift.
                      'background-image': active()
                        ? 'radial-gradient(120% 120% at 0% 0%, color-mix(in srgb, var(--ambient-ink) 4%, transparent), transparent 70%)'
                        : undefined,
                      // No accent border on hover — the orange moves to the icon.
                      border:
                        '1px solid color-mix(in srgb, var(--b4) 8%, transparent)',
                      'border-radius': '12px',
                      'box-sizing': 'border-box',
                      color: active() ? 'var(--c1)' : 'var(--c4)',
                      cursor: 'default',
                      display: 'grid',
                      'grid-template-rows': 'auto 1fr auto',
                      padding: '10px',
                      'text-align': 'left',
                      transition:
                        'border-color 140ms ease, background-color 140ms ease',
                    }}
                  >
                    <div
                      style={{
                        'align-items': 'center',
                        display: 'flex',
                        'justify-content': 'space-between',
                      }}
                    >
                      <ShortcutKey label={tile.shortcut} />
                    </div>
                    <div
                      aria-hidden="true"
                      style={{
                        'align-items': 'center',
                        color: active() ? 'var(--a0)' : 'var(--c4)',
                        display: 'grid',
                        'justify-items': 'center',
                        'place-content': 'center',
                      }}
                    >
                      <div
                        style={{
                          height: props.mobile() ? '28px' : '34px',
                          width: props.mobile() ? '28px' : '34px',
                        }}
                      >
                        <Dynamic
                          component={tile.icon}
                          triggerAnimation={active()}
                        />
                      </div>
                    </div>
                    <span
                      style={{
                        'align-items': 'center',
                        display: 'inline-flex',
                        'font-family': appFont,
                        'font-size': '13px',
                        'font-weight': '600',
                      }}
                    >
                      {tile.label}
                    </span>
                  </button>
                );
              }}
            </For>
          </div>
          {/* Upper-left glow matching the mockup card's lift. */}
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              inset: '0',
              'border-radius': '16px',
              'pointer-events': 'none',
              'mix-blend-mode': 'screen',
              'background-image':
                'radial-gradient(120% 110% at 0% 0%, color-mix(in srgb, var(--ambient-ink) 3%, transparent), transparent 55%), ' +
                'radial-gradient(105% 95% at 0% 0%, color-mix(in srgb, var(--ambient-ink) 1%, transparent), transparent 46%)',
            }}
          />
        </div>
      </div>
    </Show>
  );
}

// One lever to make the whole mockup read more "zoomed out": `zoom` uniformly
// scales every px inside (fonts, padding, borders, icons) and adjusts the
// layout size, so the card keeps filling its frame. Lower = more zoomed out.
const PREVIEW_ZOOM = 1.0;

export function SceneAppPreview(props: {
  mobile?: boolean;
  // Optional controlled selection. When `active`/`onSelectSection` are passed
  // (e.g. the home page feature strip drives the preview), the rail and any
  // external control stay in sync; otherwise the preview manages its own state.
  active?: string;
  onSelectSection?: (key: string) => void;
  // Keep the desktop sidebar collapsed (icon-only) instead of auto-expanding a
  // few seconds in. Used on feature-page heroes where the rail should stay quiet.
  keepSidebarCollapsed?: boolean;
  // Extra rail sections appended after the default Workspace set — lets a feature
  // page (e.g. /github) reuse the full app shell with its own panel graphic
  // without polluting the shared home-page nav.
  extraSections?: AppSection[];
  // Section keys to drop from the rail (e.g. the home page hides 'crm').
  excludeSections?: string[];
}) {
  const mobile = () => props.mobile ?? false;
  const [internalActive, setInternalActive] = createSignal('email');
  const active = () => props.active ?? internalActive();
  const setActive = (key: string) => {
    setInternalActive(key);
    props.onSelectSection?.(key);
  };
  const [createOpen, setCreateOpen] = createSignal(false);
  // Collapsible sidebar (desktop only): collapsed shows icon-only nav. It starts
  // collapsed and animates open a few seconds after the page loads.
  const [collapsed, setCollapsed] = createSignal(true);
  const allSections = () => {
    const base = props.excludeSections?.length
      ? SECTIONS.filter((s) => !props.excludeSections!.includes(s.key))
      : SECTIONS;
    return props.extraSections && props.extraSections.length
      ? [...base, ...props.extraSections]
      : base;
  };
  const current = () =>
    allSections().find((s) => s.key === active()) ?? SECTIONS[0];

  // Switching sections (e.g. clicking an item in the home feature bar) closes
  // the create menu if it's open.
  createEffect(() => {
    active();
    setCreateOpen(false);
  });

  // Auto-open the rail shortly after load for a bit of life (desktop only; the
  // mobile layout has no collapsed state). onMount only runs in the browser, so
  // prerendered HTML simply ships the collapsed rail.
  onMount(() => {
    if (mobile()) {
      setCollapsed(false);
      return;
    }
    // Feature heroes keep the rail collapsed for a calmer mock.
    if (props.keepSidebarCollapsed) return;
    const timer = setTimeout(() => setCollapsed(false), 3000);
    onCleanup(() => clearTimeout(timer));
  });

  return (
    <div
      class="app-preview-mockup"
      style={{
        'background-color': 'color-mix(in srgb, var(--b1) 72%, var(--b0))',
        border: '1px solid color-mix(in srgb, var(--b4) 28%, transparent)',
        'border-radius': mobile() ? '10px' : '12px',
        'box-sizing': 'border-box',
        display: 'grid',
        'max-width': '100%',
        'min-width': '0',
        overflow: 'hidden',
        position: 'relative',
        width: '100%',
        // One lever to scale the whole mockup down; zoom adjusts the layout
        // size itself, so width stays 100% and the card keeps filling its frame.
        zoom: PREVIEW_ZOOM,
      }}
    >
      <style>{`
        /* Flatten every label in the mockup — hero windows inherit bold
           styles from their feature-page components. */
        .app-preview-mockup,
        .app-preview-mockup * {
          font-weight: 400 !important;
        }
        .app-preview-nav,
        .app-preview-create,
        .app-preview-railtoggle {
          appearance: none;
          -webkit-appearance: none;
          background-color: transparent;
          transition: background-color 120ms ease, color 120ms ease;
        }
        .app-preview-nav[data-active='true'] {
          background-color: color-mix(in srgb, var(--c1) 6%, transparent);
          color: var(--c2);
        }
        @media (hover) {
          /* Match the macro settings SideNav: hover adds only a faint ink/3
             wash (no text brighten); active is ink/6 + bright text. */
          .app-preview-nav:hover {
            background-color: color-mix(in srgb, var(--c1) 3%, transparent);
          }
          .app-preview-nav[data-active='true']:hover {
            background-color: color-mix(in srgb, var(--c1) 6%, transparent);
          }
          .app-preview-create:hover {
            background-color: color-mix(in srgb, var(--c1) 4%, transparent);
            color: var(--c1);
          }
          .app-preview-railtoggle:hover {
            background-color: color-mix(in srgb, var(--c1) 4%, transparent);
            color: var(--c1);
          }
          .app-preview-logo:hover {
            color: var(--c0);
          }
          .app-preview-create-tile:hover {
            border-color: color-mix(in srgb, var(--b4) 12%, transparent);
          }
        }
        .app-preview-window { transition: box-shadow 200ms ease, border-color 200ms ease; }
        .docs-hero-window, .tasks-hero-window, .channels-hero-window, .calls-hero-window, .crm-hero-window {
          transition: box-shadow 200ms ease, border-color 200ms ease;
        }
        /* Hero windows carry a bottom mask (applied inline) for feature-page
           heroes; in the app preview that reads as a fade over the bottom of the
           mockup. The masks are inline, so !important is required to beat them. */
        .app-preview-panel .docs-hero-window,
        .app-preview-panel .tasks-hero-window,
        .app-preview-panel .channels-hero-window,
        .app-preview-panel .calls-hero-window,
        .app-preview-panel .agents-hero-window,
        .app-preview-panel .crm-hero-window,
        .app-preview-panel .hero-app-window {
          -webkit-mask-image: none !important;
          mask-image: none !important;
          /* Drop the bright inset top-highlight from --shadow-window (it reads as
             a thick top border in the preview); keep a soft, subtle drop shadow. */
          box-shadow: 0 16px 48px -26px rgb(0 0 0 / 0.5) !important;
        }
        /* Tighter top/side padding in the preview pulls each window's title up
           and left to line up with the sidebar icons; bottom keeps its gap.
           Applies to every section window so they all align consistently. */
        .app-preview-panel .hero-app-window,
        .app-preview-panel .docs-hero-window,
        .app-preview-panel .tasks-hero-window,
        .app-preview-panel .channels-hero-window,
        .app-preview-panel .calls-hero-window,
        .app-preview-panel .agents-hero-window,
        .app-preview-panel .crm-hero-window {
          padding: 1px 1px 7px !important;
        }
        /* The window padding is tight so the title aligns with the rail icons;
           give the body (row list) back some top breathing room. Sides stay 0 so
           the rows/dividers' own 16px padding lines up with the toolbar title. */
        .app-preview-panel .hero-app-rows {
          padding: 10px 0 0 !important;
        }
        /* Pull each row's hover/selected highlight in a few px so it doesn't
           touch the window edge; trim the row's side padding by the same amount
           so the row content stays aligned with the toolbar title. */
        .app-preview-panel .hero-row,
        .app-preview-panel .calls-hero-row,
        .app-preview-panel .tasks-hero-row {
          margin-left: 6px !important;
          margin-right: 6px !important;
          padding-left: 10px !important;
          padding-right: 10px !important;
        }
        /* Every window fills the panel (height − 2x10 padding) as a flex column,
           so the body (the section grid's 1fr row) expands to fill even when its
           content is short — instead of the card shrinking to content height. */
        .app-preview-panel .hero-app-window,
        .app-preview-panel .docs-hero-window,
        .app-preview-panel .tasks-hero-window,
        .app-preview-panel .channels-hero-window,
        .app-preview-panel .calls-hero-window,
        .app-preview-panel .agents-hero-window,
        .app-preview-panel .crm-hero-window {
          display: flex !important;
          flex-direction: column !important;
          height: ${mobile() ? APP_PREVIEW_HEIGHT.mobile - 10 : APP_PREVIEW_HEIGHT.desktop - 20}px !important;
          /* The outer mockup (radius 12px) insets this card by ~5px (panel
             padding), so for concentric corners the card is 12 − 5 = 7px. Its
             inner surface then stays concentric at 7 − ~2px padding = 5px. */
          border-radius: 7px !important;
          /* Feature-page windows ship a light 1px border; under the glass rim
             (::after) below that reads as a harsh doubled edge at the corners.
             Swap it for the same dark, subtle border the outer mockup uses so the
             rim supplies the highlight and the border only defines the edge. */
          border-color: color-mix(in srgb, var(--b4) 8%, transparent) !important;
          position: relative !important;
        }
        /* The Calls / Channels / Files (docs) windows ship a near-black
           surface (#080808) for their standalone feature-page heroes; next to
           the Agents/Email/Tasks windows (which use the lighter default
           PreviewWindow surface that catches the preview's top-left glow) that
           reads as a flat dark panel. In the home preview, re-tint them to the
           shared default surface so every section matches. */
        .app-preview-panel .docs-hero-window,
        .app-preview-panel .channels-hero-window,
        .app-preview-panel .calls-hero-window {
          background-color: color-mix(in srgb, var(--b1) 58%, var(--b0)) !important;
        }
        .app-preview-panel .docs-hero-window > div,
        .app-preview-panel .channels-hero-window > div,
        .app-preview-panel .calls-hero-window > div {
          background-color: #0D0D0D !important;
        }
        /* Apple "liquid glass" rim (same recipe as the home feature-strip bar
           and the outer mockup frame): a masked 1px gradient border that catches
           light at the top-left and bottom-right corners and fades along the rest
           of the edge, so each inner window reads like a polished pane of glass. */
        .app-preview-panel .hero-app-window::after,
        .app-preview-panel .docs-hero-window::after,
        .app-preview-panel .tasks-hero-window::after,
        .app-preview-panel .channels-hero-window::after,
        .app-preview-panel .calls-hero-window::after,
        .app-preview-panel .agents-hero-window::after,
        .app-preview-panel .crm-hero-window::after {
          content: '';
          position: absolute;
          inset: 0;
          border-radius: inherit;
          padding: 1px;
          background: linear-gradient(
            135deg,
            color-mix(in srgb, var(--c1) 8%, transparent) 0%,
            transparent 24%,
            transparent 76%,
            color-mix(in srgb, var(--c1) 5%, transparent) 100%
          );
          -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
          -webkit-mask-composite: xor;
          mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
          mask-composite: exclude;
          pointer-events: none;
          z-index: 3;
        }
        .app-preview-panel .hero-app-window > div,
        .app-preview-panel .docs-hero-window > div,
        .app-preview-panel .tasks-hero-window > div,
        .app-preview-panel .channels-hero-window > div,
        .app-preview-panel .calls-hero-window > div,
        .app-preview-panel .agents-hero-window > div {
          flex: 1 1 auto !important;
          min-height: 0 !important;
          display: flex !important;
          flex-direction: column !important;
        }
        .app-preview-panel .hero-app-window > div > div,
        .app-preview-panel .docs-hero-window > div > div,
        .app-preview-panel .tasks-hero-window > div > div,
        .app-preview-panel .channels-hero-window > div > div,
        .app-preview-panel .calls-hero-window > div > div,
        .app-preview-panel .agents-hero-window > div > div {
          flex: 1 1 auto !important;
          min-height: 0 !important;
        }
        /* The CRM window's inner surface is a 2-column grid (record + details
           rail), not the single flex column the other windows use — so it grows
           to fill the fixed-height card while keeping its grid layout intact. */
        .app-preview-panel .crm-hero-window > div {
          flex: 1 1 auto !important;
          min-height: 0 !important;
        }
        @media (prefers-reduced-motion: no-preference) {
          @keyframes appPreviewCaretBlink { 0%, 49% { opacity: 1; } 50%, 100% { opacity: 0; } }
          .docs-caret, .tasks-caret, .channels-caret {
            animation: appPreviewCaretBlink 1.1s steps(1) infinite;
          }
          @keyframes appPreviewCollabBlink { 0%, 55% { opacity: 1; } 56%, 100% { opacity: 0.25; } }
          .docs-collab-caret { animation: appPreviewCollabBlink 1s steps(1) infinite; }
        }
      `}</style>

      {/* Extremely subtle, near-neutral glow from the top-left for the card's
          back — rail plus the padding around the active window — so it reads as
          one continuous light. `screen` only lightens. The active window sits
          above this (z-index 6) and carries its own glow, so this one stops at
          the window's edge. Below the create-menu popover (z-index 20). */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: '0',
          'pointer-events': 'none',
          'z-index': '5',
          'mix-blend-mode': 'screen',
          'background-image':
            'radial-gradient(120% 110% at 0% 0%, color-mix(in srgb, var(--ambient-ink) 3%, transparent), transparent 55%), ' +
            'radial-gradient(105% 95% at 0% 0%, color-mix(in srgb, var(--ambient-ink) 1%, transparent), transparent 46%)',
        }}
      />

      <div
        style={{
          'box-sizing': 'border-box',
          display: 'grid',
          // The rail column sizes to the nav's own (animated) width, so the
          // open/close transition lives on the nav element rather than here —
          // animating grid-template-columns is unreliable under the card's `zoom`.
          // On mobile the rail is dropped entirely (the home feature strip below
          // the mockup is the section switcher), so the window gets the full card.
          'grid-template-columns': mobile()
            ? 'minmax(0, 1fr)'
            : 'auto minmax(0, 1fr)',
          'grid-template-rows': 'minmax(0, 1fr)',
          // Enforced height (sized to hug the default email panel) so switching
          // sections in the nav doesn't shift the page layout.
          height: mobile()
            ? `${APP_PREVIEW_HEIGHT.mobile}px`
            : `${APP_PREVIEW_HEIGHT.desktop}px`,
          width: '100%',
        }}
      >
        {/* Left rail — desktop only. On mobile it duplicates the feature strip
            beneath the mockup and its labels clip at the card edge, so it's
            dropped and the window fills the whole card instead. */}
        <Show when={!mobile()}>
          <nav
            aria-label="Macro sections"
            class={mobile() ? 'no-scrollbar' : undefined}
            style={{
              'align-content': 'start',
              // Same background as the content panel, with no dividing line.
              'background-color': 'var(--b0)',
              'border-bottom': '0',
              'border-right': '0',
              'box-sizing': 'border-box',
              display: mobile() ? 'flex' : 'grid',
              gap: mobile() ? '6px' : '5px',
              // Desktop: animate the rail open/closed. overflow hidden + nowrap
              // means the labels are revealed (clipped) as the width grows.
              overflow: mobile() ? undefined : 'hidden',
              'overflow-x': mobile() ? 'auto' : undefined,
              padding: mobile()
                ? '12px'
                : collapsed()
                  ? '12px 5px'
                  : '12px 8px',
              transition: mobile()
                ? undefined
                : 'width 620ms cubic-bezier(0.16, 1, 0.3, 1), padding 620ms cubic-bezier(0.16, 1, 0.3, 1)',
              width: mobile() ? undefined : collapsed() ? '46px' : '196px',
            }}
          >
            {/* Header: Macro logo + sidebar toggle. When collapsed, only the
              toggle remains, taking the logo's place. */}
            <Show when={!mobile()}>
              <div
                style={{
                  'align-items': 'center',
                  display: 'flex',
                  'justify-content': collapsed() ? 'center' : 'space-between',
                  padding: '4px 6px 18px',
                }}
              >
                <Show when={!collapsed()}>
                  <span
                    class="app-preview-logo base-header-logo"
                    aria-hidden="true"
                    style={{
                      'align-items': 'center',
                      color: 'var(--c3)',
                      display: 'inline-flex',
                      'line-height': 1,
                      'margin-top': '-5px',
                    }}
                  >
                    <MacroMarkIcon
                      style={{
                        color: 'currentColor',
                        display: 'block',
                        fill: 'currentColor',
                        height: '15px',
                        overflow: 'visible',
                        stroke: 'none',
                      }}
                    />
                  </span>
                </Show>
                <button
                  type="button"
                  class="app-preview-railtoggle"
                  aria-label={
                    collapsed() ? 'Expand sidebar' : 'Collapse sidebar'
                  }
                  aria-expanded={!collapsed()}
                  onClick={() => setCollapsed((c) => !c)}
                  style={{
                    'align-items': 'center',
                    border: '0',
                    'border-radius': '6px',
                    color: 'var(--c4)',
                    cursor: 'default',
                    display: 'inline-flex',
                    padding: '4px',
                  }}
                >
                  <IconSidebar
                    aria-hidden="true"
                    style={{ display: 'block', height: '16px', width: '16px' }}
                  />
                </button>
              </div>

              <button
                type="button"
                class="app-preview-create"
                aria-expanded={createOpen()}
                aria-haspopup="dialog"
                onClick={() => setCreateOpen(true)}
                style={{
                  'align-items': 'center',
                  border: '0',
                  'border-radius': '7px',
                  'box-sizing': 'border-box',
                  color: 'color-mix(in srgb, var(--c3) 62%, transparent)',
                  cursor: 'default',
                  display: 'flex',
                  'font-family': appFont,
                  'font-size': '12px',
                  'font-weight': '400',
                  gap: collapsed() ? '0' : '10px',
                  'justify-content': collapsed() ? 'center' : undefined,
                  'line-height': 1,
                  margin: '0 0 11px',
                  padding: collapsed() ? '7px' : '7px 9px',
                  width: '100%',
                }}
              >
                <IconPlus
                  aria-hidden="true"
                  style={{
                    color: 'currentColor',
                    display: 'block',
                    flex: 'none',
                    height: '16px',
                    width: '16px',
                  }}
                />
                <Show when={!collapsed()}>
                  <span style={{ flex: '1', 'text-align': 'left' }}>
                    Create
                  </span>
                </Show>
              </button>
            </Show>

            <Show when={!mobile() && !collapsed()}>
              <NavGroupLabel>Workspace</NavGroupLabel>
            </Show>
            <For each={allSections()}>
              {(section) => {
                const selected = () => active() === section.key;
                return (
                  <button
                    type="button"
                    class="app-preview-nav"
                    aria-current={selected() ? 'page' : undefined}
                    data-active={selected() ? 'true' : 'false'}
                    onClick={() => setActive(section.key)}
                    style={navItemStyle(selected(), mobile(), collapsed())}
                  >
                    <Dynamic
                      component={section.icon}
                      aria-hidden="true"
                      style={{
                        color: 'currentColor',
                        display: 'block',
                        flex: 'none',
                        height: '16px',
                        // Let strokes near the viewBox edge show instead of being
                        // clipped at the icon box (wide-* icons sit flush to it).
                        overflow: 'visible',
                        width: '16px',
                      }}
                    />
                    <Show when={!collapsed()}>{section.label}</Show>
                  </button>
                );
              }}
            </For>

            {/* Second group — a few unread channels, mirroring the macro app's
              "Unread" rail section. Desktop only (the mobile rail is a flat
              horizontal strip). Brighter text + a count read as unread. */}
            <Show when={!mobile()}>
              <Show when={!collapsed()}>
                <NavGroupLabel topGap>Unread</NavGroupLabel>
              </Show>
              <For each={UNREAD_CHANNELS}>
                {(ch) => (
                  <button
                    type="button"
                    class="app-preview-nav"
                    onClick={() => setActive('channels')}
                    style={{
                      ...navItemStyle(false, mobile(), collapsed()),
                      color: 'var(--c4)',
                      'font-weight': '450',
                    }}
                  >
                    <IconChannels
                      aria-hidden="true"
                      style={{
                        color: 'currentColor',
                        display: 'block',
                        flex: 'none',
                        height: '16px',
                        overflow: 'visible',
                        width: '16px',
                      }}
                    />
                    <Show when={!collapsed()}>
                      <span style={{ flex: '1', 'text-align': 'left' }}>
                        {ch.name}
                      </span>
                      <span
                        style={{
                          color: 'var(--c4)',
                          'font-size': '11px',
                          'font-weight': '500',
                        }}
                      >
                        {ch.count}
                      </span>
                    </Show>
                  </button>
                )}
              </For>
            </Show>
          </nav>
        </Show>

        {/* Main panel — the selected section's hero window */}
        <div
          class="app-preview-panel"
          style={{
            'align-content': 'start',
            'background-color': 'var(--b0)',
            'box-sizing': 'border-box',
            display: 'grid',
            height: '100%',
            'min-width': 0,
            overflow: 'hidden',
            // Tighter top padding pulls the window's toolbar up to line up with
            // the sidebar's top icons; reduced right/bottom tighten the gap to
            // the outer mockup. No left padding so it sits flush with the rail.
            // On mobile there's no rail, so a small even inset lets the window
            // fill the card edge-to-edge (more width = no content clipping).
            padding: mobile() ? '5px' : '4px 4px 8px 0',
            'place-items': 'start center',
            position: 'relative',
          }}
        >
          <div
            style={{
              'align-items': 'start',
              display: 'flex',
              'justify-content': 'center',
              // No max-width cap: the window fills the panel and expands flush
              // with the rail when it collapses, instead of capping + centering
              // (which left a gap where the rail used to be).
              'min-width': 0,
              // Lift just the active window above the card's back glow (z 5) so
              // that glow lights the rail + surrounding padding but not the
              // window — which carries its own glow (below), confined to here.
              position: 'relative',
              'z-index': '6',
              width: '100%',
            }}
          >
            <Show when={current()} keyed>
              {(section) => <Dynamic component={section.graphic} />}
            </Show>
            {/* The active window's own directional "lighting", confined to this
                box (so the dark sidebar stays dark): a soft highlight pooling in
                the top-left and a gentle shade in the bottom-right, toned down so
                it reads as ambient light rather than a screenshot overlay. */}
            <div
              aria-hidden="true"
              style={{
                position: 'absolute',
                inset: '0',
                'pointer-events': 'none',
                // Match the hero window's radius so the glow doesn't bleed past
                // its rounded corners.
                'border-radius': '12px',
                background:
                  'radial-gradient(125% 115% at 0% 0%, color-mix(in srgb, var(--ambient-ink) 5%, transparent) 0%, color-mix(in srgb, var(--ambient-ink) 2%, transparent) 22%, transparent 52%), ' +
                  'radial-gradient(130% 118% at 100% 100%, color-mix(in srgb, var(--b0) 26%, transparent) 0%, color-mix(in srgb, var(--b0) 9%, transparent) 28%, transparent 58%)',
              }}
            />
          </div>
        </div>
      </div>

      <AppPreviewCreatePalette
        open={createOpen()}
        mobile={mobile}
        onClose={() => setCreateOpen(false)}
      />
    </div>
  );
}
