import { For, onCleanup, onMount } from 'solid-js';
import {
  CheckMark,
  type ComparisonColumn,
  ComparisonTable,
  CrossMark,
} from '../../../../app/components/sections/ComparisonTable';
import Gmail from '../../../../assets/icons/logo-gmail.svg';
import Jira from '../../../../assets/icons/logo-jira.svg';
import Linear from '../../../../assets/icons/logo-linear.svg';
import Notion from '../../../../assets/icons/logo-notion.svg';
import Slack from '../../../../assets/icons/logo-slack.svg';
import Superhuman from '../../../../assets/icons/logo-superhuman.svg';
import type { FeatureComparison } from '../../core/feature-comparisons';
import './feature-comparisons.css';

const logos: Record<string, ComparisonColumn['logo']> = {
  gmail: Gmail,
  jira: Jira,
  linear: Linear,
  notion: Notion,
  slack: Slack,
  superhuman: Superhuman,
};

/** One visible table per page, with competitors side by side. */
export function FeatureComparisons(props: {
  comparisons: readonly FeatureComparison[];
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
    <div ref={container} class="feature-page-reading feature-comparisons">
      <For each={props.comparisons}>
        {(comparison) => (
          <span
            id={`compare-${comparison.id}`}
            class="feature-comparison-anchor"
          />
        )}
      </For>
      <ComparisonTable
        columns={[
          { label: 'Macro', macro: true },
          ...props.comparisons.map((comparison) => ({
            label: comparison.competitor,
            logo: logos[comparison.id],
          })),
        ]}
        rows={rows()}
        sortRows={false}
        mobileCellWidth={100}
        mobileMinWidth={props.comparisons.length > 1 ? 520 : 390}
        scrollLabel="Compare Macro"
      />
      <div class="feature-comparison-key">
        <span>
          <CheckMark /> Available
        </span>
        <span>
          <CrossMark /> Not offered as a built-in tool
        </span>
      </div>
    </div>
  );
}
