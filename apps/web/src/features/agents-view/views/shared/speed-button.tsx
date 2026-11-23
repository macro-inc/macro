import { t } from '@app/lib/i18n';
import Bolt from '@icon/system/fill/lightning-fill.svg';
import CaretDown from '@icon/system/regular/caret-down.svg';
import Check from '@icon/system/regular/check.svg';
import Minus from '@icon/system/regular/minus.svg';
import Rocket from '@icon/system/regular/rocket.svg';
import { Dropdown } from '@ui';
import { cn } from '@ui/utils/classname';
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

export function SpeedButton(props: { mobile?: boolean }) {
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
        gutter={props.mobile ? 8 : 6}
      >
        <Dropdown.Trigger
          variant="ghost"
          size="xs"
          disabled={state.disabled}
          aria-label={t('agentControls.speed')}
          class={cn(
            'h-6 min-h-6 gap-1 rounded-full pl-2.5 pr-1.5 text-xs text-ink-muted',
            tier() !== 'standard' && 'bg-selected pl-2 text-ink',
            props.mobile &&
              'h-8 min-h-8 touch:min-h-8 pl-3.5 pr-2 text-sm leading-5',
            props.mobile && tier() !== 'standard' && 'pl-2.5'
          )}
        >
          <Show when={tier() !== 'standard'}>
            <SpeedGlyph
              tier={tier()}
              class={
                props.mobile ? 'size-4 text-accent' : 'size-3.5 text-accent'
              }
            />
          </Show>
          <span>{t(`agentControls.tier${tier()}`)}</span>
          <Show when={tier() !== 'standard'}>
            <span class="text-ink-extra-muted">{cost(tier())}</span>
          </Show>
          <CaretDown
            class={
              props.mobile
                ? 'size-3.5 text-ink-extra-muted'
                : 'size-3 text-ink-extra-muted'
            }
          />
        </Dropdown.Trigger>
        <Dropdown.Content
          class={cn(
            'w-[184px] p-1 rounded-[10px] text-xs',
            props.mobile && 'w-60 rounded-[26px] p-1.5 text-base leading-[22px]'
          )}
        >
          <Dropdown.RadioGroup value={selected()?.value}>
            <For each={choices()}>
              {(choice) => (
                <Dropdown.RadioItem
                  value={choice.value}
                  closeOnSelect
                  disabled={state.disabled}
                  class={cn(
                    'h-8 gap-2.5 rounded-md px-2.5 py-0 data-highlighted:bg-active',
                    props.mobile && 'h-11 gap-3 rounded-[20px] px-3.5'
                  )}
                  onSelect={() => {
                    state.onSpeed(choice.value);
                    setOpen(false);
                  }}
                >
                  <SpeedGlyph
                    tier={choice.tier}
                    class={cn(
                      props.mobile ? 'size-[18px]' : 'size-3.5',
                      selected()?.value === choice.value
                        ? 'text-accent'
                        : 'text-ink-muted'
                    )}
                  />
                  <Dropdown.ItemLabel class="flex-1">
                    {t(`agentControls.tier${choice.tier}`)}
                  </Dropdown.ItemLabel>
                  <Show when={choice.tier !== 'standard'}>
                    <span class="text-ink-extra-muted">
                      {cost(choice.tier)}
                    </span>
                  </Show>
                  <span class={props.mobile ? 'size-[18px]' : 'size-3.5'}>
                    <Dropdown.ItemIndicator>
                      <Check class="size-full text-accent" />
                    </Dropdown.ItemIndicator>
                  </span>
                </Dropdown.RadioItem>
              )}
            </For>
          </Dropdown.RadioGroup>
        </Dropdown.Content>
      </Dropdown>
    </Show>
  );
}
