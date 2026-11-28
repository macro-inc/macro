import { ViewBreadcrumbs, ViewShell } from '@app/components/view-shell';
import { AskMacroButton } from '@app/features/chat/ChatWithAgentButton';
import { t } from '@app/lib/i18n';
import { HeaderActionGroup } from '@components/app/HeaderActionGroup';
import { useSidePanel } from '@components/app/side-panel';
import Share from '@icon/share.svg';
import Sidebar from '@icon/system/regular/sidebar-simple.svg';
import * as Popover from '@kobalte/core/popover';
import { Button } from '@ui';
import { Match, Show, Switch } from 'solid-js';
import { PrStatusIcon } from '../component/PrStatus';
import type { PrPageReadModel } from '../context/pr-page-read-model';
import { prLifecycleStatus } from '../primitives/pr-page-state';
import { prHtmlUrl } from '../util/prKey';
import { PrDetailsColumn } from './shared/pr-details';
import type { PrPageViewProps } from './shared/pr-page-view-props';

/** Real DOM groups own flex placement; TopBarTitle is a fragment on desktop. */
export function PrPageTopBar(
  props: PrPageViewProps & {
    page?: PrPageReadModel;
    changesVisible: boolean;
    floatingDetails: boolean;
    detailsOpen: boolean;
    onDetailsOpenChange: (open: boolean) => void;
    checksOpen: boolean;
    onChecksOpenChange: (open: boolean) => void;
    onFile: (path: string) => void;
  }
) {
  const sidePanel = useSidePanel();
  const name = () => props.page?.pullRequest.name ?? t('prPage.loading');
  return (
    <ViewShell.TopBar navigation={props.changesVisible ? false : undefined}>
      <div class="flex min-w-0 items-center gap-2" style={{ flex: '1 1 0%' }}>
        <ViewShell.TopBarTitle>
          <Switch>
            <Match when={props.hosted}>
              <ViewBreadcrumbs.Outlet aria-label={t('prPage.location')} />
            </Match>
            <Match when={true}>
              <PrStatusIcon
                status={prLifecycleStatus(props.page?.pullRequest)}
              />
              <span class="ph-no-capture truncate text-sm font-medium">
                {name()}
              </span>
            </Match>
          </Switch>
          {props.fileMenu}
        </ViewShell.TopBarTitle>
      </div>
      <div
        class="flex shrink-0 items-center gap-2"
        style={{ 'margin-left': 'auto' }}
      >
        <HeaderActionGroup label={t('prPage.stateActions')}>
          <Show when={props.page}>
            {(current) => (
              <AskMacroButton
                grouped
                entity={{
                  type: 'pr',
                  id: current().id,
                  url: current().pullRequest.url ?? prHtmlUrl(current().prRef),
                }}
              />
            )}
          </Show>
        </HeaderActionGroup>
        <HeaderActionGroup label={t('prPage.share')}>
          <Button
            size="sm"
            variant="ghost"
            disabled={props.shareEnabled === false}
            onClick={props.share}
          >
            <Share class="size-4" />
            <span>{t('prPage.share')}</span>
          </Button>
        </HeaderActionGroup>
        <HeaderActionGroup label={t('prPage.details')}>
          <Show
            when={props.floatingDetails}
            fallback={
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={t('prPage.details')}
                aria-pressed={sidePanel?.isOpen() ?? false}
                onClick={() => sidePanel?.toggle()}
              >
                <Sidebar class="size-4" />
              </Button>
            }
          >
            <Popover.Root
              open={props.detailsOpen}
              onOpenChange={(open) => props.onDetailsOpenChange(open)}
              placement="bottom-end"
              gutter={8}
            >
              <Popover.Trigger
                as={Button}
                size="icon-sm"
                variant="ghost"
                aria-label={t('prPage.details')}
                aria-pressed={props.detailsOpen}
              >
                <Sidebar class="size-4" />
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Content
                  class="menu-surface z-modal w-80 max-w-[calc(100vw-24px)] max-h-[70dvh] overflow-y-auto rounded-xl"
                  aria-label={t('prPage.details')}
                >
                  <Show when={props.page}>
                    {(current) => (
                      <PrDetailsColumn
                        page={current()}
                        onFile={props.onFile}
                        onTask={props.onTask}
                        checksOpen={props.checksOpen}
                        onChecksOpenChange={(open) =>
                          props.onChecksOpenChange(open)
                        }
                      />
                    )}
                  </Show>
                </Popover.Content>
              </Popover.Portal>
            </Popover.Root>
          </Show>
        </HeaderActionGroup>
      </div>
    </ViewShell.TopBar>
  );
}
