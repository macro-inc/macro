/** Accent a Contracts database shows beside its name. */
export const DATABASE_COLORS = [
  'green',
  'violet',
  'amber',
  'cyan',
  'blue',
  'pink',
] as const;
export type DatabaseColor = (typeof DATABASE_COLORS)[number];

/** A Contracts database: a named collection of packet records. */
export type ContractDatabase = {
  id: string;
  name: string;
  color: DatabaseColor;
};

/** Databases a new workspace starts with. */
export const STARTER_DATABASES: readonly Omit<ContractDatabase, 'id'>[] = [
  { name: 'Customer Agreements', color: 'green' },
  { name: 'Vendor MSAs', color: 'violet' },
  { name: 'NDAs', color: 'amber' },
  { name: 'Offer Letters', color: 'cyan' },
];

/** The next unused accent, cycling once every color is taken. */
export function nextDatabaseColor(
  existing: readonly Pick<ContractDatabase, 'color'>[]
): DatabaseColor {
  const used = new Set(existing.map((database) => database.color));
  const free = DATABASE_COLORS.find((color) => !used.has(color));
  return free ?? DATABASE_COLORS[existing.length % DATABASE_COLORS.length];
}
