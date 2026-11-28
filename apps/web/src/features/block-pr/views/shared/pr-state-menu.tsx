import { t } from '@app/lib/i18n';
import { useFlow } from '@app/observability/flow';
import { fireAndForget } from '@core/util/fireAndForget';
import ArrowCounterClockwise from '@icon/system/regular/arrow-counter-clockwise.svg';
import DotsThree from '@icon/system/regular/dots-three.svg';
import Eye from '@icon/system/regular/eye.svg';
import FileDashed from '@icon/system/regular/file-dashed.svg';
import GitMerge from '@icon/system/regular/git-merge.svg';
import XCircle from '@icon/system/regular/x-circle.svg';
import { Button, Dropdown } from '@ui';
import { type Component, For, type JSX, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { usePrPage } from '../../context/pr-page-context';
import type { PrActionKey } from '../../primitives/create-pr-actions';

/** Synthetic entities have lifecycle actions, but cannot use a live entity's generic menu. */
export function PrStateMenu() {
  const { actions } = usePrPage();
  const flow = useFlow();
  const options = () =>
    (
      [
        { key: 'merge', label: t('prPage.merge'), icon: GitMerge },
        {
          key: 'ready-for-review',
          label: t('prPage.readyForReview'),
          icon: Eye,
        },
        {
          key: 'convert-to-draft',
          label: t('prPage.convertToDraft'),
          icon: FileDashed,
        },
        { key: 'close', label: t('prPage.close'), icon: XCircle },
        {
          key: 'reopen',
          label: t('prPage.reopen'),
          icon: ArrowCounterClockwise,
        },
      ] satisfies {
        key: PrActionKey;
        label: string;
        icon: Component<JSX.SvgSVGAttributes<SVGSVGElement>>;
      }[]
    ).filter((option) => actions.changeState.availableFor(option.key));
  const run = async (key: PrActionKey) => {
    if (actions.pending() || !actions.changeState.availableFor(key)) return;
    await flow.task('pr.change-state', async () => {
      await actions.changeState.run?.(key);
    });
  };
  return (
    <Show when={options().length}>
      <Dropdown placement="bottom-end">
        <Dropdown.Trigger
          as={Button}
          size="icon-sm"
          variant="ghost"
          aria-label={t('prPage.stateActions')}
        >
          <DotsThree class="size-4" />
        </Dropdown.Trigger>
        <Dropdown.Content>
          <For each={options()}>
            {(option) => (
              <Dropdown.Item
                disabled={actions.pending()}
                onSelect={() =>
                  fireAndForget(run(option.key), 'pr-change-state')
                }
              >
                <Dynamic component={option.icon} class="size-4" />
                {option.label}
              </Dropdown.Item>
            )}
          </For>
        </Dropdown.Content>
      </Dropdown>
    </Show>
  );
}
