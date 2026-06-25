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
  TEAMS = 'TEAMS',
}

export type PaywallMessageMetadata = {
  title: string;
  description: string;
  learnMoreUrl?: string;
  learnMoreSubject?: string;
};

export const PaywallMessages: Record<PaywallKey, PaywallMessageMetadata> = {
  [PaywallKey.PROJECT_LIMIT]: {
    title: 'Folder limit reached',
    description:
      'Upgrade to create more folders and keep organizing your workspace.',
    learnMoreUrl: 'https://docs.macro.com/product/folders',
    learnMoreSubject: 'folders',
  },
  [PaywallKey.FILE_LIMIT]: {
    title: 'File limit reached',
    description: 'Upgrade for more storage and room for all of your documents.',
  },
  [PaywallKey.CHAT_LIMIT]: {
    title: 'Chat limit reached',
    description: 'Upgrade to keep creating agent chats with premium AI access.',
    learnMoreUrl: 'https://docs.macro.com/product/agents',
    learnMoreSubject: 'agents',
  },
  [PaywallKey.IMAGE_LIMIT]: {
    title: 'Image processing limit reached',
    description: `You’ve used ${DAILY_LIMIT} AI image processing requests today. Upgrade for higher limits.`,
    learnMoreUrl: 'https://docs.macro.com/product/agents',
    learnMoreSubject: 'agents',
  },
  [PaywallKey.MODEL_LIMIT]: {
    title: 'Smart model limit reached',
    description: `You’ve used ${DAILY_LIMIT} smart model requests today. Upgrade for access to all models.`,
    learnMoreUrl: 'https://docs.macro.com/product/agents',
    learnMoreSubject: 'agents',
  },
  [PaywallKey.O1_LIMIT]: {
    title: 'Smart models are premium',
    description: 'Upgrade to use Macro’s most capable AI models.',
    learnMoreUrl: 'https://docs.macro.com/product/agents',
    learnMoreSubject: 'agents',
  },
  [PaywallKey.CANVAS_CLIKED]: {
    title: 'AI canvases are premium',
    description:
      'Upgrade to generate diagrams, whiteboards, and visual drafts with AI.',
    learnMoreUrl: 'https://docs.macro.com/product/canvas',
    learnMoreSubject: 'canvases',
  },
  [PaywallKey.SAVED_PROMPT]: {
    title: 'Saved prompts are premium',
    description: 'Upgrade to save reusable prompts for faster workflows.',
    learnMoreUrl: 'https://docs.macro.com/product/snippets',
    learnMoreSubject: 'saved prompts',
  },
  [PaywallKey.REMOVE_SIGNATURE]: {
    title: 'Remove the Macro signature',
    description: 'Upgrade to send emails without the Macro signature.',
    learnMoreUrl: 'https://docs.macro.com/product/email',
    learnMoreSubject: 'email',
  },
  [PaywallKey.MULTI_INBOX]: {
    title: 'Connect more inboxes',
    description: 'Upgrade to manage multiple email inboxes from one workspace.',
    learnMoreUrl: 'https://docs.macro.com/product/inbox',
    learnMoreSubject: 'multiple inboxes',
  },
  [PaywallKey.TEAMS]: {
    title: 'Collaborate with your team',
    description:
      'Upgrade to create a team, invite members, and manage access together.',
    learnMoreUrl: 'https://docs.macro.com/account/teams',
    learnMoreSubject: 'teams',
  },
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
