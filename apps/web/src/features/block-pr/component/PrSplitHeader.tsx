import { SplitFileMenu } from '@components/app/split-layout/components/SplitFileMenu';
import { SplitHeaderLeft } from '@components/app/split-layout/components/SplitHeader';
import {
  SplitTitleFileMenu,
  StaticSplitLabel,
} from '@components/app/split-layout/components/SplitLabel';
import { Permissions } from '@core/component/SharePermissions';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import type { PrForeignEntityData } from '../data/queries';
import type { PrActions } from '../primitives/create-pr-actions';
import { usePrFileOperations } from '../primitives/pr-file-operations';
import { prDisplayName } from '../util/prKey';
import { PrStatusIcon } from './PrStatus';

/**
 * PR identity in the split header chrome and file menu, independent of the
 * legacy block context. Foreign PRs have the same read-only permission that
 * the legacy BlockLoader supplied by default; GitHub decides whether the
 * menu's changes go through.
 */
export function PrSplitHeader(props: {
  detail: PrForeignEntityData;
  actions: PrActions;
}) {
  const title = () =>
    props.detail.pullRequest.name ?? prDisplayName(props.detail.prRef);
  const operations = usePrFileOperations(() => props.detail, props.actions);

  return (
    <>
      <SplitHeaderLeft>
        <StaticSplitLabel
          label={title()}
          icon={
            <PrStatusIcon
              status={props.detail.pullRequest.status ?? 'open'}
              class="size-3.5"
            />
          }
        />
      </SplitHeaderLeft>

      <SplitTitleFileMenu>
        <SplitFileMenu
          id={props.detail.id}
          itemType="foreign"
          entityKind="pr"
          permissions={Permissions.CAN_VIEW}
          name={title()}
          ops={operations()}
          buttonClass={isTouchDevice() ? 'order-last' : 'order-first'}
        />
      </SplitTitleFileMenu>
    </>
  );
}
