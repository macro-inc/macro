//! Host inputs for constructors; no wall clock, browser globals or random I/O.
use lexical_model::*;
use std::sync::Arc;
/// Injected epoch-millisecond clock for non-idempotent document imports.
#[derive(Clone)]
pub struct NodeClock(pub Arc<dyn Fn() -> u64 + Send + Sync>);
/// Injected deterministic bytes for nanoid construction, staged with the transaction.
#[derive(Clone)]
pub struct NodeRandom(pub Arc<dyn Fn(usize) -> Vec<u8> + Send + Sync>);
/// Optional browser hostname used by booking-link constructors and clones.
#[derive(Clone, Default)]
pub struct NodeHost(pub Option<Arc<str>>);
/// Read the installed clock; every host installs it explicitly.
pub fn now_ms(tx: &Transaction<'_>) -> crate::ModelResult<u64> {
    Ok((tx.extension::<NodeClock>()?.0)())
}
/// Generate an unvalidated URL-safe nanoid using host-provided random bytes.
pub fn nanoid(tx: &Transaction<'_>, length: usize) -> crate::ModelResult<String> {
    let bytes = (tx.extension::<NodeRandom>()?.0)(length);
    if bytes.len() != length {
        return Err(Error::Invariant("node RNG returned an invalid byte count"));
    }
    bytes
        .iter()
        .map(|byte| {
            lexical_node_id::NANOID_URL_ALPHABET
                .get(usize::from(byte & 63))
                .copied()
                .map(char::from)
        })
        .collect::<Option<String>>()
        .ok_or(Error::Invariant("invalid nanoid alphabet index"))
}
/// Format the injected clock with JavaScript Date.toISOString precision.
pub fn now_iso(tx: &Transaction<'_>) -> crate::ModelResult<String> {
    let millis = i64::try_from(now_ms(tx)?).map_err(|error| Error::invariant(error.to_string()))?;
    let date = chrono::DateTime::<chrono::Utc>::from_timestamp_millis(millis)
        .ok_or(Error::Invariant("invalid node timestamp"))?;
    Ok(date.to_rfc3339_opts(chrono::SecondsFormat::Millis, true))
}
