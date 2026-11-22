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
  // Stopped, refused, gone or asleep: the overlay's own action is the way
  // back, and there is nothing to take over.
  const over = () =>
    session.store.status.kind === 'ended' ||
    session.store.status.kind === 'denied' ||
    session.store.status.kind === 'asleep';
  const driver = () => session.store.server?.driver;
  const isPopover = () => panel?.handle.isPopover() ?? false;

  const popOut = () => {
    // Driving moves with the view instead of being handed back and lost.
    const continueDriving = session.carryLeaseAway();
    popoverSplit(
      agentScreenContent(props.model.harnessId, { continueDriving }),
      { wide: true }
    );
    panel?.handle.close();
  };

  const heading = () => (
    <div
      data-screen-heading=""
      class="flex min-w-0 items-center gap-2"
      classList={{ 'px-2': !isPopover() }}
    >
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
  );

  return (
    <div
      class="flex min-h-0 flex-col bg-panel"
      classList={{ 'size-full': !isPopover() }}
    >
      {/* A popover has no split header: the heading is the view's own. */}
      <Show
        when={isPopover()}
        fallback={
          <>
            <SplitHeaderLeft>{heading()}</SplitHeaderLeft>
            <SplitHeaderRight>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={t('agentScreen.popOut')}
                tooltip={t('agentScreen.popOut')}
                onClick={popOut}
              >
                <ArrowSquareOutIcon class="size-4" />
              </Button>
            </SplitHeaderRight>
          </>
        }
      >
        <div class="px-3 pt-3">{heading()}</div>
      </Show>

      <div class="flex min-h-0 flex-1 flex-col gap-2 p-3">
        {/*
          Popped out, the dialog sizes to its content: the picture keeps the
          desktop's 16:9 at the dialog's width, short enough to leave room for
          the controls in 75% of the window.
        */}
        <ScreenPicture
          model={props.model}
          class={
            isPopover()
              ? '@container/screen aspect-video max-h-[calc(75vh-8rem)] w-full shrink-0 rounded-lg'
              : '@container/screen min-h-48 flex-1 rounded-lg'
          }
        >
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
          {/*
            The header pill says who drives; this one says what the agent
            does meanwhile and, for the driver, how to let go. One line:
            the hints shorten, then drop, as the split narrows.
          */}
          <Show when={live() && driver()}>
            <div
              data-screen-driving-pill=""
              class="absolute top-2 left-1/2 z-10 flex w-max max-w-[calc(100%-1rem)] -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-full border border-amber bg-panel px-3 py-1 text-xs font-medium text-amber-ink shadow"
            >
              <CursorIcon class="size-3.5 shrink-0" />
              <span class="min-w-0 truncate">
                {agentWhileDriven(
                  session.store.server?.agentHeld ?? false,
                  props.model.agentName()
                )}
              </span>
              <Show when={session.drivingMe()}>
                <span
                  class="shrink-0 border-l border-current pl-2"
                  classList={{
                    'animate-pulse': props.model.input.escapeHeld(),
                  }}
                >
                  <span class="hidden @min-[30rem]/screen:inline">
                    {t('agentScreen.holdEscToHandBack')}
                  </span>
                  <span class="@min-[30rem]/screen:hidden">
                    {t('agentScreen.holdEscToHandBackShort')}
                  </span>
                </span>
                <span class="hidden shrink-0 border-l border-current pl-2 @min-[34rem]/screen:inline">
                  <span class="hidden @min-[44rem]/screen:inline">
                    {IS_MAC
                      ? t('agentScreen.leaveKeyboardHintMac')
                      : t('agentScreen.leaveKeyboardHint')}
                  </span>
                  <span class="@min-[44rem]/screen:hidden">
                    {IS_MAC
                      ? t('agentScreen.leaveKeyboardHintShortMac')
                      : t('agentScreen.leaveKeyboardHintShort')}
                  </span>
                </span>
              </Show>
            </div>
          </Show>
        </ScreenPicture>

        <div class="flex flex-wrap items-center gap-2">
          <Switch>
            <Match when={over()}>
              <span />
            </Match>
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
            <Button size="sm" variant="ghost" onClick={() => session.stop()}>
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
