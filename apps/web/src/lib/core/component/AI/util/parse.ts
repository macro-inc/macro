import { Model, type TModel } from '../constant/model';

export const parseModel = (
  value: string | null | undefined
): TModel | undefined => {
  if (!value) return undefined;
  const values = Object.values(Model) as string[];
  if (values.includes(value)) return value as TModel;
  return undefined;
};
