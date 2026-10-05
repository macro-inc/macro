/**
 * The session and its Changes pane side by side, on a draggable divider.
 * Closing the pane hands the width back to the session; spotlighting it
 * takes the session's width away.
 */

import { FloatRegion } from '@components/app/mobile/float-regions/FloatRegion';
import { FloatRegions } from '@components/app/mobile/float-regions/float-region-state';
import { Resize } from '@core/component/Resize';
import type { ResizeZoneCtx } from '@core/component/Resize/types';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { createMediaQuery } from '@solid-primitives/media';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  type ParentProps,
  Show,
} from 'solid-js';
import { useAgentChanges } from '../context/agent-changes-controller';
import { createChangesNarrow } from '../primitives/create-changes-narrow';
import { ChangesPane } from './ChangesPane';

const SESSION_MIN_PX = 320;
const CHANGES_MIN_PX = 400;

/** Keep the resize panel registered until its content finishes sliding out. */
function createChangesPresence(visible: Accessor<boolean>) {
  const reducedMotion = createMediaQuery('(prefers-reduced-motion: reduce)');
  const [present, setPresent] = createSignal(visible());
  const [transitioning, setTransitioning] = createSignal(false);
  let element: HTMLDivElement | undefined;
  let animation: Animation | undefined;
  let siblings: Animation[] = [];
  const cancelSiblings = () => {
    for (const sibling of siblings) sibling.cancel();
    siblings = [];
  };
  const animateSplit = (
    element: HTMLElement,
    visible: boolean,
    options: KeyframeAnimationOptions
  ) => {
    const continuing = siblings.length > 0;
    const panel = element.parentElement;
    if (!panel?.matches('[data-resize-panel]')) {
      cancelSiblings();
      return;
    }
    const root = panel.parentElement;
    const sessionContent = root?.querySelector<HTMLElement>(
      ':scope > [data-resize-panel] > [data-agent-changes-session]'
    );
    const session =
      sessionContent?.hidden ||
      sessionContent?.hasAttribute('data-slide-underlay')
        ? undefined
        : sessionContent?.parentElement;
    const gutter = root?.querySelector<HTMLElement>(
      ':scope > [role="separator"]'
    );
    const sessionWidth = session
      ? continuing || !visible
        ? getComputedStyle(session).width
        : '100%'
      : undefined;
    const gutterTransform = gutter
      ? continuing || !visible
        ? getComputedStyle(gutter).transform
        : `translateX(${panel.style.width})`
      : undefined;
    cancelSiblings();
    // Match the session and divider to the pane's slide in both directions.
    // The solver holds the resting widths under these temporary animations.
    if (session) {
      siblings.push(
        session.animate(
          [
            { width: sessionWidth },
            { width: visible ? session.style.width : '100%' },
          ],
          options
        )
      );
    }
    if (gutter) {
      gutter.inert = !visible;
      siblings.push(
        gutter.animate(
          [
            { transform: gutterTransform },
            {
              transform: visible
                ? 'translateX(0)'
                : `translateX(${panel.style.width})`,
            },
          ],
          options
        )
      );
    }
  };
  let revision = 0;

  // Synchronize the imperative animation with visibility. The retained owner
  // keeps Resize.Panel's registration and the conversation draft intact on exit.
  createEffect(
    on(visible, (visible) => {
      const current = ++revision;
      setTransitioning(
        !reducedMotion() && typeof HTMLElement.prototype.animate === 'function'
      );
      if (visible) setPresent(true);
      if (!visible && (reducedMotion() || !element?.animate)) {
        animation?.cancel();
        animation = undefined;
        cancelSiblings();
        setPresent(false);
        setTransitioning(false);
        return;
      }
      queueMicrotask(() => {
        if (current !== revision || !element) return;
        // Snapshot values before cancellation: computed styles are live objects.
        const previousTransform = animation
          ? getComputedStyle(element).transform
          : undefined;
        animation?.cancel();
        animation = undefined;
        element.inert = !visible;
        if (reducedMotion() || !element.animate) {
          cancelSiblings();
          setPresent(visible);
          setTransitioning(false);
          return;
        }
        const options: KeyframeAnimationOptions = {
          duration: 220,
          easing: 'ease-in-out',
          fill: 'forwards',
        };
        animateSplit(element, visible, options);
        animation = element.animate(
          [
            {
              transform:
                previousTransform ??
                (visible ? 'translateX(100%)' : 'translateX(0)'),
            },
            { transform: visible ? 'translateX(0)' : 'translateX(100%)' },
          ],
          options
        );
        animation.onfinish = () => {
          if (current !== revision) return;
          const finished = animation;
          animation = undefined;
          setPresent(visible);
          // Hold the final frame through unmount, then release WAAPI styles.
          finished?.cancel();
          cancelSiblings();
          setTransitioning(false);
        };
      });
    })
  );
  onCleanup(() => {
    revision += 1;
    animation?.cancel();
    cancelSiblings();
  });

  return {
    finish: () => {
      revision += 1;
      const finished = animation;
      animation = undefined;
      setPresent(visible());
      finished?.cancel();
      cancelSiblings();
      setTransitioning(false);
    },
    present,
    transitioning,
    ref: (node: HTMLDivElement) => {
      element = node;
    },
  };
}

