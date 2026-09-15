//! Native transport glue for the same Soup adapter used by cache-wasm.
//! Application policy stays in soup-filter-cache-adapter; commands hold the
//! engine lock across projection preparation and the atomic cache write.

use super::{Engine, TursoStorage, Variables};
use cache_core::predicate::{PredicateQueryResult, ProjectionMutation};
use predicate_index::{OptimisticProjectionMutation, RecordKey};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use soup_filter_cache_adapter::{
    SoupFilterCompileOutcome, authoritative_projection_mutations, compile_filter_request,
    dirty_projection_mutations, mail, notification_deletion_updates,
    notification_projection_updates, optimistic_notification_updates,
    optimistic_projection_mutations,
};

/// Same request shape as the browser host's `EntityFilterCacheArgs`.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EntityFilterRequest {
    /// GraphQL Soup filter AST; policy/validation belongs to the Soup adapter.
    pub filters: Value,
    /// Requested Soup sort method.
    pub sort_method: String,
    /// Requested sort direction.
    pub sort_direction: String,
    /// Bounded maximum page size, validated by the shared compiler.
    pub limit: u16,
    /// Same-query server membership evidence, when reconciliation is requested.
    pub baseline: Option<Vec<PredicateBaselineEntry>>,
    /// Independent local Mail page request, never a server cursor.
    pub mail: Option<mail::PageRequest>,
}

/// Server membership evidence supplied by the caller for this exact query.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PredicateBaselineEntry {
    /// Normalized entity key.
    pub key: String,
    /// RFC 3339 timestamp retaining sub-millisecond sort precision.
    pub sort_timestamp: String,
}

/// Native/browser-compatible filter result. Mail uses the shared adapter's
/// wire representation directly rather than redefining its cursor contract.
#[derive(Serialize)]
#[serde(untagged)]
pub enum EntityFilterResult {
    /// Canonical cached Mail pagination result.
    Mail(mail::PageResult),
    /// Generic Soup predicate-index result.
    Predicate(PredicateFilterResult),
}

/// Generic Soup results matching the browser shell's tagged wire contract.
#[derive(Serialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum PredicateFilterResult {
    /// Local results reconciled with same-query server membership evidence.
    Reconciled {
        /// Effective-view revision.
        revision: String,
        /// Matching normalized entity keys in display order.
        keys: Vec<String>,
        /// Survivors backed only by the supplied server baseline.
        retained_keys: Vec<String>,
        /// Whether queued optimistic work contributed to the result.
        optimistic: bool,
    },
    /// Exact local evaluation over the supported profile.
    Complete {
        /// Effective-view revision.
        revision: String,
        /// Matching normalized entity keys in display order.
        keys: Vec<String>,
        /// Whether queued optimistic work contributed to the result.
        optimistic: bool,
    },
    /// The requested predicate is outside the local support profile.
    Unsupported,
    /// Required cached proof is missing or uncertain, not a negative match.
    Incomplete {
        /// Effective-view revision.
        revision: String,
    },
}

