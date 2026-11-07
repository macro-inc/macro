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
pub fn now_ms(tx: &Transaction<'_>) -> crate::Result<u64> {
    Ok((tx.extension::<NodeClock>()?.0)())
}
/// Generate an unvalidated URL-safe nanoid using host-provided random bytes.
pub fn nanoid(tx: &Transaction<'_>, length: usize) -> crate::Result<String> {
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
pub fn now_iso(tx: &Transaction<'_>) -> crate::Result<String> {
    let nanos = i128::from(now_ms(tx)?) * 1_000_000;
    time::OffsetDateTime::from_unix_timestamp_nanos(nanos)
        .map_err(|error| Error::invariant(error.to_string()))?
        .format(time::macros::format_description!(
            "[year]-[month]-[day]T[hour]:[minute]:[second].[subsecond digits:3]Z"
        ))
        .map_err(|error| Error::invariant(error.to_string()))
}
