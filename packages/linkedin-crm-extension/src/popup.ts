import type { LinkedInProfile, MessageResponse, MessageType } from './types';

const elements = {
  loading: document.getElementById('loading'),
  connected: document.getElementById('connected'),
  disconnected: document.getElementById('disconnected'),
  profileSection: document.getElementById('profile-section'),
  profileCard: document.getElementById('profile-card'),
  noProfile: document.getElementById('no-profile'),
  profileName: document.getElementById('profile-name'),
  profileTitle: document.getElementById('profile-title'),
  profileCompany: document.getElementById('profile-company'),
  profileLocation: document.getElementById('profile-location'),
  addBtn: document.getElementById('add-btn') as HTMLButtonElement | null,
  settingsBtn: document.getElementById('settings-btn') as HTMLButtonElement | null,
};

function show(element: HTMLElement | null): void {
  element?.classList.remove('hidden');
}

function hide(element: HTMLElement | null): void {
  element?.classList.add('hidden');
}

function setText(element: HTMLElement | null, text: string): void {
  if (element) {
    element.textContent = text;
  }
}

async function checkAuth(): Promise<boolean> {
  try {
    const response = await chrome.runtime.sendMessage<MessageType, MessageResponse>({
      type: 'CHECK_AUTH',
    });
    return response.success;
  } catch {
    return false;
  }
}

async function getProfileFromTab(): Promise<LinkedInProfile | null> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url?.includes('linkedin.com')) {
      return null;
    }

    const response = await chrome.tabs.sendMessage<
      MessageType,
      MessageResponse<LinkedInProfile | null>
    >(tab.id, { type: 'GET_PROFILE_DATA' });

    return response.data || null;
  } catch {
    return null;
  }
}

function displayProfile(profile: LinkedInProfile): void {
  show(elements.profileCard);
  hide(elements.noProfile);
  show(elements.addBtn);

  setText(elements.profileName, profile.name);
  setText(elements.profileTitle, profile.title || profile.headline || '');
  setText(elements.profileCompany, profile.company || '');
  setText(elements.profileLocation, profile.location || '');

  if (!elements.profileTitle?.textContent) {
    hide(elements.profileTitle as HTMLElement);
  }
  if (!elements.profileCompany?.textContent) {
    hide(elements.profileCompany as HTMLElement);
  }
  if (!elements.profileLocation?.textContent) {
    hide(elements.profileLocation as HTMLElement);
  }
}

function displayNoProfile(): void {
  hide(elements.profileCard);
  show(elements.noProfile);
  hide(elements.addBtn);
}

async function addToCrm(profile: LinkedInProfile): Promise<void> {
  if (!elements.addBtn) return;

  elements.addBtn.disabled = true;
  elements.addBtn.innerHTML = '<span class="loading-spinner"></span> Adding...';

  try {
    const response = await chrome.runtime.sendMessage<MessageType, MessageResponse>({
      type: 'ADD_TO_CRM',
      profile,
    });

    if (response.success) {
      elements.addBtn.innerHTML = '✓ Added to CRM';
      elements.addBtn.style.background = 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)';
    } else {
      elements.addBtn.innerHTML = response.error || 'Error';
      elements.addBtn.style.background = 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)';
      setTimeout(() => {
        if (elements.addBtn) {
          elements.addBtn.innerHTML = 'Add to Macro CRM';
          elements.addBtn.style.background = '';
          elements.addBtn.disabled = false;
        }
      }, 3000);
    }
  } catch {
    elements.addBtn.innerHTML = 'Error';
    elements.addBtn.style.background = 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)';
    setTimeout(() => {
      if (elements.addBtn) {
        elements.addBtn.innerHTML = 'Add to Macro CRM';
        elements.addBtn.style.background = '';
        elements.addBtn.disabled = false;
      }
    }, 3000);
  }
}

async function init(): Promise<void> {
  const isAuthenticated = await checkAuth();

  hide(elements.loading);

  if (isAuthenticated) {
    show(elements.connected);
    show(elements.profileSection);

    const profile = await getProfileFromTab();
    if (profile) {
      displayProfile(profile);

      elements.addBtn?.addEventListener('click', () => {
        void addToCrm(profile);
      });
    } else {
      displayNoProfile();
    }
  } else {
    show(elements.disconnected);
  }

  elements.settingsBtn?.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
}

init();
