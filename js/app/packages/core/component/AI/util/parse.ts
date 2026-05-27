import { AgentModel } from '@service-cognition/generated/schemas';
import type { TModel } from '../types';

export const parseModel = (
  value: string | null | undefined
): TModel | undefined => {
  if (!value) return undefined;
  const values = Object.values(AgentModel) as string[];
  if (values.includes(value)) return value as TModel;
  return undefined;
};
