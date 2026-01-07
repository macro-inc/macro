import '../../app/index.css';
import './preview.css';

import {
  DocsContainer,
  type DocsContainerProps,
} from '@storybook/addon-docs/blocks';
import { withThemeByClassName } from '@storybook/addon-themes';
import * as React from 'react';
import type { Renderer } from 'storybook/internal/types';
import type { Preview } from 'storybook-solidjs-vite';
import {
  generateAllThemesCSS,
  generateThemeClassMapping,
} from './generateThemeCSS';

// Theme class mapping - auto-generated from DEFAULT_THEMES
const THEME_CLASSES = generateThemeClassMapping();

type ThemeName = keyof typeof THEME_CLASSES;

// Inject generated theme CSS into the document
const injectThemeCSS = () => {
  const styleId = 'storybook-theme-css';
  if (!document.getElementById(styleId)) {
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = generateAllThemesCSS();
    document.head.appendChild(style);
  }
};

// Inject theme CSS on module load
injectThemeCSS();

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
    // Ensure theme CSS is injected (for docs pages loaded separately)
    injectThemeCSS();

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
    // biome-ignore lint: noSolidDestructuredProps: This is a React component (Storybook docs), not SolidJS
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
  argTypes: {
    class: {
      control: { type: 'text' },
      defaultValue: '',
      description: 'Any overriding tailwind classes',
    },
  },
};

export default preview;
