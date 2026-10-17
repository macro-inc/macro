import { isProfilePage, parseProfile } from './linkedin-parser';
import type { LinkedInProfile, MessageResponse, MessageType } from './types';

const BUTTON_ID = 'macro-crm-add-button';
const BUTTON_CONTAINER_ID = 'macro-crm-button-container';

function createButton(): HTMLButtonElement {
  const button = document.createElement('button');
  button.id = BUTTON_ID;
  button.className = 'macro-crm-button';
  button.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M12 5v14M5 12h14"/>
    </svg>
    <span>Add to Macro CRM</span>
  `;
  return button;
}

function createButtonContainer(): HTMLDivElement {
  const container = document.createElement('div');
  container.id = BUTTON_CONTAINER_ID;
  container.className = 'macro-crm-button-container';
  return container;
}

function setButtonState(
  button: HTMLButtonElement,
  state: 'idle' | 'loading' | 'success' | 'error',
  message?: string,
): void {
  button.classList.remove(
    'macro-crm-button--loading',
    'macro-crm-button--success',
    'macro-crm-button--error',
  );

  const textSpan = button.querySelector('span');

  switch (state) {
    case 'loading':
      button.classList.add('macro-crm-button--loading');
      button.disabled = true;
      if (textSpan) textSpan.textContent = message || 'Adding...';
      break;
    case 'success':
      button.classList.add('macro-crm-button--success');
      button.disabled = false;
      if (textSpan) textSpan.textContent = message || 'Added to CRM';
      break;
    case 'error':
      button.classList.add('macro-crm-button--error');
      button.disabled = false;
      if (textSpan) textSpan.textContent = message || 'Error';
      break;
    default:
      button.disabled = false;
      if (textSpan) textSpan.textContent = 'Add to Macro CRM';
  }
}

async function handleAddToCrm(button: HTMLButtonElement, profile: LinkedInProfile): Promise<void> {
  setButtonState(button, 'loading');

  try {
    const response = await chrome.runtime.sendMessage<MessageType, MessageResponse>({
      type: 'ADD_TO_CRM',
      profile,
    });

    if (response.success) {
      setButtonState(button, 'success', 'Added to CRM');
      setTimeout(() => setButtonState(button, 'idle'), 3000);
    } else {
      setButtonState(button, 'error', response.error || 'Failed to add');
      setTimeout(() => setButtonState(button, 'idle'), 5000);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    setButtonState(button, 'error', message);
    setTimeout(() => setButtonState(button, 'idle'), 5000);
  }
}

function findActionBar(): Element | null {
  const actionBarSelectors = [
    '.pv-top-card-v2-ctas',
    '.pv-top-card__actions',
    '.pvs-profile-actions',
    '[data-view-name="profile-card"]',
    '.profile-topcard-actions',
  ];

  for (const selector of actionBarSelectors) {
    const element = document.querySelector(selector);
    if (element) return element;
  }

  return null;
}

function injectButton(): void {
  if (document.getElementById(BUTTON_CONTAINER_ID)) {
    return;
  }

  const profile = parseProfile();
  if (!profile) {
    return;
  }

  const actionBar = findActionBar();
  if (!actionBar) {
    return;
  }

  const container = createButtonContainer();
  const button = createButton();

  button.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();

    const currentProfile = parseProfile();
    if (currentProfile) {
      void handleAddToCrm(button, currentProfile);
    }
  });

  container.appendChild(button);

  actionBar.insertAdjacentElement('afterend', container);
}

function removeButton(): void {
  const container = document.getElementById(BUTTON_CONTAINER_ID);
  if (container) {
    container.remove();
  }
}

function handleNavigation(): void {
  removeButton();

  if (isProfilePage()) {
    setTimeout(injectButton, 1000);
  }
}

function observeUrlChanges(): void {
  let lastUrl = location.href;

  const observer = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      handleNavigation();
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
}

function init(): void {
  if (isProfilePage()) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        setTimeout(injectButton, 1500);
      });
    } else {
      setTimeout(injectButton, 1500);
    }
  }

  observeUrlChanges();
}

chrome.runtime.onMessage.addListener(
  (
    message: MessageType,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: MessageResponse<LinkedInProfile | null>) => void,
  ) => {
    if (message.type === 'GET_PROFILE_DATA') {
      const profile = parseProfile();
      sendResponse({ success: true, data: profile });
    }
    return true;
  },
);

init();
