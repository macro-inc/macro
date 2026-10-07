import CaretLeftIcon from '@phosphor/caret-left.svg';
import { Button, type ButtonProps, ComposerSurface, cn } from '@ui';
import { children, createContext, type JSX, Show, useContext } from 'solid-js';
import { settingsTarget } from './core/settings-target';

/** Detail pages inherit the mobile sheet's header and compact spacing. */
export const SettingsSheetContext = createContext(false);

/*
 * Shared building blocks for the settings panels. Every settings tab composes
 * these so the whole menu shares one rhythm: a generous, centered content
 * column with a large page title and raised composer surfaces whose rows
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
  /** Inline subpages need their own heading beneath the mobile sheet chrome. */
  showTitleInSheet?: boolean;
  /** Optional one-line subtitle; accepts text or inline markup (e.g. a link). */
  description?: JSX.Element;
  /** Quiet line under the description (e.g. a cross-tab signpost). */
  signpost?: JSX.Element;
  /** Brand mark left of the title, for provider detail pages. */
  icon?: JSX.Element;
  /** Right-aligned controls beside the title (e.g. a global toggle). */
  actions?: JSX.Element;
  /** Renders a back affordance above the title for drill-in subpages. */
  onBack?: () => void;
  backLabel?: string;
  children: JSX.Element;
}) {
  const inSheet = useContext(SettingsSheetContext);
  return (
    <div
      data-settings-page
      data-drawer-scroll-body={inSheet ? true : undefined}
      class="@container/settings-page h-full min-h-0 overflow-y-auto [overflow-anchor:none] select-children bg-panel [&_[data-variant=cta]]:bg-ink [&_[data-variant=cta]]:text-panel [&_[data-variant=cta]]:focus-visible:ring-panel/70 [&_:has(>input[type=checkbox])]:[--color-accent:var(--color-ink)] [&_input[type=checkbox]]:accent-ink"
    >
      {/* On mobile/tablet the page is full-frame: the chrome insets live inside the
          scroll content (plus the usual breathing room) so pages scroll under
          the floating header and bottom rows like every other block. */}
      <div
        class={cn(
          'mx-auto w-full max-w-[960px]',
          inSheet
            ? '@container px-3 pt-2 pb-[max(24px,var(--mobile-sheet-safe-padding))]'
            : '@container px-12 pt-8 pb-24 @max-[480px]/settings-page:px-4 touch:px-5 touch:pt-[calc(var(--mobile-content-inset-top,0px)+2rem)] touch:pb-[calc(var(--mobile-content-inset-bottom,0px)+3rem)]'
        )}
      >
        <Show when={props.onBack}>
          <button
            type="button"
            class="mb-5 -ml-1.5 inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-sm text-ink-muted outline-none hover:bg-ink/4 hover:text-ink focus-visible:bg-ink/6"
            onClick={props.onBack}
          >
            <CaretLeftIcon class="size-4" />
            {props.backLabel ?? 'Back'}
          </button>
        </Show>
        <header class="flex items-start justify-between gap-4 @max-[480px]/settings-page:flex-col @max-[480px]/settings-page:gap-3">
          <div class="flex flex-col gap-1.5 min-w-0">
            <Show when={!inSheet || props.showTitleInSheet || props.onBack}>
              <div class="flex min-w-0 items-center gap-3">
                <Show when={props.icon}>
                  <div class="flex size-9 shrink-0 items-center justify-center [&_svg]:size-7 [&_img]:size-7">
                    {props.icon}
                  </div>
                </Show>
                <h1 class="min-w-0 text-[26px]/tight font-medium tracking-[-0.025em] text-ink">
                  {props.title}
                </h1>
              </div>
            </Show>
            <Show when={props.description}>
              <p class="text-sm leading-relaxed text-ink/60">
                {props.description}
              </p>
            </Show>
            <Show when={props.signpost}>{props.signpost}</Show>
          </div>
          <Show when={props.actions}>
            <div class="shrink-0 pt-1">{props.actions}</div>
          </Show>
        </header>
        <div
          class={cn('flex flex-col', inSheet ? 'gap-6 mt-3' : 'mt-12 gap-12')}
        >
          {props.children}
        </div>
      </div>
    </div>
  );
}

