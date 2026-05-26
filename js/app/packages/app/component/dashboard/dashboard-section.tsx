import CaretRightIcon from '@phosphor/caret-right.svg';
import { cn, Surface } from '@ui';
import { ErrorBoundary, type JSX, Show, Suspense } from 'solid-js';

import { DashboardSectionError } from './dashboard-section-error';
import { DashboardSectionLoading } from './dashboard-section-loading';

type AccentColor = 'default' | 'accent' | 'task' | 'chat' | 'note' | 'warning';

const accentStyles: Record<AccentColor, { icon: string; surface?: string }> = {
  default: { icon: 'text-ink-muted' },
  accent: { icon: 'text-accent' },
  task: { icon: 'text-task' },
  chat: { icon: 'text-chat' },
  note: { icon: 'text-note' },
  warning: { icon: 'text-alert-ink' },
};

interface DashboardSectionProps {
  title: string;
  icon?: JSX.Element;
  children: JSX.Element;
  fallback?: JSX.Element;
  class?: string;
  onSeeAll?: () => void;
  headerAction?: JSX.Element;
  size?: 'default' | 'large' | 'compact';
  accent?: AccentColor;
}

export function DashboardSection(props: DashboardSectionProps) {
  const accent = () => accentStyles[props.accent ?? 'default'];

  return (
    <section class={cn('flex flex-col', props.class)}>
      <header class="flex items-center justify-between mb-3 px-1">
        <div class="flex items-center gap-2">
          <Show when={props.icon}>
            <div class={cn('size-4 [&_svg]:size-4', accent().icon)}>
              {props.icon}
            </div>
          </Show>
          <h2 class="text-sm font-semibold text-ink">{props.title}</h2>
        </div>
        <div class="flex items-center gap-3">
          <Show when={props.headerAction}>{props.headerAction}</Show>
          <Show when={props.onSeeAll}>
            <button
              type="button"
              onClick={props.onSeeAll}
              class="group flex items-center gap-0.5 text-xs text-accent font-medium hover:text-accent/80 active:opacity-70 transition-colors"
            >
              <span class="group-hover:underline underline-offset-2">See all</span>
              <CaretRightIcon class="size-3 transition-transform group-hover:translate-x-0.5" />
            </button>
          </Show>
        </div>
      </header>
      <Surface
        depth={2}
        class={cn(
          'flex-1',
          props.size === 'compact' && 'p-3',
          props.size === 'large' && 'p-5',
          props.size !== 'compact' && props.size !== 'large' && 'p-4'
        )}
      >
        <ErrorBoundary
          fallback={(error, reset) => (
            <DashboardSectionError
              error={error}
              reset={reset}
              title={props.title}
            />
          )}
        >
          <Suspense fallback={props.fallback ?? <DashboardSectionLoading />}>
            {props.children}
          </Suspense>
        </ErrorBoundary>
      </Surface>
    </section>
  );
}

interface DashboardCardProps {
  children: JSX.Element;
  class?: string;
  onClick?: () => void;
}

export function DashboardCard(props: DashboardCardProps) {
  return (
    <Surface
      depth={2}
      class={cn(
        'text-left',
        props.onClick && 'active:bg-ink/5 transition-colors cursor-pointer',
        props.class
      )}
      onClick={props.onClick}
    >
      {props.children}
    </Surface>
  );
}

interface DashboardItemRowProps {
  icon?: JSX.Element;
  iconBg?: string;
  title: string | JSX.Element;
  subtitle?: string | JSX.Element;
  meta?: JSX.Element;
  onClick?: () => void;
}

