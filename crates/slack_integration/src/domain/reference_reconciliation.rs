//! Final within-job reference resolution. All selected work must have settled;
//! pending/missing targets now keep their source-only fallback permanently.

use super::{
    models::*,
    ports::{PortResult, ReferenceLookup},
    slack::references::{
        ConvertedText,
        resolve::{ReferenceContext, ReferenceOutcome, resolve_batch},
    },
};

#[cfg(test)]
mod test;

/// Persisted template and importer-body guard version. Changes require explicit
/// compatibility handling; an unknown version is closed without rewriting a body.
pub const IMPORTER_BODY_VERSION: i16 = 1;

/// Resolve only against committed canonical mappings and current disclosure access.
/// The caller holds a reconciliation fence and atomically guards the body update,
/// completes the intent, and schedules scoped search publication.
pub async fn final_body(
    lookup: &impl ReferenceLookup,
    context: &ReferenceContext,
    template: &ConvertedText,
    version: i16,
    limits: &ImportLimits,
) -> PortResult<Option<String>> {
    if version != IMPORTER_BODY_VERSION {
        return Ok(None);
    }
    let outcomes =
        match resolve_batch(lookup, context, std::slice::from_ref(template), limits).await {
            Ok(outcomes) => outcomes,
            // Invalid durable evidence must not hold a partial/cancelled job forever.
            Err(error)
                if matches!(
                    error.current_context(),
                    ImportError::InvalidInput | ImportError::LimitExceeded
                ) =>
            {
                return Ok(None);
            }
            Err(error) => return Err(error),
        };
    let targets: Vec<_> = outcomes
        .into_iter()
        .flatten()
        .map(|outcome| match outcome {
            ReferenceOutcome::Resolved(target) => Some(target),
            ReferenceOutcome::Pending | ReferenceOutcome::Fallback => None,
        })
        .collect();
    let Ok(body) = template.render(&targets) else {
        return Ok(None);
    };
    // Expansion must not turn a valid fallback into an unbounded stored message.
    if body == template.body || body.len() > limits.record_bytes as usize {
        return Ok(None);
    }
    Ok(Some(body))
}
