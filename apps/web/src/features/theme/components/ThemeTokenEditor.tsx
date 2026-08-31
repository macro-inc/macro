import type { CollectionNode } from '@kobalte/core';
import { Collapsible } from '@kobalte/core/collapsible';
import { Select } from '@kobalte/core/select';
import CaretDownIcon from '@phosphor/caret-down.svg';
import CheckIcon from '@phosphor/check.svg';
import PlusIcon from '@phosphor/plus.svg';
import XIcon from '@phosphor/x.svg';
import { Button, Checkbox, Layer } from '@ui';
import {
  batch,
  createEffect,
  createMemo,
  createSignal,
  For,
  Show,
} from 'solid-js';
import { themeColorTokens } from '../signals/themeSignals';
import {
  contentTokens,
  edgeTokens,
  inputColorTokens,
  paletteTokens,
  surfaceTokens,
} from '../types/themeTypes';
import {
  convertOklchTo,
  getOklch,
  sanitizeOklch,
  tryGetOklch,
} from '../utils/colorUtil';
import {
  parseThemeAssignment,
  serializeThemeAssignment,
  type ThemeAssignment,
} from '../utils/themeAssignments';
import {
  previewLiveThemeColorToken,
  updateLiveThemeColorToken,
} from '../utils/themeUtils';
import { ColorPickerPopover } from './ColorPickerPopover';

const TOKEN_OPTIONS = inputColorTokens;
type TokenOption = { value: string; label: string };
const TOKEN_SELECT_OPTIONS: TokenOption[] = TOKEN_OPTIONS.map((token) => ({
  value: token,
  label: token,
}));

const tokenSections = [
  { label: 'Surface', tokens: surfaceTokens, defaultOpen: true, ramp: true },
  { label: 'Content', tokens: contentTokens, ramp: true },
  { label: 'Edge', tokens: edgeTokens },
  { label: 'Accent', tokens: ['accent'] as const },
  { label: 'Palette', tokens: paletteTokens },
  {
    label: 'Semantic surfaces',
    tokens: [
      'surface',
      'inset',
      'lift',
      'page',
      'panel',
      'dialog',
      'menu',
      'tooltip',
      'toast',
      'input',
      'input-focus',
      'message',
      'chrome',
    ] as const,
    defaultOpen: true,
  },
  {
    label: 'Ink',
    tokens: [
      'ink',
      'ink-muted',
      'ink-subtle',
      'ink-disabled',
      'ink-placeholder',
    ] as const,
  },
  {
    label: 'Links',
    tokens: ['link', 'link-hover', 'link-visited'] as const,
  },
  {
    label: 'Interaction',
    tokens: ['hover', 'active', 'selected'] as const,
  },
  {
    label: 'Status',
    tokens: ['success', 'warning', 'failure'] as const,
  },
] as const;

