import {
  GithubPullRequestChecksContent,
  SidePanel,
} from '@components/app/side-panel';
import { EntityMetadataRow } from '@components/app/side-panel/EntityMetadata';
import type { GithubPullRequestWithDetails } from '@queries/storage/github-pull-requests';
import { Show } from 'solid-js';
import { PrAgentSessionsSection } from './PrAgentSessionsSection';
import { PrLinkedWorkSection } from './PrLinkedWorkSection';

export function PrSidePanelSections(props: {
  enrichment?: GithubPullRequestWithDetails;
  status: 'pending' | 'error' | 'success';
}) {
  return (
    <>
      <SidePanel.Footer>
        <Show when={props.enrichment} fallback={<SidePanel.Loading />}>
          {(pr) => (
            <div class="flex flex-col gap-1">
              <Show when={pr().authorLogin}>
                {(author) => (
                  <EntityMetadataRow label="Author">
                    {author()}
                  </EntityMetadataRow>
                )}
              </Show>
              <EntityMetadataRow label="Repository">
                {pr().owner}/{pr().repo}
              </EntityMetadataRow>
              <Show when={pr().status}>
                {(status) => (
                  <EntityMetadataRow label="Status">
                    <span class="capitalize">{status()}</span>
                  </EntityMetadataRow>
                )}
              </Show>
              <Show when={pr().additions != null || pr().deletions != null}>
                <EntityMetadataRow label="Changes">
                  +{pr().additions ?? 0} / −{pr().deletions ?? 0}
                </EntityMetadataRow>
              </Show>
              <EntityMetadataRow label="Pull request">
                <a
                  href={pr().url}
                  target="_blank"
                  rel="noreferrer"
                  class="block truncate hover:underline"
                >
                  {pr().displayName}
                </a>
              </EntityMetadataRow>
            </div>
          )}
        </Show>
      </SidePanel.Footer>

      <SidePanel.Section id="pr-checks" title="Checks" order={20}>
        <GithubPullRequestChecksContent enrichment={props.enrichment} />
      </SidePanel.Section>

      <PrLinkedWorkSection pullRequest={props.enrichment} />

      <PrAgentSessionsSection
        url={props.enrichment?.url}
        prStatus={props.status}
      />
    </>
  );
}
