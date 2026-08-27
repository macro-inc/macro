import { TOKENS } from '@core/hotkey/tokens';
import CaretLeftIcon from '@phosphor/caret-left.svg';
import CaretRightIcon from '@phosphor/caret-right.svg';
import CloseIcon from '@phosphor/x.svg';
import { Button, type ButtonProps, cn } from '@ui';
import {
  createContext,
  type JSX,
  type ParentProps,
  Show,
  splitProps,
  useContext,
} from 'solid-js';

export type SplitPanelController = {
  canGoBack: () => boolean;
  goBack: () => void;
  canGoForward: () => boolean;
  goForward: () => void;
  canClose: () => boolean;
  close: () => void;
};

const SplitPanelControllerContext = createContext<
  SplitPanelController | undefined
>();

export function SplitPanelControllerProvider(
  props: ParentProps<{ controller: SplitPanelController }>
) {
  return (
    <SplitPanelControllerContext.Provider value={props.controller}>
      {props.children}
    </SplitPanelControllerContext.Provider>
  );
}

export function useSplitPanelController(): SplitPanelController {
  const controller = useContext(SplitPanelControllerContext);
  if (!controller) {
    throw new Error(
      'Split panel controls require <SplitPanel.Root controller={...}>'
    );
  }
  return controller;
}

type SplitPanelRootProps = JSX.HTMLAttributes<HTMLElement> & {
  controller?: SplitPanelController;
};

/**
 * Presentation-only frame for one split.
 *
 * Children stay in the consumer's DOM order. The root provides only the
 * vertical panel boundary; consumers decide which chrome exists and how each
 * header or toolbar lays out its contents.
 */
function Root(props: SplitPanelRootProps) {
  const [local, rest] = splitProps(props, ['children', 'class', 'controller']);
  const inheritedController = useContext(SplitPanelControllerContext);

  return (
    <SplitPanelControllerContext.Provider
      value={local.controller ?? inheritedController}
    >
      <section
        {...rest}
        class={cn(
          'relative flex size-full min-h-0 min-w-0 flex-col overflow-hidden bg-panel text-ink',
          local.class
        )}
        data-split-panel=""
      >
        {local.children}
      </section>
    </SplitPanelControllerContext.Provider>
  );
}

function Header(props: JSX.HTMLAttributes<HTMLElement>) {
  const [local, rest] = splitProps(props, ['children', 'class']);
  return (
    <header
      {...rest}
      class={cn(
        'flex min-h-10 min-w-0 shrink-0 items-center border-b border-edge-muted px-2',
        local.class
      )}
      data-split-panel-header=""
    >
      {local.children}
    </header>
  );
}

function Toolbar(props: JSX.HTMLAttributes<HTMLDivElement>) {
  const [local, rest] = splitProps(props, ['children', 'class', 'role']);
  return (
    <div
      {...rest}
      role={local.role ?? 'toolbar'}
      class={cn(
        'flex min-w-0 shrink-0 items-center border-b border-edge-muted p-2',
        local.class
      )}
      data-split-panel-toolbar=""
    >
      {local.children}
    </div>
  );
}

function Body(props: JSX.HTMLAttributes<HTMLDivElement>) {
  const [local, rest] = splitProps(props, ['children', 'class']);
  return (
    <div
      {...rest}
      class={cn('relative min-h-0 min-w-0 flex-1 overflow-hidden', local.class)}
      data-split-panel-body=""
    >
      {local.children}
    </div>
  );
}

function Footer(props: JSX.HTMLAttributes<HTMLElement>) {
  const [local, rest] = splitProps(props, ['children', 'class']);
  return (
    <footer
      {...rest}
      class={cn(
        'flex min-h-10 min-w-0 shrink-0 items-center border-t border-edge-muted px-2',
        local.class
      )}
      data-split-panel-footer=""
    >
      {local.children}
    </footer>
  );
}

function ControlGroup(props: JSX.HTMLAttributes<HTMLDivElement>) {
  const [local, rest] = splitProps(props, ['children', 'class']);
  return (
    <div
      {...rest}
      class={cn('flex min-w-0 shrink-0 items-center gap-0', local.class)}
      data-split-panel-control-group=""
    >
      {local.children}
    </div>
  );
}

type SplitControlButtonProps = Omit<ButtonProps, 'children' | 'onClick'> & {
  children?: JSX.Element;
};

function BackButton(props: SplitControlButtonProps) {
  const controller = useSplitPanelController();
  const [local, rest] = splitProps(props, [
    'aria-label',
    'children',
    'class',
    'disabled',
    'hotkey',
    'label',
    'size',
    'square',
    'type',
    'variant',
  ]);
  const label = () => local.label ?? 'Go back';

  return (
    <Button
      {...rest}
      type={local.type ?? 'button'}
      variant={local.variant}
      size={local.size ?? 'sm'}
      square={local.square ?? true}
      class={cn(
        !local.size && 'p-1',
        'rounded-lg touch:active:bg-transparent',
        local.class
      )}
      aria-label={local['aria-label']}
      label={label()}
      hotkey={local.hotkey ?? TOKENS.split.go.back}
      disabled={Boolean(local.disabled) || !controller.canGoBack()}
      onClick={() => controller.goBack()}
    >
      {local.children ?? <CaretLeftIcon />}
    </Button>
  );
}

function ForwardButton(props: SplitControlButtonProps) {
  const controller = useSplitPanelController();
  const [local, rest] = splitProps(props, [
    'aria-label',
    'children',
    'class',
    'disabled',
    'hotkey',
    'label',
    'size',
    'square',
    'type',
    'variant',
  ]);
  const label = () => local.label ?? 'Go forward';

  return (
    <Button
      {...rest}
      type={local.type ?? 'button'}
      variant={local.variant}
      size={local.size ?? 'sm'}
      square={local.square ?? true}
      class={cn(
        !local.size && 'p-1',
        'rounded-lg touch:active:bg-transparent',
        local.class
      )}
      aria-label={local['aria-label']}
      label={label()}
      hotkey={local.hotkey ?? TOKENS.split.go.forward}
      disabled={Boolean(local.disabled) || !controller.canGoForward()}
      onClick={() => controller.goForward()}
    >
      {local.children ?? <CaretRightIcon />}
    </Button>
  );
}

function CloseButton(props: SplitControlButtonProps) {
  const controller = useSplitPanelController();
  const [local, rest] = splitProps(props, [
    'aria-label',
    'children',
    'class',
    'disabled',
    'hotkey',
    'label',
    'size',
    'square',
    'type',
    'variant',
  ]);
  const label = () => local.label ?? 'Close';

  return (
    <Show when={controller.canClose()}>
      <Button
        {...rest}
        type={local.type ?? 'button'}
        variant={local.variant}
        size={local.size ?? 'sm'}
        square={local.square ?? true}
        class={cn('rounded-lg', local.class)}
        aria-label={local['aria-label']}
        label={label()}
        hotkey={local.hotkey ?? TOKENS.split.close}
        disabled={Boolean(local.disabled)}
        onClick={() => controller.close()}
      >
        {local.children ?? <CloseIcon />}
      </Button>
    </Show>
  );
}

export const SplitPanel = Object.assign(Root, {
  Root,
  Header,
  Toolbar,
  Body,
  Footer,
  ControlGroup,
  BackButton,
  ForwardButton,
  CloseButton,
});
