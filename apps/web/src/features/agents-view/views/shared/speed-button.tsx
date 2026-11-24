import { t } from '@app/lib/i18n';
import Bolt from '@icon/system/fill/lightning-fill.svg';
import CaretDown from '@icon/system/regular/caret-down.svg';
import Check from '@icon/system/regular/check.svg';
import Minus from '@icon/system/regular/minus.svg';
import Rocket from '@icon/system/regular/rocket.svg';
import { Dropdown } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import { useUnifiedModelSelector } from '../../components/unified-model-selector/root';
import { speedChoices } from '../../core/model-selection';

type Tier = 'standard' | 'fast' | 'ultrafast';
function SpeedGlyph(props: { tier: Tier; class?: string }) {
  return (
    <Show
      when={props.tier !== 'standard'}
      fallback={<Minus class={props.class} />}
    >
      <Show
        when={props.tier === 'ultrafast'}
        fallback={<Bolt class={props.class} />}
      >
        <Rocket class={props.class} />
      </Show>
    </Show>
  );
}
function cost(tier: Tier) {
  return tier === 'fast'
    ? t('agentControls.shortUsageFast')
    : t('agentControls.shortUsageUltrafast');
}

export function SpeedButton() {
  const state = useUnifiedModelSelector();
  const [open, setOpen] = createSignal(false);
  const choices = () => speedChoices(state.speeds ?? []);
  const selected = () =>
    choices().find((choice) => choice.value === state.speedValue) ??
    choices().find((choice) => choice.tier === 'standard');
  const tier = () => selected()?.tier ?? 'standard';
  return (
    <Show when={choices().length > 1}>
      <Dropdown
        open={open()}
        onOpenChange={setOpen}
        placement="top-end"
        gutter={6}
      >
        <Dropdown.Trigger
          variant="ghost"
          size="xs"
          disabled={state.disabled}
          aria-label={t('agentControls.speed')}
        >
          <Show when={tier() !== 'standard'}>
            <SpeedGlyph tier={tier()} class="size-4" />
          </Show>
          <span>{t(`agentControls.tier${tier()}`)}</span>
          <Show when={tier() !== 'standard'}>
            <span class="text-ink-extra-muted">{cost(tier())}</span>
          </Show>
          <CaretDown class="size-4" />
        </Dropdown.Trigger>
        <Dropdown.Content class="min-w-48">
          <Dropdown.Group>
            <Dropdown.RadioGroup value={selected()?.value}>
              <For each={choices()}>
                {(choice) => (
                  <Dropdown.RadioItem
                    value={choice.value}
                    closeOnSelect
                    disabled={state.disabled}
                    onSelect={() => {
                      state.onSpeed(choice.value);
                      setOpen(false);
                    }}
                  >
                    <SpeedGlyph tier={choice.tier} class="size-4" />
                    <Dropdown.ItemLabel class="flex-1">
                      {t(`agentControls.tier${choice.tier}`)}
                    </Dropdown.ItemLabel>
                    <Show when={choice.tier !== 'standard'}>
                      <span class="text-ink-extra-muted">
                        {cost(choice.tier)}
                      </span>
                    </Show>
                    <Dropdown.ItemIndicator>
                      <Check class="size-4" />
                    </Dropdown.ItemIndicator>
                  </Dropdown.RadioItem>
                )}
              </For>
            </Dropdown.RadioGroup>
          </Dropdown.Group>
        </Dropdown.Content>
      </Dropdown>
    </Show>
  );
}
