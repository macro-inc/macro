import { createUniqueId, For, type JSX } from 'solid-js';
import { ChoiceGroup, CreatorRange } from './creator-controls';
import {
  autonomyChoices,
  autonomyStops,
  intelligenceChoices,
  intelligenceStops,
  sampleEstimates,
  sampleResources,
  sizeNames,
  sizes,
} from './creator-profile';
import type { Draft } from './draft';

const sizeOptions = sizes.map((id) => [id, sizeNames[id]] as const);

function Stops<T extends string>(props: {
  label: string;
  value: T;
  items: readonly T[];
  definitions: Record<T, { label: string }>;
  onChange: (value: T) => void;
  children: JSX.Element;
}) {
  const title = createUniqueId();
  const chosen = () => props.definitions[props.value].label;

  return (
    <div class="creator-stop-control" role="group" aria-labelledby={title}>
      <div class="creator-control-label">
        <span id={title}>{props.label}</span>
        <output>{chosen()}</output>
      </div>
      <div class="creator-stop-rail">
        <CreatorRange
          label={`${props.label} level`}
          value={props.items.indexOf(props.value)}
          range={{ min: 0, max: props.items.length - 1, step: 1, ticks: 17 }}
          text={chosen()}
          onChange={(index) => {
            const item = props.items[index];
            if (item) props.onChange(item);
          }}
        />
        <div
          class="creator-choices"
          style={{ '--columns': props.items.length }}
        >
          <For each={props.items}>
            {(item) => (
              <button
                type="button"
                aria-pressed={props.value === item}
                onClick={() => props.onChange(item)}
              >
                {props.definitions[item].label}
              </button>
            )}
          </For>
        </div>
      </div>
      {props.children}
    </div>
  );
}

export function OperatingProfile(props: {
  draft: Draft;
  onChange: (value: Partial<Draft>) => void;
}) {
  const resource = () => sampleResources[props.draft.size];
  const model = () => intelligenceStops[props.draft.intelligence];
  const autonomy = () => autonomyStops[props.draft.autonomy];
  const dominantTiers = ['Frontier', 'Balanced', 'Fast'];
  const representativeMix = () => {
    const highest = Math.max(...model().mix);
    return `${highest}% ${dominantTiers[model().mix.indexOf(highest)]} tier`;
  };

  return (
    <>
      <ChoiceGroup
        label="Computer size"
        value={props.draft.size}
        options={sizeOptions}
        columns={3}
        detail={
          <p class="creator-size-spec">
            {__BOTS_FIXTURES__
              ? `${resource().vcpus} vCPU · ${resource().memoryGb} GiB · ${resource().diskGb} GiB`
              : 'Specifications unavailable'}
          </p>
        }
        onChange={(size) => props.onChange({ size })}
      />
      <Stops
        label="Intelligence"
        value={props.draft.intelligence}
        items={intelligenceChoices}
        definitions={intelligenceStops}
        onChange={(intelligence) => props.onChange({ intelligence })}
      >
        <details class="creator-disclosure">
          <summary>
            <span>
              {__BOTS_FIXTURES__
                ? `Sample mix · ${representativeMix()}`
                : 'Model mix unavailable'}
            </span>
            <span>Mix</span>
          </summary>
          {__BOTS_FIXTURES__ && (
            <ul>
              <For each={model().mix}>
                {(share, index) => (
                  <li>
                    <span>{dominantTiers[index()]} tier</span>
                    <meter
                      min={0}
                      max={100}
                      value={share}
                      aria-label={`${dominantTiers[index()]} tier`}
                    />
                    <span>{share}%</span>
                  </li>
                )}
              </For>
            </ul>
          )}
        </details>
      </Stops>
      <Stops
        label="Autonomy"
        value={props.draft.autonomy}
        items={autonomyChoices}
        definitions={autonomyStops}
        onChange={(autonomy) => props.onChange({ autonomy })}
      >
        <details class="creator-disclosure">
          <summary>
            <span>
              {__BOTS_FIXTURES__ ? autonomy().description : 'Draft preference'}
            </span>
            <span>Rules</span>
          </summary>
          <p class="creator-rule">
            Team access and approvals are set separately.
          </p>
        </details>
      </Stops>
      <div class="creator-estimate">
        <div>
          <div class="eyebrow">
            {__BOTS_FIXTURES__ ? 'Sample estimate' : 'Price'}
          </div>
          <p>
            {sizeNames[props.draft.size]} · {model().label}
          </p>
        </div>
        <strong>
          {__BOTS_FIXTURES__
            ? sampleEstimates[props.draft.size][props.draft.intelligence]
            : 'Price unavailable'}
        </strong>
      </div>
      {__BOTS_FIXTURES__ && (
        <p class="creator-sample-note">
          Sample settings and estimates. No service purchases.
        </p>
      )}
    </>
  );
}
