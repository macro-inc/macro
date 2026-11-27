import * as Tabs from '@kobalte/core/tabs';
import { createUniqueId, For, type JSX, Show } from 'solid-js';
import {
  choices,
  isPortraitTab,
  type Look,
  type PortraitTab,
  portraitTabs,
  ranges,
  tabNames,
} from './presets';

type Choice = readonly [value: string, label: string, color?: string];

export function ChoiceGroup<T extends string>(props: {
  label: string;
  value: T;
  options: readonly (readonly [T, string, string?])[];
  columns: number;
  detail?: JSX.Element;
  onChange: (value: T) => void;
}) {
  const title = createUniqueId();
  const swatches = () => Boolean(props.options[0]?.[2]);

  return (
    <div class="creator-control" role="group" aria-labelledby={title}>
      <div class="creator-control-label">
        <span id={title}>{props.label}</span>
        <output>
          {props.options.find(([value]) => value === props.value)?.[1]}
        </output>
      </div>
      <div
        class="creator-choices"
        classList={{ 'creator-swatches': swatches() }}
        style={{ '--columns': props.columns }}
      >
        <For each={props.options}>
          {([value, label, color]) => (
            <button
              type="button"
              aria-pressed={props.value === value}
              aria-label={color ? label : undefined}
              title={color ? label : undefined}
              style={{ '--swatch': color }}
              onClick={() => props.onChange(value)}
            >
              <Show when={!color}>{label}</Show>
            </button>
          )}
        </For>
      </div>
      {props.detail}
    </div>
  );
}

type RangeName = keyof typeof ranges;
type Range = {
  min: number;
  max: number;
  step: number;
  ends?: readonly string[];
  bipolar?: boolean;
  ticks?: number;
};

function rangeText(key: RangeName, value: number, range: Range) {
  const n = Math.round(value * 100);
  if (key === 'tone') return `Tone ${1 + Math.round(value * 6)}/7`;
  if (key === 'ageTexture') {
    const quality = n < 20 ? 'Smooth' : n < 55 ? 'Natural' : 'Weathered';
    return `${n}% · ${quality}`;
  }
  if (key === 'eyeTilt') {
    const degrees = Math.round(value * 10);
    const quality = degrees < -1 ? 'Down' : degrees > 1 ? 'Up' : 'Level';
    return `${degrees > 0 ? '+' : ''}${degrees}° · ${quality}`;
  }
  if (range.bipolar && range.ends) {
    const quality =
      value < -0.15 ? range.ends[0] : value > 0.15 ? range.ends[1] : 'Balanced';
    return `${n > 0 ? '+' : ''}${n} · ${quality}`;
  }

  return `${n}%`;
}

export function CreatorRange(props: {
  label: string;
  value: number;
  text: string;
  range: Range;
  tone?: boolean;
  ends?: JSX.Element;
  onChange: (value: number) => void;
}) {
  const inputId = createUniqueId();

  // Presets can sit between slider stops. Keep the native input at that exact
  // value until the user's next pointer or keyboard movement reaches a stop.
  function atStop(index: number) {
    const { min, max, step } = props.range;
    return Number(Math.max(min, Math.min(max, min + index * step)).toFixed(10));
  }

  function onKeyDown(event: KeyboardEvent) {
    const { min, max, step } = props.range;
    const index = (props.value - min) / step;
    const lower = Math.ceil(index - 1e-9);
    const upper = Math.floor(index + 1e-9);
    let next: number;

    switch (event.key) {
      case 'Home':
        next = min;
        break;
      case 'End':
        next = max;
        break;
      case 'ArrowUp':
      case 'ArrowRight':
        next = atStop(upper + 1);
        break;
      case 'ArrowDown':
      case 'ArrowLeft':
        next = atStop(lower - 1);
        break;
      case 'PageUp':
        next = atStop(upper + 10);
        break;
      case 'PageDown':
        next = atStop(lower - 10);
        break;
      default:
        return;
    }

    event.preventDefault();
    props.onChange(next);
  }

  return (
    <div class="creator-control">
      <div class="creator-control-label">
        <label for={inputId}>{props.label}</label>
        <output>{props.text}</output>
      </div>
      <input
        id={inputId}
        class="creator-range"
        classList={{ 'creator-tone': props.tone }}
        type="range"
        min={props.range.min}
        max={props.range.max}
        step="any"
        data-step={props.range.step}
        value={props.value}
        style={{
          '--fill': `${((props.value - props.range.min) / (props.range.max - props.range.min)) * 100}%`,
        }}
        aria-valuetext={props.text}
        onInput={(event) => {
          const input = event.currentTarget;
          const stop = Math.round(
            (input.valueAsNumber - props.range.min) / props.range.step
          );
          const next = atStop(stop);
          input.value = String(next);
          props.onChange(next);
        }}
        onKeyDown={onKeyDown}
      />
      <div
        class="creator-range-ticks"
        aria-hidden="true"
        style={{
          '--ticks': props.range.ticks ?? (props.range.bipolar ? 9 : 5),
        }}
      />
      {props.ends}
    </div>
  );
}

export function PortraitControls(props: {
  look: Look;
  tab: PortraitTab;
  onTab: (value: PortraitTab) => void;
  onLook: (value: Look) => void;
}) {
  const tabs = Object.entries(tabNames);

  return (
    <Tabs.Root
      value={props.tab}
      onChange={(tab) => {
        if (isPortraitTab(tab)) props.onTab(tab);
      }}
    >
      <Tabs.List class="creator-tabs" aria-label="Portrait controls">
        <For each={tabs}>
          {([key, label]) => <Tabs.Trigger value={key}>{label}</Tabs.Trigger>}
        </For>
      </Tabs.List>
      <For each={Object.entries(portraitTabs)}>
        {([tab, controls]) => (
          <Tabs.Content value={tab} class="creator-tab-panel">
            <For each={controls}>
              {(control) => {
                if (control.columns !== undefined) {
                  const { key, label, columns } = control;
                  const options: readonly Choice[] = choices[key];

                  return (
                    <ChoiceGroup
                      label={label}
                      value={props.look[key]}
                      options={options}
                      columns={columns}
                      onChange={(value) =>
                        props.onLook({ ...props.look, [key]: value })
                      }
                    />
                  );
                }

                const { key, label } = control;
                const range: Range = ranges[key];

                return (
                  <CreatorRange
                    label={label}
                    value={props.look[key]}
                    text={rangeText(key, props.look[key], range)}
                    range={range}
                    tone={key === 'tone'}
                    ends={
                      range.ends && (
                        <div class="creator-range-ends" aria-hidden="true">
                          <span>{range.ends[0]}</span>
                          <span>{range.ends[1]}</span>
                        </div>
                      )
                    }
                    onChange={(value) =>
                      props.onLook({ ...props.look, [key]: value })
                    }
                  />
                );
              }}
            </For>
          </Tabs.Content>
        )}
      </For>
    </Tabs.Root>
  );
}
