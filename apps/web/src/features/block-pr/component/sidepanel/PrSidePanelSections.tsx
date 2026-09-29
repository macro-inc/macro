import {
  GithubPullRequestChecksContent,
  GithubPullRequestDetailsContent,
  SidePanel,
} from '@components/app/side-panel';
import type { GithubPullRequestWithDetails } from '@queries/storage/github-pull-requests';

export function PrSidePanelSections(props: {
  enrichment?: GithubPullRequestWithDetails;
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
