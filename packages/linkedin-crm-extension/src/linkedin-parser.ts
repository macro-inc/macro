import type { LinkedInProfile } from './types';

function extractCompanyFromExperience(): string | undefined {
  const experienceSection = document.querySelector('#experience');
  if (!experienceSection) {
    const expCard = document.querySelector('[data-field="experience_company_logo"]');
    if (expCard) {
      const companyEl = expCard.querySelector('.hoverable-link-text, span[aria-hidden="true"]');
      return companyEl?.textContent?.trim();
    }
    return undefined;
  }

  const firstExperience = experienceSection.closest('section')?.querySelector('li');
  if (!firstExperience) return undefined;

  const companyNameEl = firstExperience.querySelector('.t-14.t-normal span[aria-hidden="true"]');
  if (companyNameEl) {
    const fullText = companyNameEl.textContent?.trim();
    if (fullText) {
      const parts = fullText.split('·');
      return parts[0]?.trim();
    }
  }

  return undefined;
}

function extractTitleFromExperience(): string | undefined {
  const experienceSection = document.querySelector('#experience');
  if (!experienceSection) {
    const profileCard = document.querySelector('.pv-text-details__left-panel');
    const headline = profileCard?.querySelector('.text-body-medium')?.textContent;
    if (headline) {
      const atIndex = headline.indexOf(' at ');
      if (atIndex > 0) {
        return headline.substring(0, atIndex).trim();
      }
      return headline.split('|')[0]?.trim();
    }
    return undefined;
  }

  const firstExperience = experienceSection.closest('section')?.querySelector('li');
  if (!firstExperience) return undefined;

  const titleEl = firstExperience.querySelector('.t-bold span[aria-hidden="true"]');
  return titleEl?.textContent?.trim();
}

function extractHeadline(): string | undefined {
  const headlineEl = document.querySelector('.text-body-medium.break-words');
  return headlineEl?.textContent?.trim();
}

function extractLocation(): string | undefined {
  const locationEl = document.querySelector('.text-body-small.inline.t-black--light.break-words');
  return locationEl?.textContent?.trim();
}

function extractConnectionDegree(): string | undefined {
  const degreeEl = document.querySelector('.dist-value');
  if (degreeEl) {
    return degreeEl.textContent?.trim();
  }

  const profileBadge = document.querySelector('.pv-top-card--list .text-body-small');
  const text = profileBadge?.textContent || '';
  const match = text.match(/(\d+)(?:st|nd|rd|th)/);
  return match ? match[0] : undefined;
}

function extractNameFromProfile(): string | undefined {
  const nameEl = document.querySelector('h1.text-heading-xlarge');
  if (nameEl) {
    return nameEl.textContent?.trim();
  }

  const altNameEl = document.querySelector('.pv-text-details__left-panel h1');
  return altNameEl?.textContent?.trim();
}

export function extractLinkedInProfile(): LinkedInProfile | null {
  const name = extractNameFromProfile();
  if (!name) {
    return null;
  }

  const headline = extractHeadline();
  const company = extractCompanyFromExperience();
  const title = extractTitleFromExperience();
  const location = extractLocation();
  const connectionDegree = extractConnectionDegree();
  const profileUrl = window.location.href.split('?')[0] || window.location.href;

  return {
    name,
    headline,
    company,
    title,
    location,
    profileUrl,
    connectionDegree,
  };
}

export function extractSalesNavProfile(): LinkedInProfile | null {
  const nameEl = document.querySelector(
    '[data-anonymize="person-name"], .profile-topcard-person-entity__name',
  );
  const name = nameEl?.textContent?.trim();
  if (!name) {
    return null;
  }

  const titleEl = document.querySelector(
    '[data-anonymize="title"], .profile-topcard__summary-position',
  );
  const title = titleEl?.textContent?.trim();

  const companyEl = document.querySelector(
    '[data-anonymize="company-name"], .profile-topcard__summary-position-company',
  );
  const company = companyEl?.textContent?.trim();

  const locationEl = document.querySelector(
    '[data-anonymize="location"], .profile-topcard__location-data',
  );
  const location = locationEl?.textContent?.trim();

  const profileUrl = window.location.href.split('?')[0] || window.location.href;

  return {
    name,
    title,
    company,
    location,
    profileUrl,
  };
}

export function parseProfile(): LinkedInProfile | null {
  if (window.location.pathname.includes('/sales/')) {
    return extractSalesNavProfile();
  }
  return extractLinkedInProfile();
}

export function isProfilePage(): boolean {
  const path = window.location.pathname;
  return path.startsWith('/in/') || path.startsWith('/sales/lead/');
}
