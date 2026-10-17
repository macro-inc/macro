import { verifyToken } from './api';
import { clearConfig, getConfig, saveConfig } from './storage';
import type { MacroConfig } from './types';

const elements = {
  form: document.getElementById('config-form') as HTMLFormElement | null,
  apiToken: document.getElementById('api-token') as HTMLInputElement | null,
  baseUrl: document.getElementById('base-url') as HTMLInputElement | null,
  saveBtn: document.getElementById('save-btn') as HTMLButtonElement | null,
  testBtn: document.getElementById('test-btn') as HTMLButtonElement | null,
  clearBtn: document.getElementById('clear-btn') as HTMLButtonElement | null,
  alert: document.getElementById('alert'),
  statusBadge: document.getElementById('status-badge'),
  statusIcon: document.getElementById('status-icon'),
  statusText: document.getElementById('status-text'),
};

function showAlert(message: string, type: 'success' | 'error' | 'info'): void {
  if (!elements.alert) return;

  elements.alert.textContent = message;
  elements.alert.className = `alert alert-${type}`;
  elements.alert.classList.remove('hidden');

  if (type !== 'error') {
    setTimeout(() => {
      elements.alert?.classList.add('hidden');
    }, 5000);
  }
}

function hideAlert(): void {
  elements.alert?.classList.add('hidden');
}

function updateStatus(connected: boolean): void {
  if (!elements.statusBadge || !elements.statusText) return;

  if (connected) {
    elements.statusBadge.className = 'status-badge connected';
    elements.statusText.textContent = 'Connected';
  } else {
    elements.statusBadge.className = 'status-badge disconnected';
    elements.statusText.textContent = 'Not connected';
  }
}

function setButtonLoading(button: HTMLButtonElement | null, loading: boolean, text?: string): void {
  if (!button) return;

  if (loading) {
    button.disabled = true;
    button.innerHTML = `<span class="loading-spinner"></span> ${text || 'Loading...'}`;
  } else {
    button.disabled = false;
    button.textContent = text || button.textContent;
  }
}

async function loadConfig(): Promise<void> {
  const config = await getConfig();

  if (config) {
    if (elements.apiToken) {
      elements.apiToken.value = config.apiToken;
    }
    if (elements.baseUrl) {
      elements.baseUrl.value = config.baseUrl;
    }

    const isValid = await verifyToken(config);
    updateStatus(isValid);

    if (!isValid) {
      showAlert('Your saved token appears to be invalid. Please check your settings.', 'error');
    }
  } else {
    updateStatus(false);
  }
}

async function handleSave(e: Event): Promise<void> {
  e.preventDefault();
  hideAlert();

  const apiToken = elements.apiToken?.value.trim();
  const baseUrl = elements.baseUrl?.value.trim() || 'https://macro.com';

  if (!apiToken) {
    showAlert('Please enter your API token.', 'error');
    return;
  }

  setButtonLoading(elements.saveBtn, true, 'Saving...');

  const config: MacroConfig = { apiToken, baseUrl };

  try {
    const isValid = await verifyToken(config);

    if (!isValid) {
      showAlert('Invalid API token. Please check your token and try again.', 'error');
      updateStatus(false);
      return;
    }

    await saveConfig(config);
    updateStatus(true);
    showAlert('Settings saved successfully!', 'success');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    showAlert(`Failed to save settings: ${message}`, 'error');
    updateStatus(false);
  } finally {
    setButtonLoading(elements.saveBtn, false, 'Save Settings');
  }
}

async function handleTest(): Promise<void> {
  hideAlert();

  const apiToken = elements.apiToken?.value.trim();
  const baseUrl = elements.baseUrl?.value.trim() || 'https://macro.com';

  if (!apiToken) {
    showAlert('Please enter your API token first.', 'error');
    return;
  }

  setButtonLoading(elements.testBtn, true, 'Testing...');

  const config: MacroConfig = { apiToken, baseUrl };

  try {
    const isValid = await verifyToken(config);

    if (isValid) {
      showAlert('Connection successful! Your API token is valid.', 'success');
      updateStatus(true);
    } else {
      showAlert('Connection failed. Please check your API token.', 'error');
      updateStatus(false);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    showAlert(`Connection test failed: ${message}`, 'error');
    updateStatus(false);
  } finally {
    setButtonLoading(elements.testBtn, false, 'Test Connection');
  }
}

async function handleClear(): Promise<void> {
  const confirmed = confirm(
    'Are you sure you want to clear your settings? You will need to re-enter your API token.',
  );

  if (!confirmed) return;

  await clearConfig();

  if (elements.apiToken) {
    elements.apiToken.value = '';
  }
  if (elements.baseUrl) {
    elements.baseUrl.value = 'https://macro.com';
  }

  updateStatus(false);
  showAlert('Settings cleared.', 'info');
}

function init(): void {
  elements.form?.addEventListener('submit', (e) => void handleSave(e));
  elements.testBtn?.addEventListener('click', () => void handleTest());
  elements.clearBtn?.addEventListener('click', () => void handleClear());

  void loadConfig();
}

init();