/**
 * A titled group within a page. The heading/description are optional so a page
 * can also drop a bare card straight under the title.
 */
export function SettingsSection(props: {
  title?: JSX.Element;
  description?: string;
  /** Right-aligned controls beside the section heading. */
  actions?: JSX.Element;
  class?: string;
  children: JSX.Element;
}) {
  const actions = children(() => props.actions);
  return (
    <section
      data-settings-target={
        typeof props.title === 'string'
          ? settingsTarget(props.title)
          : undefined
      }
      tabIndex={-1}
      class={cn('scroll-mt-4 outline-none rounded-[26.25px]', props.class)}
    >
      <SettingsSurface class="flex flex-col gap-2 p-5 touch:p-4">
        <Show when={props.title || actions()}>
          <div class="flex flex-wrap items-end justify-between gap-3">
            <div class="flex flex-col gap-0.5 min-w-0">
              <Show when={props.title}>
                <h2 class="text-base font-medium text-ink">{props.title}</h2>
              </Show>
              <Show when={props.description}>
                <p class="text-sm leading-relaxed text-ink/60">
                  {props.description}
                </p>
              </Show>
            </div>
            <Show when={actions()}>
              <div class="shrink-0">{actions()}</div>
            </Show>
          </div>
        </Show>
        {props.children}
      </SettingsSurface>
    </section>
  );
}

/** Nested groups share their section's surface instead of stacking shadows. */
const SettingsSurfaceContext = createContext(false);

export function SettingsSurface(props: {
  class?: string;
  children: JSX.Element;
}) {
  const nested = useContext(SettingsSurfaceContext);
  return (
    <Show
      when={!nested}
      fallback={<div class={props.class}>{props.children}</div>}
    >
      <ComposerSurface
        as="div"
        class={cn(
          'relative min-w-0 touch:rounded-3xl touch:border touch:border-edge-muted touch:bg-composer touch:text-composer-ink',
          props.class
        )}
      >
        <SettingsSurfaceContext.Provider value={true}>
          {props.children}
        </SettingsSurfaceContext.Provider>
      </ComposerSurface>
    </Show>
  );
}

/** Rows share a surface; standalone cards use the email composer's elevation. */
export function SettingsCard(props: { class?: string; children: JSX.Element }) {
  const nested = useContext(SettingsSurfaceContext);
  return (
    <SettingsSurface
      class={cn(
        'overflow-hidden settings-row-dividers [--color-edge-divider:color-mix(in_srgb,var(--color-ink)_5%,transparent)] [&>*:not(:last-child)]:after:inset-x-4',
        nested && '-mx-4',
        props.class
      )}
    >
      {props.children}
    </SettingsSurface>
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
  /**
   * Below a 460px container width, stack the control on its own row beneath
   * the label/description instead of keeping it in a right-hand column.
   * Requires an ancestor carrying `@container`.
   */
  stackOnNarrow?: boolean;
  /** Soften the label when the row is paused / disabled. */
  muted?: boolean;
  class?: string;
}) {
  const inSheet = useContext(SettingsSheetContext);
  return (
    <div
      data-settings-target={
        typeof props.label === 'string'
          ? settingsTarget(props.label)
          : undefined
      }
      tabIndex={-1}
      class={cn(
        'scroll-mt-4 outline-none flex gap-4 py-4 min-h-[64px]',
        inSheet ? 'px-4 flex-wrap' : 'px-4',
        props.stackOnNarrow
          ? 'flex-col gap-1.5 @[460px]:flex-row @[460px]:justify-between @[460px]:gap-4'
          : 'justify-between',
        // Cross-axis alignment only makes sense once the row is horizontal, so
        // gate it behind the container width when stacking.
        props.align === 'start'
          ? props.stackOnNarrow
            ? '@[460px]:items-start'
            : 'items-start'
          : props.stackOnNarrow
            ? '@[460px]:items-center'
            : 'items-center',
        props.class
      )}
    >
      <div class="flex flex-col gap-0.5 min-w-0">
        <div
          class={cn('text-base', props.muted ? 'text-ink-muted' : 'text-ink')}
        >
          {props.label}
        </div>
        <Show when={props.description}>
          <div
            class={cn(
              'text-sm leading-relaxed text-ink/60',
              props.hideDescriptionOnMobile && 'mobile:hidden'
            )}
          >
            {props.description}
          </div>
        </Show>
      </div>
      <Show when={props.children}>
        <div
          class={cn(
            'flex items-center gap-2',
            inSheet && 'min-w-0 max-w-full break-words [&_input]:max-w-full',
            props.stackOnNarrow
              ? '@[460px]:shrink-0 @[460px]:justify-end @[460px]:text-right'
              : 'shrink-0 justify-end text-right'
          )}
        >
          {props.children}
        </div>
      </Show>
    </div>
  );
}

