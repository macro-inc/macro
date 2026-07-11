import {
  GithubPullRequestChecksContent,
  GithubPullRequestDetailsContent,
  SidePanel,
} from '@app/component/side-panel';
import type { GithubPullRequestWithDetails } from '@queries/storage/github-pull-requests';
import type { Accessor } from 'solid-js';

export function PrSidePanelSections(props: {
  enrichment: Accessor<GithubPullRequestWithDetails | undefined>;
}) {
  return (
    <>
      <SidePanel.Section id="pr-details" title="Details" defaultOpen order={10}>
        <GithubPullRequestDetailsContent enrichment={props.enrichment} />
      </SidePanel.Section>

      <SidePanel.Section id="pr-checks" title="Checks" order={20}>
        <GithubPullRequestChecksContent enrichment={props.enrichment} />
      </SidePanel.Section>
    </>
  );
}
