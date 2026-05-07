import { cn } from '@ui';
import { type JSX, type ParentProps, Show } from 'solid-js';

interface TabContentProps {
  title: string;
  description?: string | JSX.Element;
  header?: JSX.Element;
  children: JSX.Element;
}

export function TabContent(props: TabContentProps) {
  return (
    <>
      {props.header}
      <div class="font-medium border-edge pb-3 mb-4 border-b text-ink p-2">
        {props.title}
      </div>
      <Show when={props.description}>
        <div class="text-xs pb-4 text-ink">{props.description}</div>
      </Show>
      {props.children}
    </>
  );
}

interface TabContentRowProps {
  text: string;
  subtext: string | JSX.Element;
  subtext2?: string;
  isLoading?: boolean;
  class?: string;
}

export function TabContentRow(props: ParentProps<TabContentRowProps>) {
  return (
    <div class="mb-[18px]">
      <div class="text-sm">{props.text}</div>
      <Show
        when={!props.isLoading}
        fallback={
          <div class="animate-pulse bg-ink-extra-muted rounded max-w-[100px] min-h-[20px] leading-5"></div>
        }
      >
        <div class={cn('text-ink-muted text-xs leading-5', props.class)}>
          {props.subtext}
        </div>
        {props.children}
      </Show>
    </div>
  );
}
