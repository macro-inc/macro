import { EntityType } from '@service-connection/generated/schemas';

export function isEntityType(type: string): type is EntityType {
  return type in EntityType;
}
