import { t } from '@app/lib/i18n';
import { FloatRegion } from '@components/app/mobile/float-regions/FloatRegion';
import { MobileHeader } from '@components/app/mobile-header/mobile-header';
import ArrowsDownUpIcon from '@icon/system/regular/arrows-down-up.svg';
import ArrowsOutIcon from '@icon/system/regular/arrows-out-cardinal.svg';
import CursorIcon from '@icon/system/regular/cursor.svg';
import InfoIcon from '@icon/system/regular/info.svg';
import KeyboardIcon from '@icon/system/regular/keyboard.svg';
import LockIcon from '@icon/system/regular/lock.svg';
import PauseIcon from '@icon/system/regular/pause.svg';
import StopIcon from '@icon/system/regular/stop.svg';
import { Button } from '@ui/components/Button';
import { Tabs } from '@ui/components/Tabs';
import { createSignal, Match, Show, Switch } from 'solid-js';
import { match } from 'ts-pattern';
import { ControlLostBanner } from '../../components/control-lost-banner';
import { HandBackDialog } from '../../components/hand-back-dialog';
import { KeyBar } from '../../components/key-bar';
import { StatusPill } from '../../components/status-pill';
import { ZoomControl } from '../../components/zoom-control';
import type { TouchMode } from '../../core/gestures';
import type { AgentScreenModel } from '../shared/agent-screen-model';
import { agentWhileDriven, driverLabel, screenTitle } from '../shared/labels';
import { ScreenNotice } from '../shared/screen-notice';
import { ScreenPicture } from '../shared/screen-picture';

/**
 * The screen viewer on phones and tablets, with full take-over (D6): two
 * fingers always zoom and pan the local view; one finger follows the mode the
 * driver picks (View, Touch, Scroll). Portrait stacks the picture over the
 * controls; landscape puts the controls in a rail beside it. It takes the
 * whole screen: the app's dock and New button stand down while it shows, so
 * a stray tap can't leave a drive.
 */
