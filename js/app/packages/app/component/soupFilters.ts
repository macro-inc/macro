import { useUserId } from '@core/context/user';
import {
  type EntityData,
  isTaskEntity,
  type TaskEntityWithProperties,
} from '@macro-entity';
import type { APIEmailThreadPreviewMetadata } from '@service-email/generated/schemas';
import type { SoupEmailThreadPreviewMetadata } from '@service-storage/generated/schemas';
import { makePersisted } from '@solid-primitives/storage';
import { createMemo, createSignal } from 'solid-js';
import { isSignalTask } from './Soup/utils/filterHelpers';
import type { ClientFilter } from './ViewConfig';

type SignalConfig<T extends string> = {
  key: T;
  label: string;
  defaultValue: boolean;
};

type SignalToggle<T extends string> = SignalConfig<T> & {
  enabled: () => boolean;
  setEnabled: (value: boolean) => void;
};

const makeToggle = (storageKey: string, defaultValue: boolean) =>
  makePersisted(createSignal(defaultValue), { name: storageKey });

const toStorageKey = (scope: string, key: string) =>
  `signalFilter_${scope}_${key.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;

const createSignalToggles = <T extends string>(
  scope: string,
  configs: SignalConfig<T>[]
): SignalToggle<T>[] =>
  configs.map((config) => {
    const [enabled, setEnabled] = makeToggle(
      toStorageKey(scope, config.key),
      config.defaultValue
    );
    return { ...config, enabled, setEnabled };
  });

const PRIORITY_LABEL_SIGNAL_CONFIGS: SignalConfig<string>[] = [
  {
    key: 'CATEGORY_PERSONAL',
    label: 'Personal',
    defaultValue: true,
  },
  {
    key: 'SENT',
    label: 'Sent',
    defaultValue: true,
  },
  {
    key: 'IMPORTANT',
    label: 'Important',
    defaultValue: false,
  },
];

const PRIORITY_METADATA_SIGNAL_CONFIGS: SignalConfig<
  keyof SoupEmailThreadPreviewMetadata
>[] = [
  {
    key: 'knownSender',
    label: 'Known Sender',
    defaultValue: false,
  },
];

const PRIORITY_DOMAIN_SIGNAL_CONFIGS: SignalConfig<string>[] = [
  // E-Signature Services
  { key: '@docusign.com', label: 'DocuSign', defaultValue: true },
  { key: '@docusign.net', label: 'DocuSign Net', defaultValue: true },
  { key: '@hellosign.com', label: 'HelloSign', defaultValue: true },
  { key: '@dropboxsign.com', label: 'Dropbox Sign', defaultValue: true },
  { key: '@adobesign.com', label: 'Adobe Sign', defaultValue: true },
  { key: '@signnow.com', label: 'SignNow', defaultValue: true },
  { key: '@pandadoc.com', label: 'PandaDoc', defaultValue: true },

  // Accounting & Finance
  { key: '@quickbooks.com', label: 'QuickBooks', defaultValue: true },
  { key: '@xero.com', label: 'Xero', defaultValue: true },
  { key: '@stripe.com', label: 'Stripe', defaultValue: true },
  { key: '@paypal.com', label: 'PayPal', defaultValue: true },
  { key: '@squareup.com', label: 'Square', defaultValue: true },
  { key: '@bill.com', label: 'Bill.com', defaultValue: true },
  { key: '@intuit.com', label: 'Intuit', defaultValue: true },

  // HR & Payroll
  { key: '@gusto.com', label: 'Gusto', defaultValue: true },
  { key: '@justworks.com', label: 'Justworks', defaultValue: true },
  { key: '@rippling.com', label: 'Rippling', defaultValue: true },

  // Banks
  { key: '@chase.com', label: 'Chase', defaultValue: true },
  { key: '@bankofamerica.com', label: 'Bank of America', defaultValue: true },
  { key: '@wellsfargo.com', label: 'Wells Fargo', defaultValue: true },
  { key: '@capitalone.com', label: 'Capital One', defaultValue: true },
  { key: '@amex.com', label: 'American Express', defaultValue: true },
  { key: '@citibank.com', label: 'Citibank', defaultValue: true },

  // Investment & Brokerage
  { key: '@robinhood.com', label: 'Robinhood', defaultValue: true },
  { key: '@etrade.com', label: 'E*TRADE', defaultValue: true },
  { key: '@fidelity.com', label: 'Fidelity', defaultValue: true },
  { key: '@schwab.com', label: 'Charles Schwab', defaultValue: true },
  {
    key: '@interactivebrokers.com',
    label: 'Interactive Brokers',
    defaultValue: true,
  },
  { key: '@vanguard.com', label: 'Vanguard', defaultValue: true },
  { key: '@plaid.com', label: 'Plaid', defaultValue: true },

  // Government
  { key: '@irs.gov', label: 'IRS', defaultValue: true },
  { key: '@ssa.gov', label: 'Social Security', defaultValue: true },
  { key: '@uscis.gov', label: 'USCIS', defaultValue: true },
  { key: '@treasury.gov', label: 'Treasury', defaultValue: true },
  { key: '@efiletexas.gov', label: 'eFile Texas', defaultValue: true },
  { key: '@efilemanager.com', label: 'eFile Manager', defaultValue: true },
  { key: '@efile.ca.gov', label: 'eFile California', defaultValue: true },
  { key: '@sec.gov', label: 'SEC', defaultValue: true },

  // Recruiting & HR Software
  { key: '@greenhouse.io', label: 'Greenhouse', defaultValue: true },
  { key: '@lever.co', label: 'Lever', defaultValue: true },
  { key: '@bamboohr.com', label: 'BambooHR', defaultValue: true },
  { key: '@workday.com', label: 'Workday', defaultValue: true },
  { key: '@sap.com', label: 'SAP', defaultValue: true },
  { key: '@indeed.com', label: 'Indeed', defaultValue: true },
  { key: '@linkedin.com', label: 'LinkedIn', defaultValue: true },
  { key: '@ziprecruiter.com', label: 'ZipRecruiter', defaultValue: true },

  // Cloud Storage & File Sharing
  { key: '@dropbox.com', label: 'Dropbox', defaultValue: true },
  { key: '@box.com', label: 'Box', defaultValue: true },
  { key: '@drive.google.com', label: 'Google Drive', defaultValue: true },
  { key: '@sharepoint.com', label: 'SharePoint', defaultValue: true },
  { key: '@onedrive.live.com', label: 'OneDrive', defaultValue: true },
  { key: '@wetransfer.com', label: 'WeTransfer', defaultValue: true },

  // Productivity & Design
  { key: '@figma.com', label: 'Figma', defaultValue: true },
  { key: '@canva.com', label: 'Canva', defaultValue: true },
  { key: '@notion.so', label: 'Notion', defaultValue: true },
  { key: '@clickup.com', label: 'ClickUp', defaultValue: true },
  { key: '@airtable.com', label: 'Airtable', defaultValue: true },

  // Health Insurance
  {
    key: '@unitedhealthcare.com',
    label: 'UnitedHealthcare',
    defaultValue: true,
  },
  { key: '@aetna.com', label: 'Aetna', defaultValue: true },
  { key: '@cigna.com', label: 'Cigna', defaultValue: true },
  { key: '@metlife.com', label: 'MetLife', defaultValue: true },
  { key: '@anthem.com', label: 'Anthem', defaultValue: true },
  { key: '@oscarhealth.com', label: 'Oscar Health', defaultValue: true },
  { key: '@delta-dental.com', label: 'Delta Dental', defaultValue: true },
  {
    key: '@vanguardbenefits.com',
    label: 'Vanguard Benefits',
    defaultValue: true,
  },
  {
    key: '@fidelitybenefits.com',
    label: 'Fidelity Benefits',
    defaultValue: true,
  },

  // Tech & Development
  { key: '@aws.amazon.com', label: 'AWS', defaultValue: true },
  { key: '@cloudflare.com', label: 'Cloudflare', defaultValue: true },
  { key: '@digitalocean.com', label: 'DigitalOcean', defaultValue: true },
  { key: '@github.com', label: 'GitHub', defaultValue: true },
  { key: '@gitlab.com', label: 'GitLab', defaultValue: true },
  { key: '@atlassian.com', label: 'Atlassian', defaultValue: true },
  { key: '@openai.com', label: 'OpenAI', defaultValue: true },
  { key: '@anthropic.com', label: 'Anthropic', defaultValue: true },
];

const DEPRIORITY_LABEL_SIGNAL_CONFIGS: SignalConfig<string>[] = [
  {
    key: 'CATEGORY_UPDATES',
    label: 'Updates',
    defaultValue: true,
  },
  {
    key: 'CATEGORY_PROMOTIONS',
    label: 'Promotions',
    defaultValue: true,
  },
  {
    key: 'CATEGORY_SOCIAL',
    label: 'Social',
    defaultValue: true,
  },
  {
    key: 'CATEGORY_FORUMS',
    label: 'Forums',
    defaultValue: true,
  },
];

const DEPRIORITY_METADATA_SIGNAL_CONFIGS: SignalConfig<
  keyof SoupEmailThreadPreviewMetadata
>[] = [
  {
    key: 'tabular',
    label: 'Tabular',
    defaultValue: false,
  },
  {
    key: 'genericSender',
    label: 'Generic Sender',
    defaultValue: false,
  },
];

export const PRIORITY_LABEL_SIGNAL_TOGGLES = createSignalToggles(
  'priority_label',
  PRIORITY_LABEL_SIGNAL_CONFIGS
);
export const PRIORITY_METADATA_SIGNAL_TOGGLES = createSignalToggles(
  'priority_metadata',
  PRIORITY_METADATA_SIGNAL_CONFIGS
);
export const PRIORITY_DOMAIN_SIGNAL_TOGGLES = createSignalToggles(
  'priority_domain',
  PRIORITY_DOMAIN_SIGNAL_CONFIGS
);
export const DEPRIORITY_LABEL_SIGNAL_TOGGLES = createSignalToggles(
  'depriority_label',
  DEPRIORITY_LABEL_SIGNAL_CONFIGS
);
export const DEPRIORITY_METADATA_SIGNAL_TOGGLES = createSignalToggles(
  'depriority_metadata',
  DEPRIORITY_METADATA_SIGNAL_CONFIGS
);

// Computed Sets based on persisted settings
const SIGNAL_PRIORITY_LABELS = createMemo(
  () =>
    new Set(
      PRIORITY_LABEL_SIGNAL_TOGGLES.filter(({ enabled }) => enabled()).map(
        ({ key }) => key
      )
    )
);

const SIGNAL_DEPRIORITY_LABELS = createMemo(
  () =>
    new Set(
      DEPRIORITY_LABEL_SIGNAL_TOGGLES.filter(({ enabled }) => enabled()).map(
        ({ key }) => key
      )
    )
);

const SIGNAL_PRIORITY_METADATA = createMemo(
  () =>
    new Set<keyof SoupEmailThreadPreviewMetadata>(
      PRIORITY_METADATA_SIGNAL_TOGGLES.filter(({ enabled }) => enabled()).map(
        ({ key }) => key
      )
    )
);

const SIGNAL_PRIORITY_DOMAINS = createMemo(
  () =>
    new Set(
      PRIORITY_DOMAIN_SIGNAL_TOGGLES.filter(({ enabled }) => enabled()).map(
        ({ key }) => key.toLowerCase()
      )
    )
);

const SIGNAL_DEPRIORITY_METADATA = createMemo(
  () =>
    new Set<keyof SoupEmailThreadPreviewMetadata>(
      DEPRIORITY_METADATA_SIGNAL_TOGGLES.filter(({ enabled }) => enabled()).map(
        ({ key }) => key
      )
    )
);

const getLabelTokens = (
  labels?: Array<{ id?: string; providerLabelId?: string; name?: string }>
): string[] => {
  if (!labels?.length) return [];

  const tokens: string[] = [];
  for (const label of labels) {
    if (label.id) tokens.push(label.id);
    if (label.providerLabelId) tokens.push(label.providerLabelId);
    if (label.name) tokens.push(label.name);
  }

  return tokens.map((token) => token.toUpperCase());
};

// Helper to safely check metadata properties that may use different naming conventions. We can removed this when we're no longer using Email query, and only Soup query.
const getMetadataValue = (
  metadata:
    | SoupEmailThreadPreviewMetadata
    | APIEmailThreadPreviewMetadata
    | undefined,
  key: keyof SoupEmailThreadPreviewMetadata
): boolean | undefined => {
  if (!metadata) return undefined;

  // Check SoupEmailThreadPreviewMetadata format (camelCase)
  if (key in metadata) {
    return (metadata as SoupEmailThreadPreviewMetadata)[key];
  }

  // Check APIEmailThreadPreviewMetadata format (snake_case)
  const snakeCaseKey = key
    .replace(/([A-Z])/g, '_$1')
    .toLowerCase() as keyof APIEmailThreadPreviewMetadata;
  if (snakeCaseKey in metadata) {
    return (metadata as APIEmailThreadPreviewMetadata)[snakeCaseKey];
  }

  return undefined;
};

const hasParticipantWithPriorityDomain = (
  entity: Extract<EntityData, { type: 'email' }>
): boolean => {
  const priorityDomains = SIGNAL_PRIORITY_DOMAINS();
  if (priorityDomains.size === 0) return false;

  const participants = entity.participants ?? [];
  return participants.some((participant) => {
    const email = participant.email?.toLowerCase();
    if (!email) return false;
    return Array.from(priorityDomains).some((domain) => email.endsWith(domain));
  });
};

const getEmailSignalInfo = (entity: Extract<EntityData, { type: 'email' }>) => {
  const labelTokens = getLabelTokens(entity.labels);
  const priorityLabels = SIGNAL_PRIORITY_LABELS();
  const depriorityLabels = SIGNAL_DEPRIORITY_LABELS();
  const priorityMetadata = SIGNAL_PRIORITY_METADATA();
  const depriorityMetadata = SIGNAL_DEPRIORITY_METADATA();

  const hasPriorityLabel = labelTokens.some((label) =>
    priorityLabels.has(label)
  );
  const hasDeprioritizingLabel = labelTokens.some((label) =>
    depriorityLabels.has(label)
  );

  const hasPriorityMetadata = entity.metadata
    ? Array.from(priorityMetadata).some(
        (key) => getMetadataValue(entity.metadata, key) === true
      )
    : false;
  const hasDeprioritizingMetadata = entity.metadata
    ? Array.from(depriorityMetadata).some(
        (key) => getMetadataValue(entity.metadata, key) === true
      )
    : false;

  const hasPriorityDomain = hasParticipantWithPriorityDomain(entity);

  return {
    hasPriority: hasPriorityMetadata || hasPriorityLabel || hasPriorityDomain,
    hasDepriority: hasDeprioritizingLabel || hasDeprioritizingMetadata,
  };
};

const isSignalEmail = (entity: Extract<EntityData, { type: 'email' }>) => {
  const { hasPriority, hasDepriority } = getEmailSignalInfo(entity);
  // Signal = has priority indicators OR has no depriority indicators
  return hasPriority || !hasDepriority;
};

const isNoiseEmail = (entity: Extract<EntityData, { type: 'email' }>) => {
  const { hasPriority, hasDepriority } = getEmailSignalInfo(entity);
  // Noise = has depriority indicators AND no priority indicators
  return hasDepriority && !hasPriority;
};

const hasRecentlyViewed = (entity: EntityData) => {
  if (!entity.viewedAt) return false;

  const now = Date.now();
  const viewedAt = new Date(entity.viewedAt);

  const diff = now - viewedAt.getTime();

  const seconds = diff / 1000;

  const oneDayOfSeconds = 3600 * 24;

  return seconds < oneDayOfSeconds;
};

const getCurrentUserId = () => {
  try {
    return useUserId()();
  } catch {
    return undefined;
  }
};

export const signalFilter: ClientFilter = {
  id: 'signal',
  predicate: (entity, _ctx) => {
    switch (entity.type) {
      case 'channel': {
        return true;
      }
      case 'chat': {
        return hasRecentlyViewed(entity);
      }
      case 'document': {
        if (isTaskEntity(entity)) {
          const currentUserId = getCurrentUserId();
          return isSignalTask(
            entity as TaskEntityWithProperties,
            currentUserId
          );
        }
        return hasRecentlyViewed(entity);
      }
      case 'email': {
        return isSignalEmail(entity) || entity.isDraft;
      }
      case 'project': {
        return hasRecentlyViewed(entity);
      }
    }
  },
};

export const noiseFilter: ClientFilter = {
  id: 'noise',
  predicate: (entity, ctx) => {
    return !signalFilter.predicate(entity, ctx);
  },
};

/**
 * Explicit noise filter - only returns true for items with explicit noise indicators.
 * Currently only emails can be "explicit noise" (those with depriority labels/metadata).
 * Non-email items are never considered explicit noise (they're neutral).
 */
export const explicitNoiseFilter: ClientFilter = {
  id: 'explicitNoise',
  predicate: (entity, _ctx) => {
    if (entity.type === 'email') {
      return isNoiseEmail(entity);
    }
    // Non-email items are never explicit noise
    return false;
  },
};
