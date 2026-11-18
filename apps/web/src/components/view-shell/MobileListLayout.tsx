import { MobileTopEdgeFade } from '@components/app/mobile/MobileEdgeFade';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { createElementSize } from '@solid-primitives/resize-observer';
import {
  type Accessor,
  children,
  createContext,
  createSignal,
  type JSX,
  Show,
  useContext,
} from 'solid-js';
import { ViewShellContext } from './view-shell-context';

const MobileListInsetContext = createContext<Accessor<string>>();

/** Floating touch controls and their fade belong to the list pane, not its sidebar. */
export function MobileListLayout(props: {
  header?: JSX.Element;
  children: JSX.Element;
}) {
  const parentInset = useContext(MobileListInsetContext);
  const ws = useContext(ViewShellContext);
  const [header, setHeader] = createSignal<HTMLElement>();
  const size = createElementSize(header);
  const content = children(() => (isTouchDevice() ? props.header : undefined));
  const floating = () => Boolean(content());
  const inset = () => {
    if (!floating()) return parentInset?.() ?? '0px';
    const height = size.height
      ? `${size.height}px`
      : parentInset
        ? '3.25rem'
        : 'calc(var(--safe-top, 0px) + 3.75rem)';
    return parentInset ? `calc(${parentInset()} + ${height})` : height;
  };
  return (
    <MobileListInsetContext.Provider value={inset}>
      <div
        data-mobile-list-layout
        class="relative flex min-h-0 min-w-0 flex-1 flex-col"
        style={
          floating() ? { '--mobile-content-inset-top': inset() } : undefined
        }
      >
        <Show when={floating()}>
          <header
            ref={setHeader}
            data-mobile-list-header
            class={`pointer-events-none absolute inset-x-0 z-split-panel-chrome min-w-0 px-(--mobile-chrome-gutter) pb-3 ${parentInset ? 'pt-0' : 'pt-[calc(var(--safe-top,0px)+0.5rem)]'}`}
            style={{
              top: parentInset?.() ?? '0px',
              'padding-left':
                !parentInset && ws?.collectionLayout()
                  ? 'calc(2 * var(--mobile-chrome-gutter))'
                  : undefined,
            }}
          >
            <div class="pointer-events-auto flex min-h-10 min-w-0 flex-col">
              {content()}
            </div>
          </header>
        </Show>
        {props.children}
        <Show when={floating()}>
          <MobileTopEdgeFade />
        </Show>
      </div>
    </MobileListInsetContext.Provider>
  );
}
