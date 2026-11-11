import { AgentPicker } from '../../agents-view/views/AgentPicker';
import type { InputDisplay } from '../context/capabilities';
import type { UniversalInputController } from '../primitives/universal-input';

/** Use the same agent and model controls as the AI composer. */
export function AiDraft(props: {
  state: UniversalInputController;
  actions: InputDisplay;
}) {
  const s = props.state;
  const a = props.actions;
  const selected = () =>
    a.roster().find((agent) => agent.id === (s.fields().botId || 'macro'));
  return (
    <div class="flex min-w-0 items-center gap-2">
      <AgentPicker
        agents={a.roster()}
        selected={selected()}
        modelOverride={s.fields().model || undefined}
        loading={a.rosterLoading()}
        onSelect={(agent, model) => {
          s.edit('botId', agent.id);
          s.edit('model', model ?? '');
        }}
        onConnect={a.connectAgent}
        onCreate={a.createAgent}
      />
    </div>
  );
}
