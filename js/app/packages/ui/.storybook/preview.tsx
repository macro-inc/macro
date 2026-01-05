import * as React from 'react';
import { withThemeByClassName } from '@storybook/addon-themes';

import '../../app/index.css';
import './preview.css';
import type { Preview } from 'storybook-solidjs-vite';
import {
  DocsContainer,
  type DocsContainerProps,
} from '@storybook/addon-docs/blocks';
import type { Renderer } from 'storybook/internal/types';

// Theme class mapping - matches CSS classes in preview.css
const THEME_CLASSES = {
  'Macro Dark': 'theme-macro-dark',
  'Macro Light': 'theme-macro-light',
  Bleach: 'theme-bleach',
  Sleepless: 'theme-sleepless',
  Briar: 'theme-briar',
  Flare: 'theme-flare',
  Spell: 'theme-spell',
} as const;

type ThemeName = keyof typeof THEME_CLASSES;

interface ThemedDocsContainerProps extends DocsContainerProps<Renderer> {
  children: React.ReactNode;
}

// Custom DocsContainer that applies the current theme class to the html element
// We use useEffect instead of wrapping children because SolidJS Storybook
// passes DOM elements as children, not React elements
const ThemedDocsContainer = ({
  children,
  context,
  ...props
}: ThemedDocsContainerProps) => {
  // Get the current theme from the globals
  // Access through the internal store API (not typed but available at runtime)
  const contextAny = context as unknown as {
    store?: { globals?: { globals?: { theme?: string } } };
  };
  const selectedTheme =
    (contextAny.store?.globals?.globals?.theme as ThemeName) || 'Macro Dark';
  const themeClass =
    THEME_CLASSES[selectedTheme] || THEME_CLASSES['Macro Dark'];

  React.useEffect(() => {
    // Apply theme class to html element for docs pages
    const html = document.documentElement;
    // Remove all theme classes first
    Object.values(THEME_CLASSES).forEach((cls) => html.classList.remove(cls));
    // Add the current theme class
    html.classList.add(themeClass);

    return () => {
      // Cleanup when unmounting
      html.classList.remove(themeClass);
    };
  }, [themeClass]);

  return (
    <DocsContainer context={context} {...props}>
      {children}
    </DocsContainer>
  );
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
      container: ThemedDocsContainer,
    },
  },
  tags: ['autodocs'],
  decorators: [
    withThemeByClassName({
      themes: THEME_CLASSES,
      defaultTheme: 'Macro Dark',
    }),
  ],
};

export default preview;
