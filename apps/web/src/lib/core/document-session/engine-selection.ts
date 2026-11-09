import { isFeatureEnabled, rustEditorModel } from '@core/constant/featureFlags';

// Node classes and command identities must use one engine for the whole page.
// Later rollout updates apply on the next load, never inside a live editor.
export const RUST_EDITOR_ENGINE = isFeatureEnabled(rustEditorModel);
