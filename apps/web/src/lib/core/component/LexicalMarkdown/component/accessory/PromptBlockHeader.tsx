import { t } from '@app/lib/i18n';
import { lazy } from '@core/util/lazy';
import TerminalIcon from '@icon/system/regular/terminal.svg';
import { Suspense } from 'solid-js';

const PromptBlockControls = lazy(
  () => import('@app/features/prompt-block/prompt-block-controls')
);

export function PromptBlockLabel() {
  return (
    <div class="flex items-center gap-1.5 px-1.5 text-xs font-sans font-medium text-ink-muted select-none">
      <TerminalIcon class="size-4 shrink-0" />
      <span>{t('promptBlock.label')}</span>
    </div>
  );
}

/** The agent picker and Run button; the header keeps its height while they load. */
export function PromptBlockRun(props: { prompt: () => string }) {
  return (
    <Suspense>
      <PromptBlockControls prompt={props.prompt} />
    </Suspense>
  );
}
