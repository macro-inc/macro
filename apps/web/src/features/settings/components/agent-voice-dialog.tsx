import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import { fireAndForget } from '@core/util/fireAndForget';
import { thrownResultErrorHasCode } from '@core/util/result';
import SpinnerIcon from '@icon/system/regular/spinner.svg';
import XIcon from '@icon/system/regular/x.svg';
import {
  useAgentVoiceQuery,
  useSetAgentVoiceMutation,
} from '@queries/team-agents/voices';
import type { TeamAgent } from '@service-auth/team-agents';
import { Button, Dialog, Panel } from '@ui';
import { createSignal, onCleanup, Show } from 'solid-js';
import { useVoicePickerSource, VoicePicker } from './voice-picker';

function AgentVoiceSettings(props: {
  teamId: string;
  agent: TeamAgent;
  onClose: () => void;
}) {
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });
  const source = useVoicePickerSource(() => props.teamId);
  const current = useAgentVoiceQuery(
    () => props.teamId,
    () => props.agent.userId
  );
  const save = useSetAgentVoiceMutation();
  // A failed save keeps the admin's pick for the retry.
  const [chosen, setChosen] = createSignal<string>();
  const saved = () => (current.isSuccess ? current.data?.model : undefined);
  const value = () => chosen() ?? saved();
  const canSave = () =>
    !!value() && value() !== saved() && current.isSuccess && !save.isPending;

  const close = () => {
    if (!save.isPending) props.onClose();
  };

  const submit = () => {
    const model = value();
    if (!model || !canSave()) return;
    const name = props.agent.name;
    save.mutate(
      { teamId: props.teamId, userId: props.agent.userId, model },
      {
        onSuccess: () => {
          toast.success(t('teamAgents.voiceSaved', { name }));
          if (!disposed) props.onClose();
        },
      }
    );
  };

  const saveError = () =>
    thrownResultErrorHasCode(save.error, 'INVALID_VOICE')
      ? t('teamAgents.voiceInvalid')
      : t('teamAgents.voiceSaveFailed');

  return (
    <Dialog open onOpenChange={(open) => !open && close()} class="w-120">
      <Panel depth={2} class="max-h-[75vh] text-ink rounded-xl">
        <Panel.Header class="px-3 gap-2">
          <Dialog.CloseButton
            as={Button}
            variant="ghost"
            size="icon-sm"
            aria-label={t('common.close')}
          >
            <XIcon class="size-4 touch:size-6 shrink-0 pointer-events-none" />
          </Dialog.CloseButton>
          <Dialog.Title
            as="span"
            class="text-base font-medium p-0 m-0 truncate"
          >
            {t('teamAgents.voiceTitle', { name: props.agent.name })}
          </Dialog.Title>
        </Panel.Header>
        <Panel.Body>
          <div class="flex flex-col gap-4 px-5 py-5">
            <p class="text-sm text-ink-muted">
              {t('teamAgents.voiceNextCall')}
            </p>
            <Show when={current.isError}>
              <div
                role="alert"
                class="flex flex-wrap items-center gap-2 text-sm text-ink-muted"
              >
                <span>{t('teamAgents.voiceLoadFailed')}</span>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    fireAndForget(current.refetch(), 'team-agent.voice.retry')
                  }
                >
                  {t('teamAgents.tryAgain')}
                </Button>
              </div>
            </Show>
            <VoicePicker
              source={source}
              value={value()}
              onChange={setChosen}
              disabled={save.isPending || !current.isSuccess}
            />
            <Show when={save.isError}>
              <p role="alert" class="text-sm text-failure">
                {saveError()}
              </p>
            </Show>
          </div>
        </Panel.Body>
        <Panel.Footer class="justify-end gap-2 px-4 py-3">
          <Button
            type="button"
            variant="ghost"
            disabled={save.isPending}
            onClick={close}
          >
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={!canSave()}
            onClick={submit}
          >
            <Show when={save.isPending} fallback={t('teamAgents.saveVoice')}>
              <SpinnerIcon class="size-4 animate-spin" />
              <span class="sr-only">{t('teamAgents.savingVoice')}</span>
            </Show>
          </Button>
        </Panel.Footer>
      </Panel>
    </Dialog>
  );
}

/** An admin's Change voice dialog for one agent teammate; closed without one. */
export function AgentVoiceDialog(props: {
  teamId: string;
  agent: TeamAgent | undefined;
  onClose: () => void;
}) {
  return (
    <Show keyed when={props.agent}>
      {(agent) => (
        <AgentVoiceSettings
          teamId={props.teamId}
          agent={agent}
          onClose={props.onClose}
        />
      )}
    </Show>
  );
}
