import { t } from '@app/lib/i18n';
import { Button, Tabs } from '@ui';
import { type JSX, Show } from 'solid-js';

export type ToolFilter = 'all' | 'differs';

/**
 * "Individual tools" under a group's actions: a title, the All/Differs
 * filter, and the tools listed per action. Search hides the filter.
 */
export function PermissionToolList(props: {
  total: number;
  differs: number;
  filter?: ToolFilter;
  onFilterChange: (filter: ToolFilter) => void;
  children: JSX.Element;
}) {
  return (
    <div class="mt-2 border-t border-edge-divider pt-3">
      <div class="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div class="min-w-0">
          <h4 class="text-sm font-medium text-ink">
            {t('agentPermissions.individualTools')}
          </h4>
          <p class="text-xs text-ink-muted">
            {t('agentPermissions.individualToolsHint')}
            <Show when={props.differs > 0}>
              {' '}
              {t('agentPermissions.differNow', { count: props.differs })}
            </Show>
          </p>
        </div>
        <Show when={props.filter}>
          {(filter) => (
            <Tabs
              aria-label={t('agentPermissions.toolFilter')}
              size="xs"
              touch="segmented"
              value={filter()}
              onChange={props.onFilterChange}
              options={[
                {
                  value: 'all',
                  label: t('agentPermissions.filterAll'),
                  count: props.total,
                },
                {
                  value: 'differs',
                  label: t('agentPermissions.filterDiffers'),
                  count: props.differs,
                },
              ]}
            />
          )}
        </Show>
      </div>
      <div class="mt-1 flex flex-col">{props.children}</div>
    </div>
  );
}

/** The tools of one action, under the action's name. */
export function PermissionToolSection(props: {
  action: string;
  children: JSX.Element;
}) {
  return (
    <section class="mt-2">
      <h5 class="pt-1 text-xxs font-medium tracking-wide text-ink-extra-muted uppercase">
        {props.action}
      </h5>
      {props.children}
    </section>
  );
}

/** Lists the rest of a long action's tools. */
export function ShowMoreTools(props: { count: number; onClick: () => void }) {
  return (
    <Button
      type="button"
      variant="link"
      size="sm"
      class="self-start"
      onClick={() => props.onClick()}
    >
      {t('agentPermissions.showMore', { count: props.count })}
    </Button>
  );
}
