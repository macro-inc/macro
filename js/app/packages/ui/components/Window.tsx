import { createContext, createSignal, onCleanup, Show, splitProps, useContext } from 'solid-js';
import type { JSX, ParentProps }  from 'solid-js';
import type { PanelProps } from './Panel';
import { Panel } from './Panel';

/**
 * ```tsx
 * <Window>
 *   <Window.Header>Title</Window.Header>
 *   <Window.Toolbar>...</Window.Toolbar>
 *     {props.children}
 *   <Window.Footer>...</Window.Footer>
 * </Window>
 * ```
 */

type Slot = () => JSX.Element;

type WindowContextValue = {
  setHeader: (slot: Slot | undefined) => void;
  setToolbar: (slot: Slot | undefined) => void;
  setFooter: (slot: Slot | undefined) => void;
};

const WindowContext = createContext<WindowContextValue>();

export type WindowProps = PanelProps;

export function Window(props: WindowProps) {
  const [header, setHeader] = createSignal<Slot | undefined>(undefined);
  const [toolbar, setToolbar] = createSignal<Slot | undefined>(undefined);
  const [footer, setFooter] = createSignal<Slot | undefined>(undefined);

  // Wrap in another `() =>` because Solid setters treat function values as
  // updater callbacks otherwise.
  const ctx: WindowContextValue = {
    setHeader: (slot) => setHeader(() => slot),
    setToolbar: (slot) => setToolbar(() => slot),
    setFooter: (slot) => setFooter(() => slot),
  };

  const [local, panelProps] = splitProps(props, ['children']);

  return (
    <WindowContext.Provider value={ctx}>
      <Panel
        {...panelProps}
        style={{
          'grid-template-areas': '"header" "toolbar" "body" "footer"',
          'grid-template-rows': 'auto auto minmax(0, 1fr) auto',
          'grid-template-columns': 'minmax(0, 1fr)',
          'min-height': '0',
          'display': 'grid',
          'min-width': '0',
        }}
      >
        <Show when={header()}>
          {(slot) => (
            <div
              style={{
                'border-bottom': '1px solid var(--color-edge-muted)',
                'box-sizing': 'border-box',
                'align-items': 'center',
                'grid-area': 'header',
                'padding': '0 8px',
                'display': 'flex',
                'height': '40px',
                'gap': '4px',
              }}
              data-window-header
            >
              {slot()()}
            </div>
          )}
        </Show>

        <Show when={toolbar()}>
          {(slot) => (
            <div
              style={{
                'border-bottom': '1px solid var(--color-edge-muted)',
                'box-sizing': 'border-box',
                'align-items': 'center',
                'grid-area': 'toolbar',
                'padding': '0 8px',
                'display': 'flex',
                'height': '40px',
                'gap': '4px',
              }}
              data-window-toolbar
            >
              {slot()()}
            </div>
          )}
        </Show>

        <div
          style={{
            'position': 'relative',
            'overflow': 'hidden',
            'grid-area': 'body',
            'min-height': '0',
            'min-width': '0',
          }}
          data-window-body
        >
          {local.children}
        </div>

        <Show when={footer()}>
          {(slot) => (
            <div
              style={{
                'border-top': '1px solid var(--color-edge-muted)',
                'align-items': 'center',
                'grid-area': 'footer',
                'padding': '0 8px',
                'display': 'flex',
                'height': '40px',
                'gap': '4px',
              }}
              data-window-footer
            >
              {slot()()}
            </div>
          )}
        </Show>
      </Panel>
    </WindowContext.Provider>
  );
}

Window.Header = (props: ParentProps) => {
  const ctx = useContext(WindowContext);
  if (!ctx) throw new Error('<Window.Header> must be used inside <Window>');
  ctx.setHeader(() => props.children);
  onCleanup(() => ctx.setHeader(undefined));
  return null;
};

Window.Toolbar = (props: ParentProps) => {
  const ctx = useContext(WindowContext);
  if (!ctx) throw new Error('<Window.Toolbar> must be used inside <Window>');
  ctx.setToolbar(() => props.children);
  onCleanup(() => ctx.setToolbar(undefined));
  return null;
};

Window.Body = (props: ParentProps) => <>{props.children}</>;

Window.Footer = (props: ParentProps) => {
  const ctx = useContext(WindowContext);
  if (!ctx) throw new Error('<Window.Footer> must be used inside <Window>');
  ctx.setFooter(() => props.children);
  onCleanup(() => ctx.setFooter(undefined));
  return null;
};
