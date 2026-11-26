import {
  currentModelId,
  DEFAULT_MODEL,
  Model,
  type TModel,
} from '../constant/model';

const MODEL_IDS: readonly string[] = Object.values(Model);

/** A catalog model id (a retired id reads as its replacement), or `undefined`. */
export const parseModel = (
  value: string | null | undefined
): TModel | undefined => {
  if (!value) return undefined;
  const id = currentModelId(value);
  return MODEL_IDS.includes(id) ? (id as TModel) : undefined;
};

/** The selected model for a saved chat: draft, supported server model, default. */
export function resolveChatInputModel(
  serverModel: string | null | undefined,
  draftModel?: TModel
): TModel {
  return draftModel ?? parseModel(serverModel) ?? DEFAULT_MODEL;
}
