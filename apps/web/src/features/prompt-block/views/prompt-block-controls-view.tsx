import { MACRO_PERSONA_ID } from '@app/features/agents-view/core/roster';
import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import { MACRO_AGENT_NAME } from '@core/constant/macroAgent';
import { fireAndForget } from '@core/util/fireAndForget';
import { confirmDialog } from '@ui';
import { PromptRunControls } from '../components/prompt-run-controls';
import { RunPromptWarning } from '../components/run-prompt-warning';
import { usePromptBlockContext } from '../context/prompt-block-context';
import { AUTO_AGENT_CHOICE } from '../core/prompt-agents';
import { createPromptRunner } from '../primitives/prompt-runner';

/** Runs a prompt block's text with the chosen agent, after the viewer confirms. */
export function PromptBlockControlsView(props: { prompt: () => string }) {
  const context = usePromptBlockContext();
  const runner = createPromptRunner(context);
  const choiceLabel = () => {
    const choice = runner.choice();
    if (choice === AUTO_AGENT_CHOICE) return t('promptBlock.auto');
    const agent = runner.agents().find((option) => option.id === choice);
    if (agent) return agent.name;
    return choice === MACRO_PERSONA_ID ? MACRO_AGENT_NAME : '';
  };

  const confirmAndRun = async () => {
    // The text confirmed is the text that runs, even if the block changes meanwhile.
    const prompt = props.prompt();
    if (!prompt.trim() || runner.running()) return;
    const confirmed = await confirmDialog({
      title: t('promptBlock.confirmTitle'),
      body: <RunPromptWarning prompt={prompt} />,
      confirmLabel: t('promptBlock.proceed'),
      cancelLabel: t('promptBlock.cancel'),
    });
    if (!confirmed) return;
    if ((await runner.run(prompt)) === 'unavailable')
      toast.failure(t('promptBlock.unavailable'));
  };

  return (
    <PromptRunControls
      agents={runner.agents()}
      choice={runner.choice()}
      choiceLabel={choiceLabel()}
      autoAvailable={context.autoAvailable()}
      running={runner.running()}
      onChoose={runner.choose}
      onRun={() => fireAndForget(confirmAndRun(), 'prompt-block')}
    />
  );
}
