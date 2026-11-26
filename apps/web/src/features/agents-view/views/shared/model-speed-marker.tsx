import { selectConfigOption } from '@app/features/block-agent/state/session-config';
import Bolt from '@icon/system/fill/lightning-fill.svg';
import { useAgentCapabilitiesQuery } from '@queries/agents/capabilities';
import { Show, Suspense } from 'solid-js';
import { useUnifiedModelSelector } from '../../components/unified-model-selector/root';

/** Discover only visible model choices; never infer a runtime tier from its name. */
export function ModelSpeedMarker(props: { model: string }) {
  const state = useUnifiedModelSelector();
  const known = () => state.suggestedSpeeds?.[props.model];
  const query = useAgentCapabilitiesQuery(() => {
    if (known()) return undefined;
    const harness = state.suggestedHarness;
    if (harness !== 'macro-inmem' && harness !== 'in-memory') return undefined;
    return { harness: 'in-memory', model: props.model };
  });
  const ultrafast = () => {
    const offered = known();
    if (offered) return offered.includes('ultrafast');
    if (!query.isSuccess) return false;
    const speed = selectConfigOption(
      query.data.configOptions,
      'speed',
      'speed'
    );
    return speed?.options.some((option) => option.value === 'ultrafast');
  };
  return (
    <Suspense>
      <Show when={ultrafast()}>
        <span
          aria-hidden="true"
          class="flex h-3 w-4 shrink-0 items-center text-ink-extra-muted"
        >
          <Bolt class="size-3" />
          <Bolt class="-ml-1.5 size-3" />
        </span>
      </Show>
    </Suspense>
  );
}
