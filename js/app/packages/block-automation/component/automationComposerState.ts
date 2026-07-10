import { createControlledOpenSignal } from '@core/util/createControlledOpenSignal';

// Kept separate from the composer UI so launcher/layout code can toggle the
// modal without loading its editor stack.
export const [automationComposerOpen, setAutomationComposerOpen] =
  createControlledOpenSignal(false, { id: 'automation-composer' });
