import { EMAIL_COMPOSE_TO_INPUT_ID } from '@app/features/email-compose/core/constants';
import { triggerFocusInput } from '@core/directive/focusInput';

const toInputs = () =>
  document.querySelectorAll<HTMLElement>(`[id="${EMAIL_COMPOSE_TO_INPUT_ID}"]`);

/**
 * Focus the To field of the composer about to open, within this gesture so
 * the iOS keyboard opens. Every composer's To field shares one id, so a
 * composer already open is skipped: focusing it would leave the new one
 * unfocused once closing the details hands focus back to the calendar chip.
 */
export function focusNewComposerTo() {
  const open = new Set(toInputs());
  triggerFocusInput(() => [...toInputs()].find((input) => !open.has(input)));
}
