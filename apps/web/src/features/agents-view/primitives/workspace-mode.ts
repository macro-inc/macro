import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableComposerAutoMode } from '@core/constant/featureFlags';
import { createSignal } from 'solid-js';
import type { ComposerMode } from '../core/mode';

/**
 * Whether the new-conversation composer picks the agent kind per prompt
 * (Auto), or always starts chat agents (Chat) or coding agents (Code).
 * Every composer opens in Auto; a Chat or Code choice lasts only while it is
 * mounted. Auto reads as Chat for anyone without {@link enableComposerAutoMode}.
 */
export function createWorkspaceMode() {
  const autoFlag = useFeatureFlag(enableComposerAutoMode);
  const autoAvailable = () => autoFlag().enabled;
  const [stored, setMode] = createSignal<ComposerMode>('auto');
  const mode = (): ComposerMode => {
    const value = stored();
    return value === 'auto' && !autoAvailable() ? 'chat' : value;
  };
  return { mode, setMode, autoAvailable };
}
