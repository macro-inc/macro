import { Button } from '@ui';
import { createSignal, Show } from 'solid-js';
import type { VoicePickerSource } from '../core/voices';
import { AgentFormSurface } from './invite-agent-form';
import { VoicePicker } from './voice-picker';

export function AgentVoiceForm(props: {
  name: string;
  source: VoicePickerSource;
  current: string | undefined;
  loading: boolean;
  loadError: boolean;
  saving: boolean;
  saveError: boolean;
  onRetry(): void;
  onSave(model: string): void;
  onClose(): void;
}) {
  const [chosen, setChosen] = createSignal<string>();
  const value = () => chosen() ?? props.current;
  return (
    <AgentFormSurface
      open
      title={`Voice for ${props.name}`}
      closeLabel="Close voice settings"
      close={() => !props.saving && props.onClose()}
      actions={
        <>
          <Button
            variant="ghost"
            disabled={props.saving}
            onClick={props.onClose}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={
              !value() || props.saving || props.loading || props.loadError
            }
            onClick={() => {
              const model = value();
              if (model) props.onSave(model);
            }}
          >
            {props.saving ? 'Saving…' : 'Save voice'}
          </Button>
        </>
      }
    >
      <div class="space-y-4">
        <p class="text-sm text-ink-muted">
          The new voice will be used on the next call.
        </p>
        <Show when={props.loadError}>
          <p role="alert" class="text-sm text-failure">
            Couldn't load the current voice.{' '}
            <Button variant="link" onClick={props.onRetry}>
              Try again
            </Button>
          </p>
        </Show>
        <VoicePicker
          source={props.source}
          value={value()}
          onChange={setChosen}
          disabled={props.saving}
        />
        <Show when={props.saveError}>
          <p role="alert" class="text-sm text-failure">
            Couldn't save the voice. Your choice is still selected; try again.
          </p>
        </Show>
      </div>
    </AgentFormSurface>
  );
}
