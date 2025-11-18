import '../packages/app/index.css';
import type { Preview } from 'storybook-solidjs-vite';

// Set up focus-visible modality tracking
if (typeof document !== 'undefined') {
  document.addEventListener('keydown', () => {
    document.documentElement.dataset.modality = 'keyboard';
  });

  document.addEventListener('mousedown', () => {
    document.documentElement.dataset.modality = 'mouse';
  });
}

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    layout: 'centered',
    docs: {
      codePanel: true,
    },
  },
};

export default preview;
