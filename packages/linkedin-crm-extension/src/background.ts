import {
  createCompany,
  createContact,
  getCompanyByDomain,
  getContactByEmail,
  verifyToken,
} from './api';
import { getConfig, isAuthenticated } from './storage';
import type { LinkedInProfile, MessageResponse, MessageType } from './types';

function extractDomainFromCompany(company: string): string | null {
  const cleaned = company
    .toLowerCase()
    .replace(/,?\s*(inc\.?|llc\.?|ltd\.?|corp\.?|co\.?)$/i, '')
    .trim();

  const domainSafe = cleaned.replace(/[^a-z0-9]/g, '');

  if (domainSafe.length < 2) {
    return null;
  }

  return `${domainSafe}.com`;
}

function generateEmail(name: string, domain: string): string {
  const nameParts = name.toLowerCase().split(/\s+/);
  const firstName = nameParts[0] || 'contact';
  const lastName = nameParts[nameParts.length - 1];

  if (lastName && lastName !== firstName) {
    return `${firstName}.${lastName}@${domain}`;
  }

  return `${firstName}@${domain}`;
}

async function addProfileToCrm(
  profile: LinkedInProfile,
): Promise<{ success: boolean; message: string }> {
  const config = await getConfig();
  if (!config) {
    return {
      success: false,
      message: 'Not configured. Please set up your Macro API token.',
    };
  }

  if (!profile.company) {
    return {
      success: false,
      message: 'Could not extract company from profile',
    };
  }

  const domain = extractDomainFromCompany(profile.company);
  if (!domain) {
    return {
      success: false,
      message: 'Could not determine company domain',
    };
  }

  const email = generateEmail(profile.name, domain);

  try {
    const existingContact = await getContactByEmail(config, email);
    if (existingContact) {
      return {
        success: true,
        message: `${profile.name} already exists in CRM`,
      };
    }

    let company = await getCompanyByDomain(config, domain);

    if (!company) {
      try {
        company = await createCompany(config, profile.company, domain);
      } catch (error) {
        if (error instanceof Error && error.message.includes('409')) {
          company = await getCompanyByDomain(config, domain);
        } else {
          throw error;
        }
      }
    }

    if (!company) {
      return {
        success: false,
        message: 'Failed to find or create company',
      };
    }

    await createContact(config, company.id, profile.name, email);

    return {
      success: true,
      message: `Added ${profile.name} to ${company.name}`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Macro CRM] Error adding to CRM:', error);
    return {
      success: false,
      message,
    };
  }
}

chrome.runtime.onMessage.addListener(
  (
    message: MessageType,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: MessageResponse) => void,
  ) => {
    (async () => {
      switch (message.type) {
        case 'ADD_TO_CRM': {
          const result = await addProfileToCrm(message.profile);
          sendResponse({
            success: result.success,
            data: result.message,
            error: result.success ? undefined : result.message,
          });
          break;
        }
        case 'CHECK_AUTH': {
          const authenticated = await isAuthenticated();
          if (authenticated) {
            const config = await getConfig();
            if (config) {
              const valid = await verifyToken(config);
              sendResponse({ success: valid });
            } else {
              sendResponse({ success: false });
            }
          } else {
            sendResponse({ success: false });
          }
          break;
        }
        case 'OPEN_OPTIONS': {
          chrome.runtime.openOptionsPage();
          sendResponse({ success: true });
          break;
        }
        default:
          sendResponse({ success: false, error: 'Unknown message type' });
      }
    })();
    return true;
  },
);

chrome.action.onClicked.addListener(async (tab) => {
  const authenticated = await isAuthenticated();
  if (!authenticated) {
    chrome.runtime.openOptionsPage();
    return;
  }

  if (tab.id && tab.url?.includes('linkedin.com')) {
    chrome.tabs.sendMessage(tab.id, { type: 'GET_PROFILE_DATA' });
  }
});