pub(super) async fn filter(
    engine: &mut Engine<TursoStorage>,
    generation: &str,
    request: EntityFilterRequest,
) -> Result<EntityFilterResult, String> {
    if let Some(mail_request) = request.mail {
        return mail::page(
            engine,
            generation,
            request.filters,
            &request.sort_method,
            &request.sort_direction,
            request.limit,
            mail_request,
        )
        .await
        .map(EntityFilterResult::Mail)
        .map_err(|error| error.to_string());
    }
    let outcome = compile_filter_request(
        request.filters,
        &request.sort_method,
        &request.sort_direction,
        request.limit,
    )
    .map_err(|error| error.to_string())?;
    let result = match outcome {
        SoupFilterCompileOutcome::Unsupported => PredicateFilterResult::Unsupported,
        SoupFilterCompileOutcome::Supported(query) if request.baseline.is_some() => {
            let baseline = request.baseline.unwrap();
            if baseline.len() > cache_core::predicate::reconciliation::MAX_RECONCILIATION_BASELINE {
                return Err("reconciliation baseline is too large".to_owned());
            }
            let baseline = baseline
                .into_iter()
                .map(|entry| {
                    soup_filter_cache_adapter::reconciliation_baseline_entry(
                        entry.key,
                        &entry.sort_timestamp,
                    )
                })
                .collect::<Result<Vec<_>, _>>()
                .map_err(|error| error.to_string())?;
            let result = engine
                .reconcile_predicate_index(&query, &baseline)
                .await
                .map_err(|error| error.to_string())?;
            PredicateFilterResult::Reconciled {
                revision: result.revision.to_string(),
                keys: result
                    .value
                    .keys
                    .into_iter()
                    .map(|key| key.as_str().to_owned())
                    .collect(),
                retained_keys: result
                    .value
                    .retained_keys
                    .into_iter()
                    .map(|key| key.as_str().to_owned())
                    .collect(),
                optimistic: result.value.optimistic,
            }
        }
        SoupFilterCompileOutcome::Supported(query) => {
            let result = engine
                .query_predicate_index(&query)
                .await
                .map_err(|error| error.to_string())?;
            let revision = result.revision.to_string();
            match result.value {
                PredicateQueryResult::Complete(keys) => PredicateFilterResult::Complete {
                    revision,
                    keys: keys
                        .into_iter()
                        .map(|key| key.as_str().to_owned())
                        .collect(),
                    optimistic: false,
                },
                PredicateQueryResult::Optimistic(keys) => PredicateFilterResult::Complete {
                    revision,
                    keys: keys
                        .into_iter()
                        .map(|key| key.as_str().to_owned())
                        .collect(),
                    optimistic: true,
                },
                PredicateQueryResult::Incomplete => PredicateFilterResult::Incomplete { revision },
            }
        }
    };
    Ok(EntityFilterResult::Predicate(result))
}

pub(super) async fn write_projections(
    engine: &mut Engine<TursoStorage>,
    query: &str,
    operation: Option<&str>,
    variables: &Variables,
    data: &Value,
    identity: Option<&str>,
) -> Result<Vec<ProjectionMutation>, String> {
    let mut projections = authoritative_projection_mutations(query, operation, data)
        .map_err(|error| error.to_string())?;
    // Do not compose the new viewer's partial writes with the old viewer's
    // authoritative data. Engine still owns the actual atomic identity reset.
    let reuse_stored_identity = match identity {
        Some(observed) => engine
            .current_identity()
            .await
            .map_err(|error| error.to_string())?
            .as_deref()
            .is_none_or(|bound| bound == observed),
        None => true,
    };
    if reuse_stored_identity {
        projections.extend(
            notification_projection_updates(engine.storage(), query, operation, variables, data)
                .await
                .map_err(|error| error.to_string())?,
        );
    }
    projections.extend(
        mail::projection_updates_for_write(
            engine.storage(),
            query,
            operation,
            variables,
            data,
            reuse_stored_identity,
        )
        .await
        .map_err(|error| error.to_string())?,
    );
    Ok(projections)
}

pub(super) async fn optimistic_projections(
    engine: &Engine<TursoStorage>,
    query: &str,
    operation: Option<&str>,
    variables: &Variables,
    data: &Value,
    created_at_ms: i64,
) -> Result<Vec<OptimisticProjectionMutation>, String> {
    let mut projections = optimistic_projection_mutations(data, created_at_ms);
    projections.extend(
        optimistic_notification_updates(
            notification_projection_updates(engine.storage(), query, operation, variables, data)
                .await
                .map_err(|error| error.to_string())?,
        )
        .map_err(|error| error.to_string())?,
    );
    projections.extend(mail::optimistic_updates(
        mail::projection_updates(engine.storage(), query, operation, variables, data)
            .await
            .map_err(|error| error.to_string())?,
    ));
    Ok(projections)
}

pub(super) async fn invalidation_projections(
    engine: &Engine<TursoStorage>,
    keys: &[String],
) -> Result<Vec<ProjectionMutation>, String> {
    let mut projections = dirty_projection_mutations(keys);
    projections.extend(mail::dirty_updates(keys));
    projections.extend(
        notification_deletion_updates(engine.storage(), keys, true)
            .await
            .map_err(|error| error.to_string())?,
    );
    Ok(projections)
}

pub(super) async fn deletion_projections(
    engine: &Engine<TursoStorage>,
    keys: &[String],
) -> Result<Vec<ProjectionMutation>, String> {
    let mut projections = notification_deletion_updates(engine.storage(), keys, false)
        .await
        .map_err(|error| error.to_string())?;
    projections.extend(
        keys.iter()
            .filter_map(|key| RecordKey::new(key.clone()).ok())
            .map(ProjectionMutation::Delete),
    );
    Ok(projections)
}
