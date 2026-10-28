import { t } from '@app/lib/i18n';
import CaretDown from '@icon/system/regular/caret-down.svg';
import { Button, ButtonGroup, Dropdown } from '@ui';
import { For, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import type { PrActions } from '../primitives/create-pr-actions';

/**
 * The pull request header's split button: Merge, or Ready for review for a
 * draft, with the other state changes (convert to draft, close) behind the
 * chevron. Merge stays visible but disabled until every check passes.
 */
export function PullRequestActionsButton(props: { actions: PrActions }) {
  return (
    <Show when={props.actions.primary()}>
      {(primary) => (
        <Dropdown placement="bottom-end">
          <ButtonGroup
            variant={primary().key === 'merge' ? 'success' : 'outline'}
            depth={2}
            label={t('entityActions.prActions')}
          >
            <Button
              disabled={props.actions.pending() || !!primary().disabledReason}
              tooltip={primary().disabledReason}
              aria-description={primary().disabledReason}
              data-pull-request-primary-action={primary().key}
              onClick={() => primary().run()}
            >
              <Dynamic component={primary().icon} class="size-3.5" />
              <span>
                {primary().key === 'merge' && props.actions.pending()
                  ? t('entityActions.prMerging')
                  : primary().label}
              </span>
            </Button>
            <Show when={props.actions.secondary().length > 0}>
              <ButtonGroup.Divider />
              <Dropdown.Trigger
                size="icon-md"
                label={t('entityActions.prMoreActions')}
                disabled={props.actions.pending()}
              >
                <CaretDown class="size-3.5" />
              </Dropdown.Trigger>
            </Show>
          </ButtonGroup>
          <Dropdown.Content>
            <Dropdown.Group>
              <For each={props.actions.secondary()}>
                {(action) => (
                  <Dropdown.Item onSelect={action.run}>
                    <Dynamic component={action.icon} class="size-4 shrink-0" />
                    {action.label}
                  </Dropdown.Item>
                )}
              </For>
            </Dropdown.Group>
          </Dropdown.Content>
        </Dropdown>
      )}
    </Show>
  );
}
