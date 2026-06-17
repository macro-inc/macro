import { createSignal } from 'solid-js';

const DAILY_LIMIT = 5;

export enum PaywallKey {
  PROJECT_LIMIT = 'PROJECT_LIMIT',
  FILE_LIMIT = 'FILE_LIMIT',
  IMAGE_LIMIT = 'IMAGE_LIMIT',
  MODEL_LIMIT = 'MODEL_LIMIT',
  CHAT_LIMIT = 'CHAT_LIMIT',
  O1_LIMIT = 'O1_LIMIT',
  CANVAS_CLIKED = 'CANVAS_CLIKED',
  SAVED_PROMPT = 'SAVED_PROMPT',
  REMOVE_SIGNATURE = 'REMOVE_SIGNATURE',
  MULTI_INBOX = 'MULTI_INBOX',
}

export const PaywallMessages: Record<PaywallKey, string> = {
  [PaywallKey.PROJECT_LIMIT]:
    'You have reached the folder limit of your current plan. Please upgrade to continue.',
  [PaywallKey.FILE_LIMIT]:
    'You have reached the file limit of your current plan. Please upgrade to continue.',
  [PaywallKey.CHAT_LIMIT]:
    'You have reached the chat limit of your current plan. Please upgrade to continue.',
  [PaywallKey.IMAGE_LIMIT]: `You've reached your ${DAILY_LIMIT} daily limit for AI image processing. Please upgrade to continue.`,
  [PaywallKey.MODEL_LIMIT]: `You have reached the ${DAILY_LIMIT} daily uses of smart models. Please upgrade to continue.`,
  [PaywallKey.O1_LIMIT]: 'Upgrade your plan to use smart models.',
  [PaywallKey.CANVAS_CLIKED]:
    'Upgrade your plan to have AI generate canvases (diagrams, whiteboards, drawings).',
  [PaywallKey.SAVED_PROMPT]:
    'Saved prompts are a paid feature. Please upgrade to continue.',
  [PaywallKey.REMOVE_SIGNATURE]:
    'Upgrade your plan to remove the Macro signature.',
  [PaywallKey.MULTI_INBOX]: 'Upgrade your plan to connect more than one inbox.',
};

const [paywallOpen, setPaywallOpen] = createSignal(false);
// export const [paywallOpen, setPaywallOpen] = createControlledOpenSignal(false);
const [limitReached, _setLimitReached] = createSignal(false);
const [paywallKey, setPaywallKey] = createSignal<PaywallKey | null>(null);

export const usePaywallState = () => {
  const showPaywall = (errorKey?: PaywallKey | null) => {
    if (errorKey) {
      setPaywallKey(errorKey);
    }
    setPaywallOpen(true);
  };

  const hidePaywall = () => {
    setPaywallOpen(false);
    setPaywallKey(null);
  };
  return { paywallOpen, showPaywall, hidePaywall, limitReached, paywallKey };
};
