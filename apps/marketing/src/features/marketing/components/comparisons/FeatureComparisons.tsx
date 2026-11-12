import { For, onCleanup, onMount, Show } from 'solid-js';
import {
  CheckMark,
  ComparisonCell,
  CrossMark,
  PartialMark,
} from '../../../../app/components/sections/ComparisonTable';
import type { FeatureComparison } from '../../core/feature-comparisons';
import './feature-comparisons.css';

/** One visible table per page, with competitors side by side. */
export function FeatureComparisons(props: {
  title: string;
  comparisons: readonly FeatureComparison[];
  tableMinWidth?: number;
}) {
  let container!: HTMLDivElement;
  const rows = () =>
    (props.comparisons[0]?.rows ?? [])
      .filter((row) =>
        props.comparisons.every((comparison) =>
          comparison.rows.some((candidate) => candidate.feature === row.feature)
        )
      )
      .map((row) => ({
        feature: row.feature,
        cellNotes: [
          row.macroNote,
          ...props.comparisons.map(
            (comparison) =>
              comparison.rows.find(
                (candidate) => candidate.feature === row.feature
              )?.competitorNote
          ),
        ],
        cells: [
          row.macro,
          ...props.comparisons.map(
            (comparison) =>
              comparison.rows.find(
                (candidate) => candidate.feature === row.feature
              )!.competitor
          ),
        ],
      }));
  onMount(() => {
    let frame = 0;
    const reveal = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (
          props.comparisons.some(
            (comparison) => window.location.hash === `#compare-${comparison.id}`
          )
        ) {
          container.scrollIntoView({ block: 'start' });
        }
      });
    };
    reveal();
    window.addEventListener('hashchange', reveal);
    onCleanup(() => {
      cancelAnimationFrame(frame);
      window.removeEventListener('hashchange', reveal);
    });
  });
  return (
    <div ref={container} class="feature-comparisons">
      <For each={props.comparisons}>
        {(comparison) => (
          <span
            id={`compare-${comparison.id}`}
            class="feature-comparison-anchor"
          />
        )}
      </For>
      <h2 class="feature-comparison-heading">{props.title}</h2>
      <div
        class="feature-comparison-scroll"
        tabIndex={0}
        role="region"
        aria-label={props.title}
      >
        <table class="feature-comparison-table" aria-label={props.title}>
          <thead>
            <tr>
              <th scope="col">Features</th>
              <th scope="col">Macro</th>
              <For each={props.comparisons}>
                {(comparison) => <th scope="col">{comparison.competitor}</th>}
              </For>
            </tr>
          </thead>
          <tbody>
            <For each={rows()}>
              {(row) => (
                <tr>
                  <th scope="row">{row.feature}</th>
                  <For each={row.cells}>
                    {(cell, index) => (
                      <td>
                        <ComparisonCell
                          value={cell}
                          macro={index() === 0}
                          valueWrap="normal"
                          description={row.cellNotes[index()]}
                        />
                      </td>
                    )}
                  </For>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </div>
      <FeatureComparisonKey
        partial={rows().some((row) => row.cells.includes('partial'))}
        unavailable={rows().some((row) => row.cells.includes(false))}
      />
    </div>
  );
}

function FeatureComparisonKey(props: {
  partial: boolean;
  unavailable: boolean;
}) {
  return (
    <div class="feature-comparison-key">
      <span>
        <CheckMark /> Available
      </span>
      <Show when={props.partial}>
        <span>
          <PartialMark /> Partial
        </span>
      </Show>
      <Show when={props.unavailable}>
        <span>
          <CrossMark /> Not included
        </span>
      </Show>
    </div>
  );
}
