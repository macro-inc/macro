import { t } from '@app/lib/i18n';
import {
  SplitHeaderLeft,
  SplitHeaderRight,
} from '@components/app/split-layout/components/SplitHeader';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useSplitPanel } from '@components/app/split-layout/layoutUtils';
import { IS_MAC } from '@core/constant/isMac';
import ArrowSquareOutIcon from '@icon/system/regular/arrow-square-out.svg';
import CursorIcon from '@icon/system/regular/cursor.svg';
import LockIcon from '@icon/system/regular/lock.svg';
import StopIcon from '@icon/system/regular/stop.svg';
import { Button } from '@ui/components/Button';
import { createSignal, Match, Show, Switch } from 'solid-js';
import { ControlLostBanner } from '../components/control-lost-banner';
import { HandBackDialog } from '../components/hand-back-dialog';
import { StatusPill } from '../components/status-pill';
import { ZoomControl } from '../components/zoom-control';
import { agentScreenContent } from '../core/route';
import type { AgentScreenModel } from './shared/agent-screen-model';
import { agentWhileDriven, driverLabel, screenTitle } from './shared/labels';
import { ScreenNotice } from './shared/screen-notice';
import { ScreenPicture } from './shared/screen-picture';

/** The screen viewer on desktop: a split beside the conversation, or popped out. */
export function AgentScreen(props: { model: AgentScreenModel }) {
  const { session } = props.model;
  const panel = useSplitPanel();
  const { popoverSplit } = useSplitLayout();
  const [handingBack, setHandingBack] = createSignal(false);

  const live = () => session.store.status.kind === 'live';
  const driver = () => session.store.server?.driver;
  const isPopover = () => panel?.handle.isPopover() ?? false;

  const popOut = () => {
    // Driving moves with the view instead of being handed back and lost.
    const continueDriving = session.carryLeaseAway();
    popoverSplit(
      agentScreenContent(props.model.harnessId, { continueDriving })
    );
    panel?.handle.close();
  };

  return (
    <div class="flex size-full min-h-0 flex-col bg-panel">
      <SplitHeaderLeft>
        <div class="flex min-w-0 items-center gap-2 px-2">
          <StatusPill
            status={session.store.status}
            driver={driverLabel(
              session.drivingMe() || session.resumingDrive(),
              session.drivingElsewhere(),
              props.model.driverName()
            )}
          />
          <span class="truncate text-sm font-semibold text-ink">
            {screenTitle(props.model.agentName())}
          </span>
        </div>
      </SplitHeaderLeft>
      <SplitHeaderRight>
        <Show when={!isPopover()}>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={t('agentScreen.popOut')}
            tooltip={t('agentScreen.popOut')}
            onClick={popOut}
          >
            <ArrowSquareOutIcon class="size-4" />
          </Button>
        </Show>
      </SplitHeaderRight>

      <div class="flex min-h-0 flex-1 flex-col gap-2 p-3">
        <ScreenPicture model={props.model} class="min-h-48 flex-1 rounded-lg">
          {/* A way back to fit after a trackpad pinch (Ctrl+wheel). */}
          <Show when={props.model.input.viewport().zoom > 1}>
            <ZoomControl
              zoom={props.model.input.viewport().zoom}
              top={false}
              onZoomIn={() => props.model.input.zoomBy(1.5)}
              onZoomOut={() => props.model.input.zoomBy(1 / 1.5)}
              onFit={() => props.model.input.fit()}
            />
          </Show>
          <Show when={live() && driver()}>
            <div class="absolute top-2 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full border border-amber bg-panel px-3 py-1 text-xs font-medium text-amber-ink shadow">
              <CursorIcon class="size-3.5" />
              <Switch
                fallback={t('agentScreen.someoneIsDriving', {
                  name: props.model.driverName() ?? '',
                })}
              >
                <Match when={session.drivingMe() || session.resumingDrive()}>
                  {t('agentScreen.youAreDriving')}
                </Match>
                <Match when={session.drivingElsewhere()}>
                  {t('agentScreen.youAreDrivingElsewhere')}
                </Match>
              </Switch>
              <span>·</span>
              {agentWhileDriven(
                session.store.server?.agentHeld ?? false,
                props.model.agentName()
              )}
              <Show when={session.drivingMe()}>
                <span
                  class="ml-1 border-l border-current pl-2"
                  classList={{
                    'animate-pulse': props.model.input.escapeHeld(),
                  }}
                >
                  {t('agentScreen.holdEscToHandBack')}
                </span>
                <span class="border-l border-current pl-2">
                  {IS_MAC
                    ? t('agentScreen.leaveKeyboardHintMac')
                    : t('agentScreen.leaveKeyboardHint')}
                </span>
              </Show>
            </div>
          </Show>
        </ScreenPicture>

        <div class="flex flex-wrap items-center gap-2">
          <Switch>
            <Match when={session.drivingMe()}>
              <Button
                size="sm"
                variant="primary"
                onClick={() => setHandingBack(true)}
              >
                {t('agentScreen.handBack')}
              </Button>
            </Match>
            <Match when={session.resumingDrive()}>
              {/* A dropped drive is being won back: still the driver's controls. */}
              <Button size="sm" variant="primary" disabled>
                {t('agentScreen.handBack')}
              </Button>
            </Match>
            <Match when={session.drivingElsewhere()}>
              {/* The harness takes a hand-back from any tab of the driver. */}
              <Show when={props.model.canDrive()}>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={!live()}
                  loading={session.store.takingOver}
                  onClick={() => session.takeOver()}
                >
                  <CursorIcon class="size-4" />
                  {t('agentScreen.takeOverHere')}
                </Button>
              </Show>
              <Button
                size="sm"
                variant="secondary"
                disabled={!live()}
                onClick={() => setHandingBack(true)}
              >
                {t('agentScreen.handBack')}
              </Button>
            </Match>
            <Match when={driver()}>
              {/* Someone else drives; the pill above says who. */}
              <span />
            </Match>
            <Match when={!props.model.canDrive()}>
              <Button
                size="sm"
                variant="secondary"
                disabled
                tooltip={t('agentScreen.onlyManagersCanTakeOver')}
              >
                <LockIcon class="size-4" />
                {t('agentScreen.takeOver')}
              </Button>
            </Match>
            <Match when={props.model.canDrive()}>
              <Button
                size="sm"
                variant="primary"
                disabled={!live()}
                loading={session.store.takingOver}
                onClick={() => session.takeOver()}
              >
                <CursorIcon class="size-4" />
                {session.store.takingOver
                  ? t('agentScreen.takingOver')
                  : t('agentScreen.takeOver')}
              </Button>
            </Match>
          </Switch>
          <span class="grow" />
          <Show when={live()}>
            <Button
              size="sm"
              variant="danger-ghost"
              onClick={() => session.stop()}
            >
              <StopIcon class="size-4" />
              {t('agentScreen.stopWatching')}
            </Button>
          </Show>
        </div>

        <ControlLostBanner
          state={session.controlLost()}
          driverName={props.model.driverName()}
          agentName={props.model.agentName()}
          onTakeOver={
            props.model.canDrive() ? () => session.takeOver() : undefined
          }
          onDismiss={() => session.dismissControlLost()}
        />
        <ScreenNotice notice={session.store.notice} />
      </div>

      <HandBackDialog
        open={handingBack()}
        agentName={props.model.agentName()}
        onClose={() => setHandingBack(false)}
        onHandBack={(note) => {
          setHandingBack(false);
          session.handBack(note);
        }}
      />
    </div>
  );
}
