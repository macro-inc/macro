import CaretRight from '@phosphor/caret-right.svg?component-solid';
import { Button, Layer } from '@ui';
import type { Component, JSX } from 'solid-js';
import { Show } from 'solid-js';

type ToolRowProps = {
  align?: 'center' | 'start';
  children: JSX.Element;
  icon: Component<JSX.SvgSVGAttributes<SVGSVGElement>>;
  trailing?: JSX.Element;
};

type ToolRootProps = {
  children: JSX.Element;
  grouped?: boolean;
  muted?: boolean;
};

type ToolGroupProps = {
  children: JSX.Element;
};

type ToolResponseProps = {
  children: JSX.Element;
};

type ToolResultToggleProps = {
  expanded: boolean;
  onToggle: (event: MouseEvent) => void;
  showToggle?: boolean;
  status?: JSX.Element;
};

type ToolListProps = {
  children: JSX.Element;
};

type ToolListItemProps = {
  children: JSX.Element;
  icon?: JSX.Element;
};

function Root(props: ToolRootProps) {
  const content = () => (
    <div
      class="relative overflow-hidden text-xs leading-5 text-ink-extra-muted"
      classList={{
        'opacity-50': props.muted,
        'rounded-lg bg-surface': !props.grouped,
      }}
    >
      {props.children}
    </div>
  );

  return (
    <Show when={!props.grouped} fallback={content()}>
      <Layer depth={0}>{content()}</Layer>
    </Show>
  );
}

function Row(props: ToolRowProps) {
  const alignStart = () => props.align === 'start';

  return (
    <div
      class="flex min-h-9 w-full gap-2 px-3 py-2"
      classList={{
        'items-center': !alignStart(),
        'items-start': alignStart(),
      }}
    >
      <props.icon
        class="size-4 shrink-0 text-ink-extra-muted"
        classList={{ 'mt-0.5': alignStart() }}
      />
      <div class="min-w-0 flex-1 overflow-hidden">{props.children}</div>
      <Show when={props.trailing}>
        <div class="shrink-0 whitespace-nowrap">{props.trailing}</div>
      </Show>
    </div>
  );
}

function Response(props: ToolResponseProps) {
  return <div class="px-3 pb-2">{props.children}</div>;
}

function ResultToggle(props: ToolResultToggleProps) {
  const canToggle = () => props.showToggle ?? true;

  return (
    <Show
      when={canToggle()}
      fallback={
        <Show when={props.status}>
          <span class="shrink-0 whitespace-nowrap text-xs text-ink-extra-muted">
            {props.status}
          </span>
        </Show>
      }
    >
      <Button
        type="button"
        variant="ghost"
        size="sm"
        noTouchResize
        class="shrink-0 whitespace-nowrap px-1 text-ink-extra-muted hover:text-ink-muted"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          props.onToggle(event);
        }}
      >
        <Show when={props.status}>
          <span>{props.status}</span>
        </Show>
        <CaretRight
          class="transition-transform"
          classList={{
            'rotate-90': props.expanded,
          }}
        />
      </Button>
    </Show>
  );
}

function Group(props: ToolGroupProps) {
  return (
    <Layer depth={0}>
      <div class="overflow-hidden rounded-lg border border-edge-muted bg-surface">
        <div class="divide-y divide-edge-muted">{props.children}</div>
      </div>
    </Layer>
  );
}

function List(props: ToolListProps) {
  return <div class="-mx-3 -my-2">{props.children}</div>;
}

function ListItem(props: ToolListItemProps) {
  return (
    <div class="flex min-h-8 items-center gap-2 px-3 py-1.5 text-xs leading-4">
      <Show when={props.icon}>
        <div class="flex size-4 shrink-0 items-center justify-center text-ink-extra-muted">
          {props.icon}
        </div>
      </Show>
      <div class="min-w-0 flex-1">{props.children}</div>
    </div>
  );
}

export const Tool = {
  Group,
  List,
  ListItem,
  Response,
  ResultToggle,
  Root,
  Row,
};