/**
 * A radio choice rendered as a bordered card: a title and one-line description
 * beside the radio input. Used by the agent dialog's channel/share pickers and
 * the harness pairing dialog's Private/Team picker.
 */
export function ChoiceRow(props: {
  name: string;
  value: string;
  checked: boolean;
  title: string;
  description: string;
  disabled?: boolean;
  onChange: () => void;
}) {
  return (
    <label
      class="flex min-w-0 items-start gap-3 rounded-lg border border-edge-muted p-3 has-checked:border-accent has-checked:bg-accent-bg"
      classList={{
        'cursor-not-allowed opacity-50': props.disabled,
      }}
    >
      <input
        type="radio"
        name={props.name}
        value={props.value}
        checked={props.checked}
        disabled={props.disabled}
        onChange={props.onChange}
        aria-label={props.title}
        class="mt-0.5 accent-accent"
      />
      <span class="min-w-0">
        <span class="block text-sm font-medium text-ink">{props.title}</span>
        <span class="mt-0.5 block text-xs text-ink-muted">
          {props.description}
        </span>
      </span>
    </label>
  );
}

/**
 * A row for an integration / service: a brand icon, a title + one-line
 * description, and a trailing action slot. Used by the Connected accounts and
 * MCP cards so every integration reads the same.
 */
export function IntegrationRow(props: {
  /** The brand icon, rendered at its native size inside a fixed slot. */
  icon?: JSX.Element;
  title: JSX.Element;
  description?: JSX.Element;
  /** Proven facts under the description (e.g. connected accounts). Wraps. */
  facts?: JSX.Element;
  /** Optional indicator shown right after the title (e.g. a connection dot). */
  status?: JSX.Element;
  /** Soften title and icon when the row is paused / disabled. */
  muted?: boolean;
  children?: JSX.Element;
  class?: string;
}) {
  return (
    <div class={cn('flex flex-wrap items-center gap-4 px-4 py-4', props.class)}>
      <Show when={props.icon}>
        <div
          class={cn(
            'flex size-9 shrink-0 items-center justify-center [&_svg]:size-6 [&_img]:size-6',
            props.muted && 'opacity-50'
          )}
        >
          {props.icon}
        </div>
      </Show>
      <div class="flex-1 min-w-0 flex flex-col gap-0.5">
        <div class="flex items-center gap-2 min-w-0">
          <div
            class={cn(
              'text-sm font-medium truncate',
              props.muted ? 'text-ink-muted' : 'text-ink'
            )}
          >
            {props.title}
          </div>
          <Show when={props.status}>{props.status}</Show>
        </div>
        <Show when={props.description}>
          <div class="text-sm leading-relaxed text-ink/60">
            {props.description}
          </div>
        </Show>
        <Show when={props.facts}>
          <div class="ph-no-capture text-xs text-ink-extra-muted">
            {props.facts}
          </div>
        </Show>
      </div>
      <Show when={props.children}>
        <div class="shrink-0 flex items-center gap-2">{props.children}</div>
      </Show>
    </div>
  );
}

/** Quiet, compact actions for settings forms and account rows. */
export function SettingsButton(props: ButtonProps) {
  return (
    <Button
      {...props}
      class={cn('rounded-lg font-normal gap-1.5', props.class)}
    />
  );
}
