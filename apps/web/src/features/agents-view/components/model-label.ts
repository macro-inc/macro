import {
  MODEL_PRETTYNAME,
  type Model,
} from '@core/component/AI/constant/model';

/** Readable model names shared by the composer and running sessions. */
export function modelLabel(id: string | undefined, name?: string) {
  if (!id) return 'Model';
  return (
    MODEL_PRETTYNAME[id as Model] ??
    MODEL_PRETTYNAME[`anthropic/${id}` as Model] ??
    (name ?? id)
      .replace(/^(anthropic|openai|google)\//, '')
      .replace(/^Claude /, '')
  );
}
