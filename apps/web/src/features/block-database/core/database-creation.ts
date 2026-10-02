import type { DatabaseTemplate } from '@service-storage/generated/schemas/databaseTemplate';
import type { DatabaseTemplateId } from '@service-storage/generated/schemas/databaseTemplateId';

/** A new database: its name, and the template that builds it; without one it starts blank. */
export type DatabaseCreation = { name: string; template?: DatabaseTemplateId };

export const BLANK_DATABASE: DatabaseCreation = { name: 'Untitled database' };

export function templateDatabase(template: DatabaseTemplate): DatabaseCreation {
  return { name: template.name, template: template.id };
}

/** The templates a picker offers, as they load. */
export type DatabaseTemplates =
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'ready'; templates: DatabaseTemplate[] };
