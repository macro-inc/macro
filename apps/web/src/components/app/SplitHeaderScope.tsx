import { cn } from '@ui';
import {
  children,
  createContext,
  createSignal,
  type JSX,
  type ParentProps,
  Show,
  useContext,
} from 'solid-js';
import { createStore } from 'solid-js/store';
import {
  createPriorityCollapseController,
  PriorityCollapseOverflowSensor,
} from '../priority-collapse/PriorityCollapseOverflowSensor';
import { useTouchTopBarsFloat } from '../view-shell/touch-top-bar';
import { ViewShell } from '../view-shell/ViewShell';
import {
  SplitPanelContext,
  type SplitPanelContextType,
} from './split-layout/context';

/**
 * A split header for content hosted inside another view's pane, such as an
 * inline preview. Hosted content contributes through `SplitHeaderLeft`,
 * `SplitHeaderRight`, the title file menu, or a mobile view's `MobileHeader`
 * exactly as it does to its own split's header, so a document shows the same
 * title island and actions whether it fills a split or sits beside a list.
 * `SplitHeaderScope.TopBar` places those contributions in the pane's top bar.
 */
type SplitHeaderScopeValue = {
  setLayoutRef: (
    key: keyof SplitPanelContextType['layoutRefs'],
    element: HTMLDivElement
  ) => void;
  headerCollapse: ReturnType<typeof createPriorityCollapseController>;
  toolbarCollapse: ReturnType<typeof createPriorityCollapseController>;
};

const SplitHeaderScopeContext = createContext<SplitHeaderScopeValue>();

/** Present when the enclosing host shows hosted content's split header. */
export function useSplitHeaderScope() {
  return useContext(SplitHeaderScopeContext);
}

type RootProps = ParentProps<{
  /** False passes the split's own header through; switching remounts children. */
  when?: boolean;
  /** The split the host belongs to; defaults to the enclosing one. */
  panel?: SplitPanelContextType;
  /** A hotkey scope of the host's own, as an inline preview keeps. */
  splitHotkeyScope?: string;
  isInlinePreview?: boolean;
}>;

function Root(props: RootProps) {
  return (
    <Show
      when={props.when ?? true}
      fallback={
        // A host that keeps its own bar hides any enclosing scope, so its
        // content doesn't draw a hosted header meant for an outer host.
        <SplitHeaderScopeContext.Provider value={undefined}>
          {props.children}
        </SplitHeaderScopeContext.Provider>
      }
    >
      <ActiveRoot {...props} />
    </Show>
  );
}

function ActiveRoot(props: RootProps) {
  const enclosing = useContext(SplitPanelContext);
  const panel = props.panel ?? enclosing;
  if (!panel) throw new Error('<SplitHeaderScope.Root> needs a split');
  const [layoutRefs, setLayoutRefs] = createStore<
    SplitPanelContextType['layoutRefs']
  >({});
  const [titleFileMenuRef, setTitleFileMenuRef] =
    createSignal<HTMLDivElement>();
  const [titleFileMenuTrigger, setTitleFileMenuTrigger] =
    createSignal<() => void>();
  const [titleFileMenuActions, setTitleFileMenuActions] =
    createSignal<ReturnType<SplitPanelContextType['titleFileMenuActions']>>();
  const mobileHeaderOwner = createSignal<symbol>();
  const headerCollapse = createPriorityCollapseController();
  const toolbarCollapse = createPriorityCollapseController();

  return (
    <SplitHeaderScopeContext.Provider
      value={{
        setLayoutRef: (key, element) => setLayoutRefs(key, element),
        headerCollapse,
        toolbarCollapse,
      }}
    >
      <SplitPanelContext.Provider
        value={{
          ...panel,
          splitHotkeyScope: props.splitHotkeyScope ?? panel.splitHotkeyScope,
          isInlinePreview: props.isInlinePreview ?? panel.isInlinePreview,
          layoutRefs,
          // The scope shows its own header: a hosted mobile view owns that one,
          // and hosted content must not resize the enclosing split's controls.
          mobileHeaderOwner,
          headerMdControls: undefined,
          titleFileMenuRef,
          setTitleFileMenuRef,
          titleFileMenuTrigger,
          setTitleFileMenuTrigger,
          titleFileMenuActions,
          setTitleFileMenuActions,
          headerCollapser: headerCollapse.collapser,
          toolbarCollapser: toolbarCollapse.collapser,
        }}
      >
        {props.children}
      </SplitPanelContext.Provider>
    </SplitHeaderScopeContext.Provider>
  );
}

