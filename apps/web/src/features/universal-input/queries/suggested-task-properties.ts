import type { PropertyApiValues } from '@property/types';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import type { PropertyDefinition } from '@service-properties/generated/schemas/propertyDefinition';
import type { PropertyOption } from '@service-properties/generated/schemas/propertyOption';
import { parseISO } from 'date-fns';
import { match } from 'ts-pattern';
import { z } from 'zod';

export type TaskFieldDefinition = {
  definition: PropertyDefinition;
  options: PropertyOption[];
};
export type TaskReference = {
  id: string;
  type: EntityType;
  labels: string[];
};
const suggestions = z.array(
  z.object({ name: z.string(), values: z.array(z.string()) })
);
const normalize = (text: string) => text.trim().toLowerCase();
const dateValue = z.union([
  z.iso.date(),
  z.iso.datetime({ local: true, offset: true }),
]);

/** Parse ISO values strictly before date-fns can normalize an impossible day. */
export function parseTaskDate(text: string): Date | undefined {
  const parsed = dateValue.safeParse(text.trim());
  if (!parsed.success) return;
  const date = parseISO(parsed.data);
  if (z.iso.date().safeParse(parsed.data).success) date.setHours(12, 0, 0, 0);
  return date;
}

/** Model text is resolved against the host's definitions and visible entities. */
export function suggestedTaskProperties(
  raw: string,
  definitions: TaskFieldDefinition[],
  references: TaskReference[]
) {
  const values: Record<string, PropertyApiValues> = {};
  const unresolved: string[] = [];
  let parsed: z.infer<typeof suggestions>;
  try {
    parsed = suggestions.parse(JSON.parse(raw || '[]'));
  } catch {
    return { values, unresolved: ['task fields'] };
  }
  for (const suggestion of parsed) {
    const fields = definitions.filter(
      (f) => normalize(f.definition.display_name) === normalize(suggestion.name)
    );
    if (fields.length !== 1 || !suggestion.values.length) {
      unresolved.push(suggestion.name);
      continue;
    }
    const field = fields[0];
    const definition = field.definition;
    const texts = suggestion.values;
    const text = texts[0];
    if (!definition.is_multi_select && texts.length > 1) {
      unresolved.push(suggestion.name);
      continue;
    }
    const value = match(definition.data_type)
      .with(
        'SELECT_STRING',
        'SELECT_NUMBER',
        (valueType): PropertyApiValues | undefined => {
          const matched = texts.map((text) =>
            field.options.filter(
              (option) =>
                normalize(String(option.value.value)) === normalize(text)
            )
          );
          return matched.every((options) => options.length === 1)
            ? { valueType, values: matched.map((options) => options[0].id) }
            : undefined;
        }
      )
      .with('ENTITY', (): PropertyApiValues | undefined => {
        const matched = texts.map((text) =>
          references.filter(
            (ref) =>
              (!definition.specific_entity_type ||
                ref.type === definition.specific_entity_type) &&
              ref.labels.some((label) => normalize(label) === normalize(text))
          )
        );
        return matched.every((refs) => refs.length === 1)
          ? {
              valueType: 'ENTITY',
              refs: matched.map((refs) => ({
                entity_id: refs[0].id,
                entity_type: refs[0].type,
              })),
            }
          : undefined;
      })
      .with(
        'STRING',
        (): PropertyApiValues => ({ valueType: 'STRING', value: text })
      )
      .with('NUMBER', (): PropertyApiValues | undefined =>
        text.trim() && Number.isFinite(Number(text))
          ? { valueType: 'NUMBER', value: Number(text) }
          : undefined
      )
      .with('BOOLEAN', (): PropertyApiValues | undefined => {
        const value = normalize(text);
        if (value !== 'true' && value !== 'false') return;
        return { valueType: 'BOOLEAN', value: value === 'true' };
      })
      .with('DATE', (): PropertyApiValues | undefined => {
        const date = parseTaskDate(text);
        return date ? { valueType: 'DATE', value: date } : undefined;
      })
      .with(
        'LINK',
        (): PropertyApiValues => ({ valueType: 'LINK', values: texts })
      )
      .with('TAG', 'DATE_RANGE', () => undefined)
      .exhaustive(() => undefined);
    if (value) values[definition.id] = value;
    else unresolved.push(suggestion.name);
  }
  return { values, unresolved };
}
