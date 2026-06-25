import { type JSX, Show } from 'solid-js';
import { cn, Layer } from '@ui';

/*
 * Shared building blocks for the settings panels. Every settings tab composes
 * these so the whole menu shares one rhythm: a generous, centered content
 * column with a large page title, sections, and quiet outlined cards whose rows
 * are separated by hairline dividers.
 *
 *   <SettingsPage title="Account" description="…">
 *     <SettingsSection title="Profile">
 *       <SettingsCard>
 *         <SettingsRow label="Email">…</SettingsRow>
 *         <SettingsRow label="Full name">…</SettingsRow>
 *       </SettingsCard>
 *     </SettingsSection>
 *   </SettingsPage>
 */

/**
 * Scrolling page shell: a centered, max-width column with a large title and an
 * optional one-line description, followed by the page's sections.
 */
export function SettingsPage(props: {
  title: string;
  /** Optional one-line subtitle; accepts text or inline markup (e.g. a link). */
  description?: JSX.Element;
  /** Right-aligned controls beside the title (e.g. a global toggle). */
  actions?: JSX.Element;
  children: JSX.Element;
}) {
  return (
    <div class="h-full overflow-y-auto">
      <div class="mx-auto w-full max-w-[710px] px-10 pt-14 pb-24 mobile:px-5 mobile:pt-8 mobile:pb-12">
        {/* Headers are inset by the card's inner padding so the title and
            section labels line up with the leftmost content inside the cards,
            while the cards themselves stay full-width. */}
        <header class="flex items-start justify-between gap-4 px-6">
          <div class="flex flex-col gap-1.5 min-w-0">
            <h1 class="text-2xl/tight font-semibold text-ink">{props.title}</h1>
            <Show when={props.description}>
              <p class="text-sm text-ink-muted">{props.description}</p>
            </Show>
          </div>
          <Show when={props.actions}>
            <div class="shrink-0 pt-1">{props.actions}</div>
          </Show>
        </header>
        <div class="mt-9 flex flex-col gap-10">{props.children}</div>
      </div>
    </div>
  );
}

/**
 * A titled group within a page. The heading/description are optional so a page
 * can also drop a bare card straight under the title.
 */
export function SettingsSection(props: {
  title?: string;
  description?: string;
  /** Right-aligned controls beside the section heading. */
  actions?: JSX.Element;
  class?: string;
  children: JSX.Element;
}) {
  return (
    <section class={cn('flex flex-col gap-3', props.class)}>
      <Show when={props.title || props.actions}>
        <div class="flex items-end justify-between gap-4 px-6">
          <div class="flex flex-col gap-0.5 min-w-0">
            <Show when={props.title}>
              <h2 class="text-[15px] font-semibold text-ink">{props.title}</h2>
            </Show>
            <Show when={props.description}>
              <p class="text-sm text-ink-muted">{props.description}</p>
            </Show>
          </div>
          <Show when={props.actions}>
            <div class="shrink-0">{props.actions}</div>
          </Show>
        </div>
      </Show>
      {props.children}
    </section>
  );
}

/**
 * A quiet outlined card. Direct children are treated as rows and get a hairline
 * divider between them (via `settings-row-dividers`); a single-child card draws
 * no divider, so it doubles as a plain container.
 */
export function SettingsCard(props: { class?: string; children: JSX.Element }) {
  // Raised a level above the content panel so the card reads as a subtly
  // lighter surface (theme-safe via the depth system) rather than just an
  // outline on the same fill.
  return (
    <Layer depth={2}>
      <div
        class={cn(
          'rounded-xl border border-ink/[0.05] bg-surface overflow-hidden settings-row-dividers',
          props.class
        )}
      >
        {props.children}
      </div>
    </Layer>
  );
}

/**
 * A label (with optional sub-text) on the left and its control on the right.
 * `align="start"` top-aligns the two columns for taller controls.
 */
export function SettingsRow(props: {
  label: JSX.Element;
  description?: JSX.Element;
  children?: JSX.Element;
  align?: 'center' | 'start';
  /** Hide the description on mobile, where the row is too cramped for it. */
  hideDescriptionOnMobile?: boolean;
  class?: string;
}) {
  return (
    <div
      class={cn(
        'flex justify-between gap-4 px-6 py-3.5 min-h-[60px]',
        props.align === 'start' ? 'items-start' : 'items-center',
        props.class
      )}
    >
      <div class="flex flex-col gap-0.5 min-w-0">
        <div class="text-sm text-ink">{props.label}</div>
        <Show when={props.description}>
          <div
            class={cn(
              'text-xs text-ink-muted',
              props.hideDescriptionOnMobile && 'mobile:hidden'
            )}
          >
            {props.description}
          </div>
        </Show>
      </div>
      <Show when={props.children}>
        <div class="shrink-0 flex items-center justify-end gap-2 text-right">
          {props.children}
        </div>
      </Show>
    </div>
  );
}

/**
 * A row for an integration / service: a brand icon, a title + one-line
 * description, and a trailing action slot. Used by the Connected accounts and
 * MCP cards so every integration reads the same.
 */
export function IntegrationRow(props: {
  /** The brand icon, rendered at its native size inside a fixed slot. */
  icon: JSX.Element;
  title: JSX.Element;
  description?: JSX.Element;
  /** Optional indicator shown right after the title (e.g. a connection dot). */
  status?: JSX.Element;
  children?: JSX.Element;
  class?: string;
}) {
  return (
    <div class={cn('flex items-center gap-4 px-6 py-4', props.class)}>
      <div class="flex size-9 shrink-0 items-center justify-center [&_svg]:size-6">
        {props.icon}
      </div>
      <div class="flex-1 min-w-0 flex flex-col gap-0.5">
        <div class="flex items-center gap-2 min-w-0">
          <div class="text-sm font-medium text-ink truncate">{props.title}</div>
          <Show when={props.status}>{props.status}</Show>
        </div>
        <Show when={props.description}>
          <div class="text-sm text-ink-muted truncate">{props.description}</div>
        </Show>
      </div>
      <Show when={props.children}>
        <div class="shrink-0 flex items-center gap-2">{props.children}</div>
      </Show>
    </div>
  );
}
