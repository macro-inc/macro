import {
  type BlockTool,
  ResponsiveBlockToolbar,
} from '@components/app/ResponsiveBlockToolbar';
import type { FileOperation } from '@components/app/split-layout/components/SplitFileMenu';
import { SplitHeaderLeft } from '@components/app/split-layout/components/SplitHeader';
import { StaticSplitLabel } from '@components/app/split-layout/components/SplitLabel';
import { useBlockId } from '@core/block';
import { openExternalUrl } from '@core/util/url';
import GithubIcon from '@icon/mcp-github.svg';
import type { GithubPullRequest } from '@service-storage/generated/schemas';

import type { PrRef } from '../util/prKey';
import { prDisplayName, prHtmlUrl } from '../util/prKey';
import { PrStatusIcon } from './PrStatus';

/**
 * PR identity in the split header chrome plus the standard split toolbar:
 * file menu (open on GitHub), side panel toggle, and narrow content/info
 * tabs — matching the other block types.
 */
export function PrSplitHeader(props: {
  prRef: PrRef;
  enrichment: GithubPullRequest | undefined;
}) {
  const blockId = useBlockId();
  const title = () => props.enrichment?.name ?? prDisplayName(props.prRef);
  const githubUrl = () => props.enrichment?.url ?? prHtmlUrl(props.prRef);

  const ops: FileOperation[] = [
    {
      label: 'Open on GitHub',
      icon: GithubIcon,
      action: () => openExternalUrl(githubUrl()),
    },
  ];

  const tools: BlockTool[] = [];

  return (
    <>
      <SplitHeaderLeft>
        <StaticSplitLabel
          label={title()}
          icon={
            <PrStatusIcon
              status={props.enrichment?.status ?? 'open'}
              class="size-3.5"
            />
          }
        />
      </SplitHeaderLeft>

      <ResponsiveBlockToolbar
        tools={tools}
        ops={ops}
        id={blockId}
        itemType="foreign"
        name={title()}
      />
    </>
  );
}
