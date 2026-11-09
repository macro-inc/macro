//! Development-only Tier A entry point, excluded from shipped native bindings.
use crate::*;
/// Replay one unchanged Tier A fixture. None means pass; errors retain exact diagnostics.
#[uniffi::export]
pub fn replay_tier_a_fixture(
    fixture_json: String,
    strict_keys: bool,
) -> Result<Option<String>, FfiSessionError> {
    let fixture = serde_json::from_str(&fixture_json).map_err(invalid)?;
    let mut replay = lexical_conformance::replay::Replayer::default();
    replay.strict_keys = strict_keys;
    Ok(replay.replay(&fixture).err().map(|error| error.to_string()))
}
