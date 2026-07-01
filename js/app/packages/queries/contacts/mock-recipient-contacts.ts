const DEFAULT_COUNT = 10_000;
const MAX_COUNT = 50_000;

type MockRecipientContactsConfig = {
  count?: number;
  domains?: string[];
};

function readMockRecipientContactsConfig(): MockRecipientContactsConfig {
  if (!import.meta.env.DEV) return { count: 0 };
  if (typeof window === 'undefined') return { count: DEFAULT_COUNT };

  const raw = window.localStorage.getItem(
    'macro:recipient-selector:mock-contacts'
  );
  if (!raw) return { count: DEFAULT_COUNT };

  try {
    return JSON.parse(raw) as MockRecipientContactsConfig;
  } catch {
    return { count: DEFAULT_COUNT };
  }
}

function normalizeCount(count: number | undefined): number {
  if (!Number.isFinite(count)) return DEFAULT_COUNT;
  return Math.max(0, Math.min(MAX_COUNT, Math.floor(count ?? DEFAULT_COUNT)));
}

function normalizeDomains(domains: string[] | undefined): string[] {
  const normalized = domains
    ?.map((domain) => domain.trim().toLowerCase())
    .filter(Boolean);

  return normalized?.length
    ? normalized
    : ['company.test', 'contoso.test', 'northwind.test', 'macro-load.test'];
}

function createMockRecipientContactIds(): string[] {
  const config = readMockRecipientContactsConfig();

  const count = normalizeCount(config.count);
  const domains = normalizeDomains(config.domains);

  return Array.from({ length: count }, (_, index) => {
    const domain = domains[index % domains.length];
    const paddedIndex = String(index + 1).padStart(5, '0');
    return `macro|recipient-${paddedIndex}@${domain}`;
  });
}

export const mockRecipientContactIds = createMockRecipientContactIds();