export function MobileAgentScreen(props: { model: AgentScreenModel }) {
  const { session, input } = props.model;
  const [handingBack, setHandingBack] = createSignal(false);
  const [keysOpen, setKeysOpen] = createSignal(false);

  const live = () => session.store.status.kind === 'live';
  // Stopped, refused or gone: the overlay's own action is the way back, and
  // there is nothing to take over.
  const over = () =>
    session.store.status.kind === 'ended' ||
    session.store.status.kind === 'denied';
  const driver = () => session.store.server?.driver;
  // Keep the zoom control away from the finger.
  const zoomAtTop = () => {
    const at = input.loupePoint();
    return at !== undefined && at.y > 120;
  };

  // A portrait stage is filled, readable, rather than a strip with empty
  // space around it; it follows the stage through resizes and rotation
  // until the person zooms, pans or picks Fit.
  input.fillStage();

  const modes = () => [
    {
      value: 'view' as const,
      label: t('agentScreen.modeView'),
      icon: ArrowsOutIcon,
    },
    {
      value: 'touch' as const,
      label: t('agentScreen.modeTouch'),
      icon: CursorIcon,
    },
    {
      value: 'scroll' as const,
      label: t('agentScreen.modeScroll'),
      icon: ArrowsDownUpIcon,
    },
  ];

  const hint = (mode: TouchMode) =>
    match(mode)
      .with('view', () => t('agentScreen.hintView'))
      .with('touch', () => t('agentScreen.hintTouch'))
      .with('scroll', () =>
        t('agentScreen.hintScroll', { name: props.model.agentName() })
      )
      .exhaustive();

  return (
    <div class="flex size-full min-h-0 flex-col bg-panel pt-(--mobile-content-inset-top) pb-[var(--safe-bottom,0px)] landscape:flex-row">
      <FloatRegion region="accessory" />
      <FloatRegion region="dock" priority={100} />
      <MobileHeader
        trailing={
          <MobileHeader.Island>
            <StatusPill
              status={session.store.status}
              driver={driverLabel(
                session.drivingMe() || session.resumingDrive(),
                session.drivingElsewhere(),
                props.model.driverName()
              )}
            />
          </MobileHeader.Island>
        }
      >
        <MobileHeader.Title label={screenTitle(props.model.agentName())} />
      </MobileHeader>

      <ScreenPicture
        model={props.model}
        class="min-h-0 w-full flex-1 landscape:h-full"
      >
        <Show when={live()}>
          <ZoomControl
            zoom={input.viewport().zoom}
            top={zoomAtTop()}
            onZoomIn={() => input.zoomBy(1.5)}
            onZoomOut={() => input.zoomBy(1 / 1.5)}
            onFit={() => input.fit()}
          />
        </Show>
      </ScreenPicture>

      <div class="flex max-h-[60%] shrink-0 flex-col overflow-y-auto landscape:max-h-none landscape:w-64 landscape:border-l landscape:border-edge-divider">
        <div
          class="flex items-center gap-2 border-y px-3 py-2"
          classList={{
            'border-amber font-medium text-amber-ink': !!driver() && live(),
            'border-transparent': !(driver() && live()),
          }}
        >
          {/* The header names the desktop; this line only says what the agent does. */}
          <span class="flex min-w-0 grow items-center gap-1.5 text-sm">
            <Show when={driver() && live()}>
              <Show
                when={session.store.server?.agentHeld}
                fallback={<CursorIcon class="size-4 shrink-0" />}
              >
                <PauseIcon class="size-4 shrink-0" />
              </Show>
              <span class="truncate">
                {agentWhileDriven(
                  session.store.server?.agentHeld ?? false,
                  props.model.agentName()
                )}
              </span>
            </Show>
          </span>
          <Switch>
            <Match when={over()}>
              <span />
            </Match>
            <Match when={session.drivingMe()}>
              <Button
                size="md"
                variant="primary"
                onClick={() => setHandingBack(true)}
              >
                {t('agentScreen.handBack')}
              </Button>
            </Match>
            <Match when={session.resumingDrive()}>
              {/* A dropped drive is being won back: still the driver's controls. */}
              <Button size="md" variant="primary" disabled>
                {t('agentScreen.handBack')}
              </Button>
            </Match>
            <Match when={session.drivingElsewhere()}>
              {/* The harness takes a hand-back from any tab of the driver. */}
              <Show when={props.model.canDrive()}>
                <Button
                  size="md"
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
                size="md"
                variant="secondary"
                disabled={!live()}
                onClick={() => setHandingBack(true)}
              >
                {t('agentScreen.handBack')}
              </Button>
            </Match>
            <Match when={driver()}>
              <span />
            </Match>
            <Match when={!props.model.canDrive()}>
              <Button size="md" variant="secondary" disabled>
                <LockIcon class="size-4" />
                {t('agentScreen.takeOver')}
              </Button>
            </Match>
            <Match when={props.model.canDrive()}>
              <Button
                size="md"
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
        </div>

        <Show when={!props.model.canDrive() && live()}>
          <p class="flex items-center gap-1.5 px-3 pb-2 text-xs text-ink-muted">
            <InfoIcon class="size-3.5 shrink-0" />
            {t('agentScreen.onlyManagersCanTakeOver')}
          </p>
        </Show>

        {/* Kept through a dropped drive's reconnect, so the key bar keeps focus. */}
        <Show when={session.holdsKeyboard()}>
          <div class="flex items-center gap-2 px-3 py-1 landscape:flex-col landscape:items-stretch">
            <Tabs
              aria-label={t('agentScreen.oneFingerGestures')}
              touch="segmented"
              fullWidth
              options={modes()}
              value={input.touchMode()}
              onChange={(mode) => input.setTouchMode(mode)}
            />
            <Button
              size="icon-md"
              variant="secondary"
              aria-label={
                keysOpen() ? t('agentScreen.hideKeys') : t('agentScreen.keys')
              }
              aria-pressed={keysOpen()}
              onClick={() => setKeysOpen((open) => !open)}
            >
              <KeyboardIcon class="size-5" />
            </Button>
          </div>
          <Show
            when={keysOpen()}
            fallback={
              <p class="flex items-center gap-1.5 px-3 py-2 text-xs text-ink-muted">
                <InfoIcon class="size-3.5 shrink-0" />
                {hint(input.touchMode())}
              </p>
            }
          >
            <KeyBar
              agentName={props.model.agentName()}
              onText={(text) => session.sendInput({ kind: 'text', text })}
              onKey={(keysym, down) =>
                session.sendInput({ kind: 'key', keysym, down })
              }
            />
          </Show>
        </Show>

        <div class="px-3">
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

        {/* As on desktop: while driving, it hands back first. */}
        <Show when={live()}>
          <div class="px-3 py-2">
            <Button size="md" variant="ghost" onClick={() => session.stop()}>
              <StopIcon class="size-4" />
              {t('agentScreen.stopWatching')}
            </Button>
          </div>
        </Show>
      </div>

      <HandBackDialog
        open={handingBack()}
        agentName={props.model.agentName()}
        onClose={() => setHandingBack(false)}
        onHandBack={(note) => {
          setHandingBack(false);
          setKeysOpen(false);
          session.handBack(note);
        }}
      />
    </div>
  );
}
