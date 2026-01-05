import * as React from 'react';

import '../../app/index.css';
import './preview.css';
import type { Preview } from 'storybook-solidjs-vite';
import { DocsContainer } from '@storybook/addon-docs/blocks';

const CustomDocsContainer = ({ children, ...props }) => {
  return <DocsContainer {...props} context={props.context!}>{children}</DocsContainer>;
};

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
      container: CustomDocsContainer
    },
  },
  tags: ['autodocs']
};

export default preview;
