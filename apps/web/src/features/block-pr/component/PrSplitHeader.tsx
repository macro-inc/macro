import {
  type FileOperation,
  SplitFileMenu,
} from '@components/app/split-layout/components/SplitFileMenu';
import { SplitHeaderLeft } from '@components/app/split-layout/components/SplitHeader';
import {
  SplitTitleFileMenu,
  StaticSplitLabel,
} from '@components/app/split-layout/components/SplitLabel';
import { Permissions } from '@core/component/SharePermissions';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { openExternalUrl } from '@core/util/url';
import GithubIcon from '@icon/mcp-github.svg';
import type { GithubPullRequest } from '@service-storage/generated/schemas';

import type { PrRef } from '../util/prKey';
import { prDisplayName, prHtmlUrl } from '../util/prKey';
import { PrStatusIcon } from './PrStatus';

/**
 * PR identity in the split header chrome and file menu, independent of the
 * legacy block context. Foreign PRs have the same read-only permission that
 * the legacy BlockLoader supplied by default.
 */
export function PrSplitHeader(props: {
  foreignEntityId: string;
  prRef: PrRef;
  enrichment: GithubPullRequest | undefined;
}) {
  const title = () => props.enrichment?.name ?? prDisplayName(props.prRef);
  const githubUrl = () => props.enrichment?.url ?? prHtmlUrl(props.prRef);

  const ops: FileOperation[] = [
    {
      label: 'Open on GitHub',
      icon: GithubIcon,
      action: () => openExternalUrl(githubUrl()),
    },
  ];

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

      <SplitTitleFileMenu>
        <SplitFileMenu
          id={props.foreignEntityId}
          itemType="foreign"
          entityKind="pr"
          permissions={Permissions.CAN_VIEW}
          name={title()}
          ops={ops}
          buttonClass={isTouchDevice() ? 'order-last' : 'order-first'}
        />
      </SplitTitleFileMenu>
    </>
  );
}
