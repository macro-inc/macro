import { SplitHeaderScope } from '@components/app/SplitHeaderScope';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { type JSX, type ParentProps, Show } from 'solid-js';
import { entityDetailHostsSplitHeader } from './EntityDetail';
import type { EntityDetailTarget } from './entity-detail-target';

/**
 * An inline detail host's frame: its top bar above the detail. On touch, a
 * target whose detail has a mobile view shows that view's own header in the
 * pane's top bar instead, as its standalone view does, so the host adds no
 * touch chrome of its own for it. Hosts decide only their desktop `topBar`.
 */
export function EntityDetailFrame(
  props: ParentProps<{
    target: EntityDetailTarget | undefined;
    /** The host's bar: on desktop, and on touch for other targets. */
    topBar?: JSX.Element;
  }>
) {
  const hostsHeader = () => {
    const target = props.target;
    return (
      isTouchDevice() &&
      target !== undefined &&
      entityDetailHostsSplitHeader(target)
    );
  };

  return (
    <SplitHeaderScope.Root when={hostsHeader()}>
      <div class="flex size-full min-h-0 min-w-0 flex-col overflow-hidden">
        <Show when={hostsHeader()} fallback={props.topBar}>
          <SplitHeaderScope.TopBar />
        </Show>
        <div class="relative min-h-0 min-w-0 flex-1">{props.children}</div>
      </div>
    </SplitHeaderScope.Root>
  );
}