export function DashboardItemRow(props: DashboardItemRowProps) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={!props.onClick}
      class={cn(
        'flex items-center gap-3 py-2.5 px-3 w-full text-left transition-colors',
        props.onClick && 'hover:bg-ink/5 cursor-pointer rounded-lg'
      )}
    >
      <Show when={props.icon}>
        <div
          class={cn(
            'size-9 rounded-lg flex items-center justify-center shrink-0 [&_svg]:size-4',
            props.iconBg ?? 'bg-ink/5 text-ink-muted'
          )}
        >
          {props.icon}
        </div>
      </Show>
      <div class="flex-1 min-w-0">
        <div class="text-sm text-ink truncate font-medium">{props.title}</div>
        <Show when={props.subtitle}>
          <div class="text-xs text-ink-extra-muted mt-0.5 truncate">
            {props.subtitle}
          </div>
        </Show>
      </div>
      <Show when={props.meta}>{props.meta}</Show>
      <Show when={props.onClick}>
        <CaretRightIcon class="size-4 text-ink-extra-muted shrink-0" />
      </Show>
    </button>
  );
}

interface DashboardEmptyStateProps {
  icon?: JSX.Element;
  title: string;
  description?: string;
  action?: JSX.Element;
  compact?: boolean;
}

function FloatingDots() {
  return (
    <div class="absolute inset-0 overflow-hidden pointer-events-none">
      <div
        class="absolute size-1.5 rounded-full bg-ink/10 animate-[float_3s_ease-in-out_infinite]"
        style={{ top: '20%', left: '25%', 'animation-delay': '0s' }}
      />
      <div
        class="absolute size-1 rounded-full bg-ink/8 animate-[float_4s_ease-in-out_infinite]"
        style={{ top: '60%', left: '15%', 'animation-delay': '1s' }}
      />
      <div
        class="absolute size-2 rounded-full bg-ink/5 animate-[float_3.5s_ease-in-out_infinite]"
        style={{ top: '30%', right: '20%', 'animation-delay': '0.5s' }}
      />
      <div
        class="absolute size-1 rounded-full bg-ink/10 animate-[float_4.5s_ease-in-out_infinite]"
        style={{ top: '70%', right: '25%', 'animation-delay': '1.5s' }}
      />
    </div>
  );
}

export function DashboardEmptyState(props: DashboardEmptyStateProps) {
  return (
    <div
      class={cn(
        'relative flex flex-col items-center justify-center text-center gap-1',
        props.compact ? 'py-4' : 'py-8'
      )}
    >
      <FloatingDots />
      <Show when={props.icon}>
        <div
          class={cn(
            'relative rounded-full bg-ink/5 flex items-center justify-center text-ink-muted [&_svg]:size-5 mb-2',
            'animate-[breathe_3s_ease-in-out_infinite]',
            props.compact ? 'size-8 [&_svg]:size-4' : 'size-10'
          )}
        >
          <div class="absolute inset-0 rounded-full bg-ink/5 animate-[pulse-ring_3s_ease-in-out_infinite]" />
          {props.icon}
        </div>
      </Show>
      <p class="text-sm text-ink-muted">{props.title}</p>
      <Show when={props.description}>
        <p class="text-xs text-ink-extra-muted max-w-48">
          {props.description}
        </p>
      </Show>
      <Show when={props.action}>
        <div class="mt-1">{props.action}</div>
      </Show>
    </div>
  );
}

interface DashboardStatProps {
  label: string;
  value: string | number;
  icon?: JSX.Element;
  trend?: 'up' | 'down' | 'neutral';
  onClick?: () => void;
}

export function DashboardStat(props: DashboardStatProps) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={!props.onClick}
      class={cn(
        'flex flex-col gap-1 p-3 rounded-lg text-left',
        props.onClick && 'active:bg-ink/5 transition-colors cursor-pointer'
      )}
    >
      <div class="flex items-center gap-2 text-ink-muted">
        <Show when={props.icon}>
          <div class="size-4 [&_svg]:size-4">{props.icon}</div>
        </Show>
        <span class="text-xs">{props.label}</span>
      </div>
      <span
        class={cn(
          'text-2xl font-semibold',
          props.trend === 'up' && 'text-success',
          props.trend === 'down' && 'text-failure',
          !props.trend && 'text-ink'
        )}
      >
        {props.value}
      </span>
    </button>
  );
}
