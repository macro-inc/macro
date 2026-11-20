import { t } from '@app/lib/i18n';
import { createElementSize } from '@solid-primitives/resize-observer';
import { createEffect, type JSX, on } from 'solid-js';
import { ScreenOverlay } from '../../components/screen-overlay';
import { ScreenStage } from '../../components/screen-stage';
import { toGuestPoint } from '../../core/geometry';
import type { AgentScreenModel } from './agent-screen-model';

/**
 * The picture with its state overlay, wired to the session and the input
 * controller. The views put their own chrome around it; `children` adds
 * overlays such as the zoom control.
 */
export function ScreenPicture(props: {
  model: AgentScreenModel;
  class?: string;
  children?: JSX.Element;
}) {
  const { session, input } = props.model;
  let container: HTMLDivElement | undefined;
  const size = createElementSize(() => container);

  // The viewer's size feeds the coordinate mapping.
  createEffect(
    on(
      () => [size.width ?? 0, size.height ?? 0] as const,
      ([width, height]) => props.model.setContainerSize({ width, height })
    )
  );

  const loupe = () => {
    const at = input.loupePoint();
    const frame = session.store.frame;
    if (!at || !frame) return undefined;
    const guest = toGuestPoint(
      {
        container: { width: size.width ?? 0, height: size.height ?? 0 },
        frame,
        rotation: 0,
      },
      input.viewport(),
      at,
      true
    );
    return guest ? { at, guest } : undefined;
  };

  return (
    <ScreenStage
      label={t('agentScreen.desktopTitle', { name: props.model.agentName() })}
      frame={session.store.frame}
      transform={input.transform()}
      driven={
        !!session.store.server?.driver && session.store.status.kind === 'live'
      }
      drivingMe={session.drivingMe()}
      stale={session.store.status.kind !== 'live'}
      loupe={loupe()}
      snapshot={(rect) => session.snapshot(rect)}
      handlers={input}
      containerRef={(element) => {
        container = element;
      }}
      frameRef={(element) => session.attach(element)}
      class={props.class}
    >
      <ScreenOverlay
        status={session.store.status}
        agentName={props.model.agentName()}
        onTurnOn={props.model.turnOn()}
        onRetry={() => session.retry()}
      />
      {props.children}
    </ScreenStage>
  );
}
