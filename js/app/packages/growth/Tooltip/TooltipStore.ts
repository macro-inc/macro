import { makePersisted } from '@solid-primitives/storage';
import { createStore } from 'solid-js/store';

const [tooltipStore, setTooltipStore] = makePersisted(
  createStore({
    'start-folder-tooltip': false,
    'start-document-tooltip': false,
    'start-code-tooltip': false,
    'start-canvas-tooltip': false,
    'start-email-tooltip': false,
    'chat-attach-tooltip': false,
    'close-split-tooltip': false,
    'start-message-tooltip': false,
  }),
  { name: 'tooltip-store' }
);

export const closeTooltip = (key: keyof typeof tooltipStore) => {
  setTooltipStore(key, true);
};

export default tooltipStore;
