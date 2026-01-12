import { parseEmailContent, type ParsedEmailContent } from './parse-email-html';
import {
  processEmailColors,
  type ThemeColorParams,
} from './transform-email-colors';

export interface EmailRenderOptions {
  theme: ThemeColorParams;
  isPersonal: boolean;
  removeSignature?: boolean;
  removeTrailingBrs?: boolean;
  hasTable?: boolean;
}

export interface EmailRenderResult {
  container: HTMLElement;
  shadowRoot: ShadowRoot;
  parsedContent: ParsedEmailContent;
}

/**
 * Renders email HTML body content into an isolated Shadow DOM container.
 *
 * This function encapsulates:
 * - Shadow DOM creation for CSS isolation
 * - HTML parsing via parseEmailContent()
 * - Color processing for personal emails (theme-aware contrast adjustment)
 * - Table handling (white background fallback for non-personal table emails)
 *
 * @param html - The sanitized HTML body content
 * @param options - Rendering options including theme colors and display preferences
 * @returns The Shadow DOM host container and parsed content metadata
 */
export function renderEmailBody(
  html: string,
  options: EmailRenderOptions
): EmailRenderResult {
  const {
    theme,
    isPersonal,
    removeSignature = true,
    removeTrailingBrs = true,
  } = options;

  // Parse the email content
  const parsedContent = parseEmailContent(
    html,
    removeSignature,
    removeTrailingBrs
  );

  // Create Shadow DOM container
  const hostContainer = document.createElement('div');
  const shadow = hostContainer.attachShadow({ mode: 'open' });

  // Style that uses a CSS variable to control image visibility
  const styleEl = document.createElement('style');
  styleEl.textContent = `img{display: var(--macro-email-img-display, initial);}`;
  shadow.appendChild(styleEl);

  // Create content wrapper
  const messageDiv = document.createElement('div');
  messageDiv.innerHTML = parsedContent.mainContent;
  messageDiv.style.userSelect = 'text';
  messageDiv.style.cursor = 'var(--cursor-auto)';
  messageDiv.style.overflow = 'auto';
  shadow.appendChild(messageDiv);

  // Process colors based on email type
  if (isPersonal) {
    // For personal emails, adjust colors to match theme
    processEmailColors(shadow, theme);
  } else if (parsedContent.hasTable) {
    // For non-personal table emails (newsletters), use white background
    messageDiv.style.setProperty('background-color', 'white', 'important');
    messageDiv.style.setProperty('color', 'black');
  }

  return {
    container: hostContainer,
    shadowRoot: shadow,
    parsedContent,
  };
}

/**
 * Updates the image display state of a rendered email container.
 * Used to show/hide images based on email expansion state.
 *
 * @param container - The Shadow DOM host container from renderEmailBody
 * @param hideImages - Whether images should be hidden
 */
export function setEmailImageVisibility(
  container: HTMLElement,
  hideImages: boolean
): void {
  container.style.setProperty(
    '--macro-email-img-display',
    hideImages ? 'none' : 'initial'
  );
}
