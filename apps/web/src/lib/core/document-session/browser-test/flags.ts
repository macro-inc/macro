export const rustEditorModel = { key: 'rust-editor-model' };

/** This fixture resolves a rollout without analytics or account requests. */
export function isFeatureEnabled() {
  return new URL(location.href).searchParams.get('native') !== 'false';
}
