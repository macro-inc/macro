import { DEFAULT_MODEL, Model, type TModel } from '../constant/model';

export const parseModel = (
  value: string | null | undefined
): TModel | undefined => {
  if (!value) return undefined;
  const values = Object.values(Model) as string[];
  if (values.includes(value)) return value as TModel;
  return undefined;
};

/** The selected model for a saved chat: draft, supported server model, default. */
export function resolveChatInputModel(
  serverModel: string | null | undefined,
  draftModel?: TModel
): TModel {
  return draftModel ?? parseModel(serverModel) ?? DEFAULT_MODEL;
}
