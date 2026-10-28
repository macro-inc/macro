import MacroLogo from '@icon/macro-logo.svg';
import { For, onCleanup, onMount, Show } from 'solid-js';
import {
  CheckMark,
  ComparisonTable,
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
      <ComparisonTable
        presentation="framed"
        minWidth={props.tableMinWidth}
        columns={[
          { label: 'Macro', macro: true, icon: <ComparisonMacroLogo /> },
          ...props.comparisons.map((comparison) => ({
            label: comparison.competitor,
          })),
        ]}
        rows={rows()}
        sortRows={false}
        mobileCellWidth={110}
        mobileMinWidth={240 + (props.comparisons.length + 1) * 110}
        scrollLabel="Compare Macro"
      />
      <FeatureComparisonKey
        partial={rows().some((row) => row.cells.includes('partial'))}
        unavailable={rows().some((row) => row.cells.includes(false))}
      />
    </div>
  );
}

export function ComparisonMacroLogo() {
  return <MacroLogo class="feature-comparison-macro-logo" aria-hidden="true" />;
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
