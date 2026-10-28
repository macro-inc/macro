import {
  GithubPullRequestChecksContent,
  SidePanel,
} from '@components/app/side-panel';
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
                {(author) => <div>Authored by {author()}</div>}
              </Show>
              <div>
                {pr().owner}/{pr().repo}
              </div>
              <Show when={pr().status}>
                {(status) => <div class="capitalize">{status()}</div>}
              </Show>
              <Show when={pr().additions != null || pr().deletions != null}>
                <div>
                  +{pr().additions ?? 0} / −{pr().deletions ?? 0}
                </div>
              </Show>
              <a
                href={pr().url}
                target="_blank"
                rel="noreferrer"
                class="truncate hover:underline"
              >
                {pr().displayName}
              </a>
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
