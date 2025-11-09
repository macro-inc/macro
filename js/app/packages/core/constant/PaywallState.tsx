import { withAnalytics } from '@coparse/analytics';
import { createSignal } from 'solid-js';

const { track, TrackingEvents } = withAnalytics();

export const DAILY_LIMIT = 5;

export enum PaywallKey {
  PROJECT_LIMIT = 'PROJECT_LIMIT',
  FILE_LIMIT = 'FILE_LIMIT',
  IMAGE_LIMIT = 'IMAGE_LIMIT',
  MODEL_LIMIT = 'MODEL_LIMIT',
  CHAT_LIMIT = 'CHAT_LIMIT',
  O1_LIMIT = 'O1_LIMIT',
  CANVAS_CLIKED = 'CANVAS_CLIKED',
  SAVED_PROMPT = 'SAVED_PROMPT',
}

export const PaywallMessages: Record<PaywallKey, string> = {
  [PaywallKey.PROJECT_LIMIT]:
    'You have reached the project limit of your current plan. Please upgrade to continue.',
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
};

export const [paywallOpen, setPaywallOpen] = createSignal(false);
// export const [paywallOpen, setPaywallOpen] = createControlledOpenSignal(false);
export const [limitReached, setLimitReached] = createSignal(false);
export const [paywallKey, setPaywallKey] = createSignal<PaywallKey | null>(
  null
);

export const usePaywallState = () => {
  const showPaywall = (errorKey?: PaywallKey | null) => {
    if (errorKey) {
      setPaywallKey(errorKey);
    }
    track(TrackingEvents.PAYWALL.SHOW, {
      type: errorKey,
    });
    setPaywallOpen(true);
  };

  const hidePaywall = () => {
    setPaywallOpen(false);
    setPaywallKey(null);
  };
  return { paywallOpen, showPaywall, hidePaywall, limitReached, paywallKey };
};
