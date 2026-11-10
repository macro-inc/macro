import { t } from '@app/lib/i18n';
import { isMobile } from '@core/mobile/isMobile';
import { fireAndForget } from '@core/util/fireAndForget';
import Speaker from '@icon/system/regular/speaker-high.svg';
import { Dropdown, SingleSelectCheck } from '@ui';
import { For, Show } from 'solid-js';
import { useCallContextOptional } from '../CallContext';
import { createCallAudioOutput } from '../primitives/create-call-audio-output';

/** The native session owns its output; browser media uses the CallContext device picker. */
export function PhoneAudioOutput() {
  return (
    <Show when={isMobile()}>
      <PhoneAudioOutputControl />
    </Show>
  );
}

function PhoneAudioOutputControl() {
  const call = useCallContextOptional();
  const { supported, callId, outputs, selected, select } =
    createCallAudioOutput(call);

  return (
    <Show when={supported() && !!callId() && outputs().length > 0}>
      <Dropdown placement="bottom-end">
        <Dropdown.Trigger
          variant="ghost"
          size="icon-lg"
          class="rounded-full bg-surface-2"
          aria-label={t('calls.audioOutput')}
          tooltip={t('calls.audioOutput')}
        >
          <Speaker class="size-5" />
        </Dropdown.Trigger>
        <Dropdown.Content
          portalScope="local"
          class="min-w-56 max-w-[calc(100vw-2rem)]"
        >
          <Dropdown.Group>
            <Dropdown.GroupLabel>{t('calls.audioOutput')}</Dropdown.GroupLabel>
            <Dropdown.RadioGroup
              value={selected() ?? ''}
              onChange={(id) => fireAndForget(select(id), 'call.audio-output')}
            >
              <For each={outputs()}>
                {(output) => (
                  <Dropdown.RadioItem value={output.id} closeOnSelect>
                    <SingleSelectCheck active={selected() === output.id} />
                    <span class="min-w-0 flex-1 truncate">{output.label}</span>
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
