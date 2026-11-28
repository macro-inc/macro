import { DiffCounts } from '@app/components/diff-view';
import { useViewTabHotkeys } from '@app/components/view-shell';
import { useChanges } from '@app/features/changes/changes';
import { t } from '@app/lib/i18n';
import { useFlow } from '@app/observability/flow';
import {
  splitRootScope,
  useSplitPanel,
} from '@components/app/split-layout/layoutUtils';
import { fireAndForget } from '@core/util/fireAndForget';
import Chat from '@icon/system/regular/chat.svg';
import Code from '@icon/system/regular/code.svg';
import { Tabs } from '@ui';
import { Show } from 'solid-js';
import { usePrPage } from '../../context/pr-page-context';

export function PrTabs(props: {
  compact?: boolean;
  fullWidth?: boolean;
  size?: 'sm' | 'md' | 'lg';
}) {
  const { page } = usePrPage();
  const { layout } = useChanges();
  const flow = useFlow();
  const panel = useSplitPanel();
  let tabs: HTMLElement | undefined;
  const active = () => (layout.changesVisible() ? 'changes' : 'overview');
  const select = (value: 'overview' | 'changes') =>
    fireAndForget(
      flow.task('pr.switch-tab', async () => {
        if (value === 'changes') layout.open();
        else layout.close();
      }),
      'pr-tab'
    );
  if (panel)
    useViewTabHotkeys({
      scopeId: splitRootScope(panel),
      tabs: () => tabs,
      ids: () => ['overview', 'changes'] as const,
      activeId: active,
      setActiveId: select,
      label: (id) =>
        id === 'overview' ? t('prPage.overview') : t('prPage.changes'),
    });
  return (
    <Tabs
      ref={(element) => (tabs = element)}
      aria-label={t('prPage.sections')}
      value={active()}
      onChange={select}
      size={props.size ?? 'md'}
      touch="pill"
      fullWidth={props.fullWidth}
      iconOnly={props.compact}
      options={[
        {
          value: 'overview',
          label: t('prPage.overview'),
          icon: Chat,
          count: page()?.comments.length || undefined,
        },
        {
          value: 'changes',
          label: t('prPage.changes'),
          icon: Code,
          accessory: (
            <Show
              when={
                page()?.pullRequest.additions != null &&
                page()?.pullRequest.deletions != null
              }
            >
              <DiffCounts
                additions={page()?.pullRequest.additions ?? 0}
                deletions={page()?.pullRequest.deletions ?? 0}
              />
            </Show>
          ),
        },
      ]}
    />
  );
}