function useScopeOrThrow() {
  const scope = useSplitHeaderScope();
  if (!scope) throw new Error('<SplitHeaderScope.TopBar> needs a Root');
  return scope;
}

/**
 * The pane's top bar showing hosted contributions: the title and its
 * islands lead, actions trail. On touch it floats like a split header.
 */
function TopBar(props: { leading?: JSX.Element; class?: string }) {
  const scope = useScopeOrThrow();
  const floats = useTouchTopBarsFloat();
  const leading = children(() => props.leading);
  return (
    <ViewShell.TopBar
      navigation={
        <Show when={leading()}>
          {(content) => (
            <ViewShell.TopBarTitle class="shrink-0">
              <div class="flex shrink-0 items-center">{content()}</div>
            </ViewShell.TopBarTitle>
          )}
        </Show>
      }
      ref={scope.headerCollapse.setRow}
      class={cn(
        'relative w-full py-0 touch:flex',
        // Outside a workspace pane the bar stays in flow below the safe area.
        !floats() &&
          'touch:h-auto touch:min-h-12 touch:pt-[calc(var(--mobile-content-inset-top,var(--safe-top,0px))+0.75rem)]',
        props.class
      )}
    >
      {/* Contributions bring their own touch islands. */}
      <PriorityCollapseOverflowSensor
        controller={scope.headerCollapse}
        truncateAsLastResort
        class="relative h-full min-w-0 shrink overflow-hidden touch:overflow-visible"
        contentClass={cn(
          'flex h-full items-center gap-1 touch:gap-2',
          leading() && 'pl-0.5 touch:pl-0'
        )}
        contentRef={(element) => scope.setLayoutRef('headerLeft', element)}
      />
      <div
        class="flex h-full grow shrink items-center justify-end gap-1 touch:gap-2"
        ref={(element) => scope.setLayoutRef('headerRight', element)}
      />
    </ViewShell.TopBar>
  );
}

/** A detail pane with its own header; disable hosting for a desktop-owned bar. */
function Pane(props: ParentProps<{ when?: boolean; leading?: JSX.Element }>) {
  return (
    <Root when={props.when}>
      <div class="flex size-full min-h-0 min-w-0 flex-col overflow-hidden">
        <Show when={props.when ?? true}>
          <TopBar leading={props.leading} />
        </Show>
        <div class="relative flex min-h-0 min-w-0 flex-1 flex-col">
          {props.children}
        </div>
      </div>
    </Root>
  );
}

/** The row under the top bar that hosted toolbars contribute to. */
function Toolbar() {
  const scope = useScopeOrThrow();
  return (
    <div
      ref={scope.toolbarCollapse.setRow}
      class="relative flex min-h-0 w-full shrink-0 items-center justify-between px-2"
    >
      <PriorityCollapseOverflowSensor
        controller={scope.toolbarCollapse}
        class="min-w-0 flex-1 overflow-hidden"
        contentClass="flex items-center gap-1"
        contentRef={(element) => scope.setLayoutRef('toolbarLeft', element)}
      />
      <div
        class="flex h-full items-center gap-1"
        ref={(element) => scope.setLayoutRef('toolbarRight', element)}
      />
    </div>
  );
}

export const SplitHeaderScope = { Root, Pane, TopBar, Toolbar };
