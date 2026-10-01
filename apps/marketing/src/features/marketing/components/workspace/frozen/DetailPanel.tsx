import Caret from '@phosphor/caret-right.svg';
import Sidebar from '@phosphor/sidebar-simple.svg';
import { Button, Tabs } from '@ui';
import { TabsInset } from '@ui/components/TabsInset';
import { type JSX, Show } from 'solid-js';

// Frozen from app/side-panel/SidePanel: card padding, grid rows and sizing.
export function PanelSection(props: {
  title: string;
  open?: boolean;
  children: JSX.Element;
}) {
  return (
    <details class="sample-panel-section" open={props.open}>
      <summary>
        <Caret class="size-3" />
        {props.title}
      </summary>
      <div class="px-3 pb-3 text-sm">{props.children}</div>
    </details>
  );
}
export function PanelRow(props: { label: string; children: JSX.Element }) {
  return (
    <>
      <span class="text-ink-muted truncate">{props.label}</span>
      <div class="flex items-center gap-2 min-w-0">{props.children}</div>
    </>
  );
}
export function PanelGrid(props: { children: JSX.Element }) {
  return (
    <div class="grid grid-cols-[96px_1fr] gap-x-3 items-center text-xs auto-rows-[1.75rem]">
      {props.children}
    </div>
  );
}
export function PanelToggle(props: {
  open: boolean | undefined;
  onChange: (open: boolean) => void;
}) {
  return (
    <Button
      variant="plain"
      size="icon-sm"
      label="Toggle details panel"
      aria-expanded={props.open}
      onClick={(e) =>
        props.onChange(
          !(
            props.open ??
            (e.currentTarget.closest('.dummy-main')?.clientWidth ?? 0) >= 1224
          )
        )
      }
    >
      <Sidebar class="size-4" />
    </Button>
  );
}
export function DetailLayout(props: {
  open: boolean | undefined;
  panel: JSX.Element;
  children: JSX.Element;
}) {
  return (
    <div
      class="sample-detail-layout"
      data-panel-open={props.open === undefined ? 'auto' : props.open}
    >
      <div class="sample-detail-content">{props.children}</div>
      <aside aria-label="Details panel" class="sample-details">
        {props.panel}
      </aside>
    </div>
  );
}
export function Segments<T extends string>(props: {
  label: string;
  items: readonly T[];
  value: T;
  onChange: (value: T) => void;
  sidebar?: boolean;
}) {
  const list = () => props.items.map((item) => ({ value: item, label: item }));
  const change = (value: string) => {
    const item = props.items.find((item) => item === value);
    if (item) props.onChange(item);
  };
  return (
    <Show
      when={props.sidebar}
      fallback={
        <TabsInset
          class="sample-tabs-inset"
          aria-label={props.label}
          list={list()}
          value={props.value}
          onChange={change}
        />
      }
    >
      <Tabs
        aria-label={props.label}
        list={list()}
        value={props.value}
        onChange={change}
      />
    </Show>
  );
}
