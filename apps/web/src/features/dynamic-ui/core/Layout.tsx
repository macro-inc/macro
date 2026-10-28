import { cn } from '@ui';
import { type JSX, Show, splitProps } from 'solid-js';

type Align = 'start' | 'center' | 'end' | 'stretch';
type Justify = 'start' | 'center' | 'end' | 'between';

const GAP = [
  'gap-0',
  'gap-1',
  'gap-1.5',
  'gap-3',
  'gap-4',
  'gap-6',
  'gap-8',
] as const;

const gapClass = (step: number | undefined): string =>
  GAP[Math.min(Math.max(step ?? 3, 0), GAP.length - 1)];

const alignClass = (align: Align | undefined): string | undefined =>
  align === 'start'
    ? 'items-start'
    : align === 'center'
      ? 'items-center'
      : align === 'end'
        ? 'items-end'
        : align === 'stretch'
          ? 'items-stretch'
          : undefined;

const justifyClass = (justify: Justify | undefined): string | undefined =>
  justify === 'start'
    ? 'justify-start'
    : justify === 'center'
      ? 'justify-center'
      : justify === 'end'
        ? 'justify-end'
        : justify === 'between'
          ? 'justify-between'
          : undefined;

export function View(props: {
  title?: string;
  class?: string;
  children: JSX.Element;
}) {
  const [local] = splitProps(props, ['title', 'class', 'children']);

  return (
    <div
      class={cn(
        '@container/results flex w-full min-w-0 flex-col gap-3',
        local.class
      )}
    >
      <Show when={local.title}>
        <h2 class="text-ink text-base font-semibold">{local.title}</h2>
      </Show>
      {local.children}
    </div>
  );
}

export function Row(props: {
  gap?: number;
  align?: Align;
  justify?: Justify;
  wrap?: boolean;
  class?: string;
  children: JSX.Element;
}) {
  const [local] = splitProps(props, [
    'gap',
    'align',
    'justify',
    'wrap',
    'class',
    'children',
  ]);

  return (
    <div
      class={cn(
        '@container/results flex w-full min-w-0 flex-col @2xl/results:flex-row',
        // Container width, rather than viewport width, controls split-pane reflow.
        local.wrap
          ? '[&>*]:min-w-0 @2xl/results:[&>*]:min-w-40 @2xl/results:[&>*]:flex-1 @2xl/results:[&>*]:basis-40'
          : '[&>*]:min-w-0 @2xl/results:[&>*]:flex-1',
        gapClass(local.gap),
        alignClass(local.align),
        justifyClass(local.justify),
        local.wrap && 'flex-wrap',
        local.class
      )}
    >
      {local.children}
    </div>
  );
}

export function Col(props: {
  gap?: number;
  align?: Align;
  justify?: Justify;
  class?: string;
  children: JSX.Element;
}) {
  const [local] = splitProps(props, [
    'gap',
    'align',
    'justify',
    'class',
    'children',
  ]);

  return (
    <div
      class={cn(
        '@container/results flex w-full min-w-0 flex-col',
        gapClass(local.gap),
        alignClass(local.align),
        justifyClass(local.justify),
        local.class
      )}
    >
      {local.children}
    </div>
  );
}