export function AgentChangesSplit(props: ParentProps) {
  const { available, layout } = useAgentChanges();
  const [root, setRoot] = createSignal<HTMLDivElement>();
  const narrow = createChangesNarrow(root);
  let zone: ResizeZoneCtx | undefined;
  // A host that can never have changes keeps the session alone on screen,
  // whatever a stale URL asks for.
  // Split/full changes keep the same visibility and must not replay the slide.
  const changesVisible = createMemo(
    () => available() && layout.changesVisible()
  );
  const presence = createChangesPresence(changesVisible);
  const sessionVisible = createMemo<boolean>((previous) => {
    if (!available()) return true;
    // A narrow host opens as a takeover without changing the saved wide layout.
    if (changesVisible() && narrow()) return false;
    // A spotlight request during a slide waits for the slide to settle, so its
    // endpoint does not move underneath the running translation.
    if (presence.transitioning()) return previous ?? layout.sessionVisible();
    if (changesVisible()) return layout.sessionVisible();
    // Closing from full width must not shrink the pane before it slides out.
    return presence.present() ? (previous ?? true) : true;
  });
  // Reveal the retained host behind a full-width slide without changing the
  // Changes panel's solved geometry until the slide finishes, including reversals.
  const slideUnderlay = () =>
    presence.present() &&
    !sessionVisible() &&
    (!changesVisible() || presence.transitioning());
  const sessionShown = () => sessionVisible() || slideUnderlay();

  return (
    <div
      ref={setRoot}
      data-agent-changes-host
      class="size-full min-h-0 min-w-0 overflow-hidden"
    >
      <Show
        when={isTouchDevice()}
        fallback={
          <Resize.Zone
            direction="horizontal"
            gutter={1}
            class="overflow-hidden"
            resizable
            captureResizeCtx={(ctx) => {
              zone = ctx;
              createEffect(on(ctx.size, presence.finish, { defer: true }));
            }}
          >
            {/* Hiding retains resize intent and the host's editor/composer owner. */}
            <Resize.Panel
              id="agent-session"
              minSize={SESSION_MIN_PX}
              index={0}
              persistent
              hidden={() => !sessionVisible()}
            >
              <div
                data-agent-changes-session
                data-slide-underlay={slideUnderlay() ? '' : undefined}
                hidden={!sessionShown()}
                inert={!sessionVisible() && changesVisible()}
                style={{
                  width: slideUnderlay() ? `${zone?.size() ?? 0}px` : undefined,
                }}
                class="flex h-full min-w-0 flex-col overflow-hidden"
              >
                {props.children}
              </div>
            </Resize.Panel>
            <Show when={presence.present()}>
              <Resize.Panel
                id="agent-changes"
                minSize={CHANGES_MIN_PX}
                index={1}
                target={layout.changesShare()}
                onSizeChangeEnd={(size) => {
                  const total = zone?.size() ?? 0;
                  if (total > 0) layout.setChangesShare((size / total) * 100);
                }}
              >
                <div ref={presence.ref} class="h-full min-w-0 overflow-hidden">
                  <ChangesPane fullWidth={narrow()} />
                </div>
              </Resize.Panel>
            </Show>
          </Resize.Zone>
        }
      >
        <div class="relative flex size-full min-w-0 flex-col overflow-hidden">
          <div
            class="flex size-full min-w-0 flex-col"
            classList={{ hidden: changesVisible() }}
            inert={changesVisible()}
          >
            {props.children}
          </div>
          <Show when={presence.present()}>
            <div
              ref={presence.ref}
              class="absolute inset-0 min-w-0 pt-(--mobile-content-inset-top)"
              style={{ 'padding-bottom': `${FloatRegions.hostHeight()}px` }}
            >
              <FloatRegion region="accessory" priority={1}>
                <span />
              </FloatRegion>
              <ChangesPane fullWidth />
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
}