function tokenLabel(token: string): string {
  return token
    .split('-')
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function resolvedColor(token: string): string {
  if (typeof document === 'undefined') return '#000000';
  const probe = document.createElement('span');
  try {
    probe.style.position = 'absolute';
    probe.style.visibility = 'hidden';
    probe.style.backgroundColor = `var(--color-${token})`;
    (document.body ?? document.documentElement).append(probe);
    return getComputedStyle(probe).backgroundColor || '#000000';
  } catch {
    return '#000000';
  } finally {
    probe.remove();
  }
}

function ColorControl(props: {
  token: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const readColor = () => {
    try {
      return getOklch(props.value);
    } catch {
      return tryGetOklch(resolvedColor(props.token));
    }
  };
  const initial = readColor();
  const [l, setL] = createSignal(initial.l);
  const [c, setC] = createSignal(initial.c);
  const [h, setH] = createSignal(initial.h);
  const [alpha, setAlpha] = createSignal(initial.alpha);
  let lastWritten = props.value;

  createEffect(() => {
    const value = props.value;
    if (value === lastWritten) return;
    lastWritten = value;
    try {
      const next = getOklch(value);
      setL(next.l);
      setC(next.c);
      setAlpha(next.alpha);
      // Achromatic colors have no meaningful hue. Keep the picker's hue state.
      if (next.c > 0.0001) setH(next.h);
    } catch {
      const next = tryGetOklch(resolvedColor(props.token), {
        l: l(),
        c: c(),
        h: h(),
        alpha: alpha(),
      });
      setL(next.l);
      setC(next.c);
      setAlpha(next.alpha);
      if (next.c > 0.0001) setH(next.h);
    }
  });

  const write = (next: {
    l?: number;
    c?: number;
    h?: number;
    alpha?: number;
  }) => {
    const current = sanitizeOklch({
      l: l(),
      c: c(),
      h: h(),
      alpha: alpha(),
    });
    const safe = sanitizeOklch({ ...current, ...next }, current);
    setL(safe.l);
    setC(safe.c);
    setH(safe.h);
    setAlpha(safe.alpha);
    lastWritten = convertOklchTo(safe.l, safe.c, safe.h, 'oklch', safe.alpha);
    props.onChange(lastWritten);
  };

  return (
    <ColorPickerPopover
      l={l}
      c={c}
      h={h}
      alpha={alpha}
      onL={(value) => write({ l: value })}
      onC={(value) => write({ c: value })}
      onH={(value) => write({ h: value })}
      onAlpha={(value) => write({ alpha: value })}
      ariaLabel={`Edit ${props.token}`}
      title={tokenLabel(props.token)}
      subtitle={props.token}
      trigger={
        <div
          class="size-9 rounded-md border border-edge-muted shadow-sm"
          style={{ 'background-color': `var(--color-${props.token})` }}
        />
      }
    />
  );
}

function TokenPill(props: {
  value: string;
  onChange: (value: string) => void;
  onRemove: () => void;
  label: string;
}) {
  const selectedOption = () =>
    TOKEN_SELECT_OPTIONS.find((option) => option.value === props.value) ??
    TOKEN_SELECT_OPTIONS[0];

  return (
    <div class="flex h-7 min-w-0 items-center rounded-full bg-ink/5 pl-0.5 text-xs text-ink">
      <Select<TokenOption>
        options={TOKEN_SELECT_OPTIONS}
        value={selectedOption()}
        onChange={(option) => option && props.onChange(option.value)}
        optionValue="value"
        optionTextValue="label"
        gutter={4}
        placement="bottom-start"
        itemComponent={(itemProps: { item: CollectionNode<TokenOption> }) => (
          <Select.Item
            item={itemProps.item}
            class="flex items-center gap-2 rounded-sm px-2 py-1.5 font-mono text-[11px] text-ink outline-none data-highlighted:bg-hover"
          >
            <span
              class="size-3 shrink-0 rounded-full border border-edge-muted"
              style={{
                'background-color': `var(--color-${itemProps.item.rawValue.value})`,
              }}
            />
            <Select.ItemLabel class="min-w-0 flex-1 truncate">
              {itemProps.item.rawValue.label}
            </Select.ItemLabel>
            <Select.ItemIndicator>
              <CheckIcon class="size-3" />
            </Select.ItemIndicator>
          </Select.Item>
        )}
      >
        <Select.Trigger
          class="flex h-7 min-w-0 items-center gap-1.5 rounded-full px-1.5 outline-none hover:bg-hover data-expanded:bg-active"
          aria-label={props.label}
        >
          <span
            class="size-3 shrink-0 rounded-full border border-edge-muted"
            style={{ 'background-color': `var(--color-${props.value})` }}
          />
          <Select.Value<TokenOption>>
            {(state) => (
              <span class="max-w-28 truncate font-mono text-[11px]">
                {state.selectedOption().label}
              </span>
            )}
          </Select.Value>
          <CaretDownIcon class="size-3 shrink-0 text-ink-muted" />
        </Select.Trigger>
        <Select.Portal>
          <Layer depth={3}>
            <Select.Content class="z-action-menu max-h-64 min-w-40 overflow-auto rounded-md border border-edge-muted bg-surface p-1 shadow-lg">
              <Select.Listbox />
            </Select.Content>
          </Layer>
        </Select.Portal>
      </Select>
      <button
        type="button"
        class="mr-1 grid size-5 shrink-0 place-items-center rounded-full text-ink-muted hover:bg-hover hover:text-ink"
        aria-label={`Remove ${props.label}`}
        onClick={props.onRemove}
      >
        <XIcon class="size-3" />
      </button>
    </div>
  );
}

function TokenSlider(props: {
  label: string;
  value: number;
  color: string;
  track?: string;
  onPreview: (value: number) => void;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = createSignal(props.value);
  createEffect(() => setDraft(props.value));

  const update = (event: Event, commit: boolean) => {
    const value = Number((event.currentTarget as HTMLInputElement).value);
    setDraft(value);
    props.onPreview(value);
    if (commit) props.onCommit(value);
  };

  return (
    <label class="flex min-w-24 flex-1 items-center gap-2 text-[10px] text-ink-muted">
      <span class="w-8 shrink-0">{props.label}</span>
      <input
        type="range"
        min="0"
        max="1"
        step="0.01"
        value={draft()}
        aria-label={props.label}
        class="theme-token-slider h-1 min-w-16 flex-1 appearance-none rounded-full"
        style={{
          '--slider-color': props.color,
          'accent-color': props.color,
          background:
            props.track ??
            `linear-gradient(to right, ${props.color} ${draft() * 100}%, color-mix(in oklch, ${props.color} 15%, transparent) ${draft() * 100}%)`,
        }}
        onInput={(event) => update(event, false)}
        onChange={(event) => update(event, true)}
      />
      <span class="w-8 text-right font-mono">{Math.round(draft() * 100)}%</span>
    </label>
  );
}

function AssignmentControls(props: { token: string; value: string }) {
  const assignment = createMemo(() => parseThemeAssignment(props.value));
  const commit = (next: ThemeAssignment) =>
    updateLiveThemeColorToken(props.token, serializeThemeAssignment(next));
  const preview = (next: ThemeAssignment) =>
    previewLiveThemeColorToken(props.token, serializeThemeAssignment(next));
  const makeCustom = () =>
    commit({ kind: 'custom', value: resolvedColor(props.token) });

  return (
    <div class="flex min-w-0 flex-wrap items-center justify-end gap-2">
      {(() => {
        const current = assignment();
        if (current.kind === 'custom') {
          return (
            <>
              <span class="rounded-full bg-ink/5 px-2 py-1 font-mono text-[10px] text-ink-muted">
                custom
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  commit({ kind: 'linked', token: 'accent', alpha: 1 })
                }
              >
                <PlusIcon class="size-3" /> link
              </Button>
            </>
          );
        }

        if (current.kind === 'linked') {
          const withAlpha = (alpha: number): ThemeAssignment => ({
            ...current,
            alpha,
          });
          return (
            <>
              <TokenPill
                label={`${props.token} linked token`}
                value={current.token}
                onChange={(token) => commit({ ...current, token })}
                onRemove={makeCustom}
              />
              <TokenSlider
                label="Alpha"
                value={current.alpha}
                color={`var(--color-${current.token})`}
                onPreview={(alpha) => preview(withAlpha(alpha))}
                onCommit={(alpha) => commit(withAlpha(alpha))}
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  commit({
                    kind: 'mixed',
                    first: current.token,
                    second: current.token === 'accent' ? 'content-0' : 'accent',
                    mix: 0.5,
                    alpha: current.alpha,
                  })
                }
              >
                <PlusIcon class="size-3" /> mix
              </Button>
            </>
          );
        }

        const withSecondMix = (secondMix: number): ThemeAssignment => ({
          ...current,
          mix: 1 - secondMix,
        });
        const withAlpha = (alpha: number): ThemeAssignment => ({
          ...current,
          alpha,
        });
        return (
          <>
            <TokenPill
              label={`${props.token} first mix token`}
              value={current.first}
              onChange={(first) => commit({ ...current, first })}
              onRemove={makeCustom}
            />
            <TokenSlider
              label="Mix"
              value={1 - current.mix}
              color={`var(--color-${props.token})`}
              track={`linear-gradient(90deg in ${current.space ?? 'oklch'}, var(--color-${current.first}), var(--color-${current.second}))`}
              onPreview={(secondMix) => preview(withSecondMix(secondMix))}
              onCommit={(secondMix) => commit(withSecondMix(secondMix))}
            />
            <TokenPill
              label={`${props.token} second mix token`}
              value={current.second}
              onChange={(second) => commit({ ...current, second })}
              onRemove={() =>
                commit({
                  kind: 'linked',
                  token: current.first,
                  alpha: current.alpha,
                })
              }
            />
            <TokenSlider
              label="Alpha"
              value={current.alpha}
              color={`var(--color-${current.second})`}
              onPreview={(alpha) => preview(withAlpha(alpha))}
              onCommit={(alpha) => commit(withAlpha(alpha))}
            />
          </>
        );
      })()}
    </div>
  );
}

function RampEditor(props: { tokens: readonly string[] }) {
  const from = () => props.tokens[0] ?? '';
  const to = () => props.tokens.at(-1) ?? '';
  const middle = () => props.tokens.slice(1, -1);

  const positionFromAssignment = (token: string): number | null => {
    const current = parseThemeAssignment(
      themeColorTokens()[token] ?? 'transparent'
    );
    if (current.kind !== 'mixed' || current.alpha < 0.999) return null;
    if (current.first === from() && current.second === to()) {
      return 1 - current.mix;
    }
    if (current.first === to() && current.second === from()) {
      return current.mix;
    }
    return null;
  };

  const defaultPositions = () =>
    Object.fromEntries(
      middle().map((token, index) => [
        token,
        positionFromAssignment(token) ??
          (index + 1) / (props.tokens.length - 1),
      ])
    );
  const [positions, setPositions] = createSignal<Record<string, number>>(
    defaultPositions()
  );
  const [overwrite, setOverwrite] = createSignal(false);

  createEffect(() => {
    themeColorTokens();
    setPositions((current) => {
      const next = { ...current };
      for (const [index, token] of middle().entries()) {
        next[token] =
          positionFromAssignment(token) ??
          current[token] ??
          (index + 1) / (props.tokens.length - 1);
      }
      return next;
    });

    if (
      overwrite() &&
      middle().some((token) => positionFromAssignment(token) === null)
    ) {
      setOverwrite(false);
    }
  });

  const rampValue = (token: string, position = positions()[token] ?? 0.5) =>
    serializeThemeAssignment({
      kind: 'mixed',
      first: from(),
      second: to(),
      mix: 1 - position,
      alpha: 1,
      space: 'srgb',
    });

  const attach = (token: string) =>
    updateLiveThemeColorToken(token, rampValue(token));
  const detach = (token: string) =>
    updateLiveThemeColorToken(token, resolvedColor(token));

  const setPosition = (token: string, position: number, commit: boolean) => {
    setPositions((current) => ({ ...current, [token]: position }));
    const value = rampValue(token, position);
    if (commit) updateLiveThemeColorToken(token, value);
    else previewLiveThemeColorToken(token, value);
  };

  const setOverwriteAll = (checked: boolean) => {
    setOverwrite(checked);
    if (!checked) return;
    batch(() => {
      for (const token of middle()) attach(token);
    });
  };

  return (
    <div class="border-b border-edge-muted bg-inset/50 px-4 py-4">
      <div class="mb-4 flex flex-wrap items-center gap-4">
        <div class="mr-auto">
          <div class="text-xs font-medium text-ink">Ramp editor</div>
          <div class="text-[11px] text-ink-extra-muted">
            Drag a stop to attach it to the sRGB interpolation.
          </div>
        </div>
        <Checkbox
          as="label"
          checked={overwrite()}
          onChange={setOverwriteAll}
          class="flex items-center gap-2 text-xs text-ink-muted"
        >
          <Checkbox.Control />
          <span>Overwrite custom stops</span>
        </Checkbox>
      </div>

      <div class="mb-5 grid grid-cols-2 gap-4 mobile:grid-cols-1">
        <div class="flex items-center gap-3 rounded-lg border border-edge-muted bg-surface p-2.5">
          <ColorControl
            token={from()}
            value={themeColorTokens()[from()] ?? 'transparent'}
            onChange={(value) => updateLiveThemeColorToken(from(), value)}
          />
          <div class="min-w-0">
            <div class="text-[10px] uppercase tracking-wide text-ink-extra-muted">
              From
            </div>
            <code class="text-xs text-ink-muted">{from()}</code>
          </div>
        </div>
        <div class="flex items-center gap-3 rounded-lg border border-edge-muted bg-surface p-2.5">
          <ColorControl
            token={to()}
            value={themeColorTokens()[to()] ?? 'transparent'}
            onChange={(value) => updateLiveThemeColorToken(to(), value)}
          />
          <div class="min-w-0">
            <div class="text-[10px] uppercase tracking-wide text-ink-extra-muted">
              To
            </div>
            <code class="text-xs text-ink-muted">{to()}</code>
          </div>
        </div>
      </div>

      <div class="relative h-14 px-2">
        <div
          class="absolute inset-x-2 top-3 h-5 rounded-full border border-edge-muted shadow-inner"
          style={{
            background: `linear-gradient(90deg in srgb, var(--color-${from()}), var(--color-${to()}))`,
          }}
        />
        <For each={middle()}>
          {(token) => {
            const attached = () => positionFromAssignment(token) !== null;
            return (
              <input
                type="range"
                min="0.04"
                max="0.96"
                step="0.01"
                value={positions()[token] ?? 0.5}
                aria-label={`${token} ramp position`}
                class="theme-ramp-stop pointer-events-none absolute inset-x-2 top-0 h-11 appearance-none bg-transparent"
                classList={{ 'is-attached': attached() }}
                style={{ '--stop-color': `var(--color-${token})` }}
                onInput={(event) =>
                  setPosition(token, Number(event.currentTarget.value), false)
                }
                onChange={(event) =>
                  setPosition(token, Number(event.currentTarget.value), true)
                }
              />
            );
          }}
        </For>
      </div>

      <div class="flex flex-wrap justify-center gap-2">
        <For each={middle()}>
          {(token) => {
            const attached = () => positionFromAssignment(token) !== null;
            return (
              <button
                type="button"
                class="flex items-center gap-1.5 rounded-full border border-edge-muted bg-surface px-2 py-1 font-mono text-[10px] text-ink-muted hover:bg-hover hover:text-ink"
                classList={{ 'border-accent/40': attached() }}
                onClick={() => (attached() ? detach(token) : attach(token))}
                title={
                  attached()
                    ? `Make ${token} custom`
                    : `Link ${token} to this ramp`
                }
              >
                <span
                  class="size-2.5 rounded-full border border-edge-muted"
                  style={{ 'background-color': `var(--color-${token})` }}
                />
                {token}
                <span class="text-ink-extra-muted">
                  {attached() ? 'linked' : 'custom'}
                </span>
              </button>
            );
          }}
        </For>
      </div>
    </div>
  );
}

function TokenRow(props: { token: string }) {
  const value = () => themeColorTokens()[props.token] ?? 'transparent';
  return (
    <div class="grid min-h-14 grid-cols-[minmax(12rem,0.8fr)_minmax(16rem,2fr)] items-center gap-4 border-t border-edge-muted px-4 py-2.5 first:border-t-0 mobile:grid-cols-1 mobile:gap-2">
      <div class="flex min-w-0 items-center gap-3">
        <ColorControl
          token={props.token}
          value={value()}
          onChange={(next) => updateLiveThemeColorToken(props.token, next)}
        />
        <div class="min-w-0">
          <div class="truncate text-sm text-ink">{tokenLabel(props.token)}</div>
          <code class="block truncate text-[11px] text-ink-extra-muted">
            {props.token}
          </code>
        </div>
      </div>
      <AssignmentControls token={props.token} value={value()} />
    </div>
  );
}

function TokenSection(props: {
  title: string;
  tokens: readonly string[];
  defaultOpen?: boolean;
  ramp?: boolean;
}) {
  return (
    <Collapsible
      defaultOpen={props.defaultOpen}
      class="border-b border-edge-muted last:border-b-0"
    >
      <Collapsible.Trigger class="group flex w-full items-center gap-2 bg-surface px-4 py-3 text-left text-sm text-ink-muted outline-none hover:bg-hover hover:text-ink">
        <span>{props.title}</span>
        <span class="rounded border border-edge-muted bg-inset px-1.5 py-0.5 font-mono text-[10px] text-ink-extra-muted">
          {props.tokens.length}
        </span>
        <CaretDownIcon class="ml-auto size-3.5 -rotate-90 text-ink-extra-muted transition-transform group-data-expanded:rotate-0" />
      </Collapsible.Trigger>
      <Collapsible.Content class="data-closed:hidden">
        <div>
          <Show when={props.ramp}>
            <RampEditor tokens={props.tokens} />
          </Show>
          <For each={props.tokens}>{(token) => <TokenRow token={token} />}</For>
        </div>
      </Collapsible.Content>
    </Collapsible>
  );
}

export function ThemeTokenEditor() {
  return (
    <>
      <style>{`
        .theme-token-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 14px;
          height: 14px;
          border: 2px solid var(--color-surface);
          border-radius: 999px;
          background: var(--slider-color);
          box-shadow: 0 1px 3px color-mix(in oklch, var(--color-ink) 25%, transparent);
        }
        .theme-token-slider::-moz-range-thumb {
          width: 10px;
          height: 10px;
          border: 2px solid var(--color-surface);
          border-radius: 999px;
          background: var(--slider-color);
          box-shadow: 0 1px 3px color-mix(in oklch, var(--color-ink) 25%, transparent);
        }
        .theme-ramp-stop::-webkit-slider-runnable-track {
          height: 20px;
          background: transparent;
        }
        .theme-ramp-stop::-webkit-slider-thumb {
          pointer-events: auto;
          -webkit-appearance: none;
          appearance: none;
          width: 18px;
          height: 28px;
          margin-top: -4px;
          border: 2px solid var(--color-surface);
          border-radius: 999px;
          background: var(--stop-color);
          box-shadow: 0 0 0 1px var(--color-edge), 0 2px 5px color-mix(in oklch, var(--color-ink) 25%, transparent);
          cursor: grab;
        }
        .theme-ramp-stop.is-attached::-webkit-slider-thumb {
          box-shadow: 0 0 0 2px var(--color-accent), 0 2px 5px color-mix(in oklch, var(--color-ink) 25%, transparent);
        }
        .theme-ramp-stop::-moz-range-track {
          height: 20px;
          background: transparent;
        }
        .theme-ramp-stop::-moz-range-thumb {
          pointer-events: auto;
          width: 14px;
          height: 24px;
          border: 2px solid var(--color-surface);
          border-radius: 999px;
          background: var(--stop-color);
          box-shadow: 0 0 0 1px var(--color-edge), 0 2px 5px color-mix(in oklch, var(--color-ink) 25%, transparent);
          cursor: grab;
        }
        .theme-ramp-stop.is-attached::-moz-range-thumb {
          box-shadow: 0 0 0 2px var(--color-accent), 0 2px 5px color-mix(in oklch, var(--color-ink) 25%, transparent);
        }
      `}</style>
      <div class="overflow-hidden rounded-xl border border-edge-muted bg-surface shadow-sm">
        <For each={tokenSections}>
          {(section) => (
            <TokenSection
              title={section.label}
              tokens={section.tokens}
              defaultOpen={'defaultOpen' in section && section.defaultOpen}
              ramp={'ramp' in section && section.ramp}
            />
          )}
        </For>
      </div>
    </>
  );
}
