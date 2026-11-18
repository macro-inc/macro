import { isFeatureEnabled, rustEditorModel } from '@core/constant/featureFlags';

// Node classes and command identities must use one engine for the whole page.
// Later rollout updates apply on the next load, never inside a live editor.
// Every engine decision (provider, loaders, offline contexts) reads this.
export const RUST_EDITOR_ENGINE = isFeatureEnabled(rustEditorModel);
