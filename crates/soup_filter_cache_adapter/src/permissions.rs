//! Application cache retirement when a viewer's CRM permission changes.
//!
//! Browser and native owners call this under their engine lock. The durable
//! closed marker precedes retirement, so interrupted work cannot expose an old
//! snapshot on reopening. Authored commands and received notification history
//! are separate from the copied record data retired here.

use cache_core::engine::authority::AuthorityTransition;
use cache_core::engine::{Engine, EngineError};
use cache_core::predicate::PredicateIndexStorage;
use cache_core::queue::{OptimisticSource, decode_optimistic_source};
use cache_core::value::{CacheValue, EntityKey, Record};
use predicate_index::RecordKey;
use serde_json::{Map, Value};
use std::collections::BTreeMap;
use uuid::Uuid;

mod ownership;
pub use ownership::response_property_owners;
use ownership::{assignment_owners, read_records, selected_keys};

const PAGE: usize = 500;
const OWNER_TYPE: &str = "CachePropertyOwner";

/// Content families whose grants may derive from CRM. Independently accessible
/// mail and pipelines are fetched again through the server's current grants.
pub const CRM_CONTENT_TYPES: &[&str] = &[
    "GraphqlSoupCrmCompany",
    "GraphqlSoupCrmContact",
    "GraphqlCrmPipeline",
    "GraphqlCrmPipelineEntry",
    "GraphqlCrmPipelineColumn",
    "GraphqlSoupEmailThread",
    "GraphqlSoupEmailMessage",
    "GraphqlMailPreviewMessage",
    "GraphqlMailDraftEntry",
    "GraphqlSoupEmailAttachment",
    "GraphqlSoupEmailMessageAttachment",
    "GraphqlSoupEmailDraftAttachment",
    "GraphqlSoupEmailParticipant",
    // Legacy rows have no trustworthy host provenance. Retire their copied
    // snapshots and reload independently accessible databases from the server.
    "GraphqlSoupDatabaseRow",
];

// These owners can carry properties independently of CRM. Legacy unowned
// assignments have no trustworthy scope and must be rehydrated.
const OTHER_PROPERTY_OWNERS: &[&str] = &[
    "GraphqlSoupDocument",
    "GraphqlSoupProject",
    "GraphqlSoupChat",
    "GraphqlSoupChannel",
    "GraphqlCalendarEvent",
    "GraphqlSoupCalendarEvent",
    "GraphqlSoupCall",
    "GraphqlUser",
    "GraphqlSoupInitiative",
];

#[cfg(all(test, not(target_arch = "wasm32")))]
mod measurement;
#[cfg(all(test, not(target_arch = "wasm32")))]
mod test;

fn content_key(key: &EntityKey<'_>) -> bool {
    key.typename()
        .is_some_and(|kind| CRM_CONTENT_TYPES.contains(&kind))
}

fn string<'a>(record: &'a Record, field: &str) -> Option<&'a str> {
    match record.fields.get(field)? {
        CacheValue::String(value) => Some(value),
        _ => None,
    }
}

fn refs(value: &CacheValue, visit: &mut impl FnMut(&EntityKey<'static>)) {
    match value {
        CacheValue::Ref(key) => visit(key),
        CacheValue::List(values) => values.iter().for_each(|value| refs(value, visit)),
        CacheValue::Object(fields) => fields.values().for_each(|value| refs(value, visit)),
        _ => {}
    }
}

fn field_name(field: &str) -> &str {
    field.split_once('(').map_or(field, |(name, _)| name)
}

fn args(field: &str) -> Option<Value> {
    serde_json::from_str(field.split_once('(')?.1.strip_suffix(')')?).ok()
}

fn protected_kind(kind: &str) -> bool {
    matches!(
        kind.to_ascii_lowercase().as_str(),
        "crm_company"
            | "crm_contact"
            | "company"
            | "contact"
            | "crm_pipeline"
            | "pipeline"
            | "email"
            | "email_thread"
            | "thread"
            | "database_row"
            | "database"
    )
}

fn explicit_unrelated_types(value: &Value) -> bool {
    let input = value.get("input").unwrap_or(value);
    input
        .get("initial")
        .and_then(|initial| initial.get("filters"))
        .and_then(|filters| {
            graphql_soup_filter_input::materialize_graphql_filter(filters.clone()).ok()
        })
        .is_some_and(|ast| item_filter_index::excludes_crm_content(&ast))
}

fn viewer_field(field: &str, value: &CacheValue) -> bool {
    match field_name(field) {
        // Received history is preserved. Missing live target records follow
        // the existing cache-miss/server behavior for inaccessible entities.
        "notificationInbox" => false,
        "soup" | "groupSoup" | "activity" | "activityOverview" => {
            !args(field).as_ref().is_some_and(explicit_unrelated_types)
        }
        "savedViews" => args(field)
            .and_then(|args| args.get("kind").and_then(Value::as_str).map(str::to_owned))
            .is_none_or(|kind| matches!(kind.as_str(), "crm" | "crm-list")),
        "savedView" | "emailThread" | "emailMessage" | "mail" | "mailPreview" | "workFeed"
        | "attentionFeed" | "favorites" | "databaseActivity" => true,
        _ => {
            let mut protected = false;
            refs(value, &mut |key| protected |= content_key(key));
            protected
        }
    }
}

fn selected_record(key: &EntityKey<'_>, record: &Record) -> bool {
    match key.typename() {
        Some("GraphqlActivityEvent" | "GraphqlFavorite") => {
            string(record, "entityType").is_none_or(protected_kind)
        }
        Some("GraphqlSavedView") => match record.fields.get("config") {
            Some(CacheValue::Opaque(config)) => serde_json::from_str::<Value>(config)
                .ok()
                .and_then(|config| {
                    config
                        .get("kind")
                        .and_then(Value::as_str)
                        .map(str::to_owned)
                })
                .is_none_or(|kind| matches!(kind.as_str(), "crm" | "crm-list")),
            _ => true,
        },
        _ => content_key(key),
    }
}

fn property_owner_key(property: &EntityKey<'_>) -> Option<EntityKey<'static>> {
    (property.typename() == Some("GraphqlProperty"))
        .then(|| EntityKey::entity(OWNER_TYPE, &[property.id().unwrap_or_default()]))
}

fn owner_from_kind(kind: &str, id: &str) -> Option<EntityKey<'static>> {
    let typename = match kind {
        "DOCUMENT" | "TASK" => "GraphqlSoupDocument",
        "PROJECT" => "GraphqlSoupProject",
        "CHAT" => "GraphqlSoupChat",
        "CHANNEL" => "GraphqlSoupChannel",
        "THREAD" | "EMAIL" => "GraphqlSoupEmailThread",
        "COMPANY" | "CRM_COMPANY" => "GraphqlSoupCrmCompany",
        "CONTACT" | "CRM_CONTACT" => "GraphqlSoupCrmContact",
        "DATABASE_ROW" => "GraphqlSoupDatabaseRow",
        "CALENDAR_EVENT" => "GraphqlSoupCalendarEvent",
        "CALL_RECORD" => "GraphqlSoupCall",
        "INITIATIVE" => "GraphqlSoupInitiative",
        "USER" => "GraphqlUser",
        _ => return None,
    };
    Some(EntityKey::entity(typename, &[id]))
}

fn owner_record(owner: EntityKey<'static>) -> Record {
    Record {
        fields: [("owner".into(), CacheValue::Ref(owner))].into(),
    }
}

fn shared_definition(record: &Record) -> bool {
    matches!(record.fields.get("owner"), Some(CacheValue::Object(owner))
        if matches!(owner.get("scope"), Some(CacheValue::String(scope))
            if matches!(scope.as_str(), "SYSTEM" | "USER" | "TEAM")))
}

/// Persist assignment ownership, including mutation-only responses that have no
/// parent selection. Call only for admitted authoritative content, under the
/// same owner lock as the response write. Losing ownership can only cause a
/// conservative cache miss at retirement, never grant access.
pub async fn remember_property_owners<S: PredicateIndexStorage>(
    engine: &mut Engine<S>,
    query: &str,
    operation: Option<&str>,
    variables: &Map<String, Value>,
    data: &Value,
) -> Result<cache_core::revision::CacheRevision, EngineError<S::Error>> {
    async {
        let owners =
            assignment_owners::<S::Error>(engine.schema(), query, operation, variables, data)?;
        if !owners.is_empty() {
            engine
                .put_records_with_projections(None, owners.into_iter().collect(), vec![])
                .await?;
        }
        Ok(engine.current_revision())
    }
    .await
    .inspect_err(|error| tracing::warn!(%error, "Failed to remember property owners"))
}

/// Retain only authored legacy draft recovery fields before removing copied
/// email responses. This metadata is consumed by the existing draft migration;
/// it is never used to render or authorize a thread.
pub fn preserve_legacy_draft(source: &mut OptimisticSource, operation: Option<&str>) {
    source.client_metadata = legacy_draft_metadata(
        source.client_metadata.take(),
        &source.mutation_data,
        operation,
    );
}

/// Inspect replayable command intent without returning copied response snapshots.
/// This path stays available when permission proofs cannot be fetched offline.
pub async fn inspect_authored_mutations<S: PredicateIndexStorage>(
    engine: &Engine<S>,
) -> Result<Vec<cache_core::queue::MutationInspection>, EngineError<S::Error>> {
    let mut entries = engine.inspect_mutations().await?;
    for entry in &mut entries {
        entry.client_metadata = legacy_draft_metadata(
            entry.client_metadata.take(),
            &entry.optimistic_data,
            entry.operation_name.as_deref(),
        );
        entry.optimistic_data = Value::Object(Map::new());
    }
    Ok(entries)
}

/// Extract the authored recovery fields before a stale enqueue is sanitized.
pub fn legacy_draft_metadata(
    mut metadata: Option<Value>,
    data: &Value,
    operation: Option<&str>,
) -> Option<Value> {
    if operation != Some("SaveEmailDraft") {
        return metadata;
    }
    let Some(draft) = data
        .get("saveEmailDraft")
        .and_then(|value| value.get("draft"))
    else {
        return metadata;
    };
    let mut recovery = Map::new();
    for field in ["attachmentsDraft", "attachmentsForwarded", "linkId", "from"] {
        if let Some(value) = draft.get(field) {
            recovery.insert(field.into(), value.clone());
        }
    }
    if recovery.is_empty() {
        return metadata;
    }
    let value = metadata.get_or_insert_with(|| Value::Object(Map::new()));
    if let Some(value) = value.as_object_mut() {
        value
            .entry("legacyDraftRecovery")
            .or_insert(Value::Object(recovery));
    }
    metadata
}

#[tracing::instrument(name = "crm.access.retire_optimism", skip_all, fields(crm.access.queued = tracing::field::Empty, crm.access.retired = tracing::field::Empty), err)]
async fn retire_optimism<S: PredicateIndexStorage>(
    engine: &mut Engine<S>,
) -> Result<(), EngineError<S::Error>> {
    let queued = engine
        .storage()
        .load_mutation_queue()
        .await
        .map_err(EngineError::Storage)?;
    tracing::Span::current().record("crm.access.queued", queued.len() as i64);
    let mut selected = std::collections::BTreeSet::new();
    for entry in queued {
        let source =
            decode_optimistic_source(&entry.optimistic.optimistic_data_json).map_err(|detail| {
                EngineError::InvalidQueuedMutation {
                    id: entry.id,
                    detail,
                }
            })?;
        let mut keys = entry
            .optimistic
            .normalized_updates
            .keys()
            .cloned()
            .collect::<std::collections::BTreeSet<_>>();
        for mutation in &source.projection_mutations {
            keys.insert(EntityKey(mutation.record_key().as_str().to_owned().into()));
        }
        for patch in &source.link_patches {
            if let Ok(value) = serde_json::to_value(patch) {
                collect_policy_keys(&value, &mut keys);
            }
        }
        let keys = keys.into_iter().collect::<Vec<_>>();
        let mut records = read_records(engine, &keys).await?;
        for key in keys {
            records.entry(key).or_default();
        }
        for (key, update) in &entry.optimistic.normalized_updates {
            records
                .entry(key.clone())
                .or_default()
                .merge(update.clone());
        }
        for mutation in &source.projection_mutations {
            records
                .entry(EntityKey(mutation.record_key().as_str().to_owned().into()))
                .or_default();
        }
        let variables =
            serde_json::from_str::<Map<String, Value>>(&entry.mutation.request.variables_json)
                .map_err(|error| EngineError::InvalidQueuedMutation {
                    id: entry.id,
                    detail: error.to_string(),
                })?;
        let entries = records.into_iter().collect::<Vec<_>>();
        let document = crate::parsed_document::parsed_document(&entry.mutation.request.query)?;
        let operation = document.operation(entry.mutation.request.operation_name.as_deref())?;
        let authored_source = cache_core::normalize::normalize(
            engine.schema(),
            operation,
            &variables,
            &source.mutation_data,
        )?;
        let owners = response_property_owners(
            engine.schema(),
            operation,
            &variables,
            &source.mutation_data,
            &authored_source,
        )?;
        let protected = !selected_keys(engine, &entries, owners).await?.is_empty()
            || authored_source.iter().any(|(key, record)| {
                key.typename() == Some("GraphqlUser")
                    && record
                        .fields
                        .iter()
                        .any(|(field, value)| viewer_field(field, value))
            });
        if protected {
            selected.insert(entry.id);
        }
    }
    tracing::Span::current().record("crm.access.retired", selected.len() as i64);
    engine
        .retire_optimistic_snapshots_where(|entry, source| {
            if !selected.contains(&entry.id) {
                return false;
            }
            preserve_legacy_draft(source, entry.mutation.request.operation_name.as_deref());
            true
        })
        .await?;
    Ok(())
}

fn collect_policy_keys(value: &Value, keys: &mut std::collections::BTreeSet<EntityKey<'static>>) {
    match value {
        Value::String(value) => {
            let key = EntityKey(value.clone().into());
            if content_key(&key)
                || matches!(
                    key.typename(),
                    Some(
                        "GraphqlProperty"
                            | "GraphqlPropertyDefinition"
                            | "GraphqlPropertyOption"
                            | "GraphqlActivityEvent"
                            | "GraphqlSavedView"
                    )
                )
            {
                keys.insert(key);
            }
        }
        Value::Array(values) => values
            .iter()
            .for_each(|value| collect_policy_keys(value, keys)),
        Value::Object(values) => values
            .values()
            .for_each(|value| collect_policy_keys(value, keys)),
        _ => {}
    }
}

async fn delete<S: PredicateIndexStorage>(
    engine: &mut Engine<S>,
    keys: Vec<EntityKey<'static>>,
) -> Result<(), EngineError<S::Error>> {
    let projections = keys
        .iter()
        .filter_map(|key| RecordKey::new(key.to_string()).ok())
        .collect::<Vec<_>>();
    let keys = engine.preserve_identity_metadata(keys).await?;
    engine
        .delete_keys_with_projections(&keys, &projections)
        .await?;
    Ok(())
}

/// Finish durable cleanup before exposing cached data after an interrupted transition.
/// This uses the already persisted policy and never requests server permission.
pub async fn resume_crm_retirement<S: PredicateIndexStorage>(
    engine: &mut Engine<S>,
) -> Result<Option<AuthorityTransition>, EngineError<S::Error>> {
    let Some(pending) = engine.unfinished_retirement().await? else {
        return Ok(None);
    };
    let Some(policy) = pending.policy else {
        return Ok(None);
    };
    let current = engine.current_authority(&pending.identity).await?;
    transition_crm_authority(engine, &pending.identity, current.generation, policy)
        .await
        .map(Some)
}

/// Apply one fresh proof against the generation captured before its request.
pub async fn transition_crm_authority<S: PredicateIndexStorage>(
    engine: &mut Engine<S>,
    identity: &str,
    expected: Uuid,
    policy: String,
) -> Result<AuthorityTransition, EngineError<S::Error>> {
    // Account changes already reset the engine transactionally. Denial or loss
    // of the prior team scope retires copied content; initial non-denied
    // proofs and same-team regrants preserve it.
    let previous = engine.current_authority(identity).await?;
    let previous_team = previous
        .policy
        .as_deref()
        .and_then(|value| value.split_once(':'))
        .map(|(team, _)| team);
    let next_team = policy.split_once(':').map(|(team, _)| team);
    let retire_snapshots =
        policy.ends_with(":denied") || previous_team.is_some_and(|team| Some(team) != next_team);
    let authority = engine
        .begin_authority_transition(identity, expected, policy, retire_snapshots)
        .await?;
    if authority.ready {
        let mut result = engine.complete_authority_transition(authority).await?;
        result.changed |= result.authority.generation != expected;
        return Ok(result);
    }
    retire_property_owners(engine).await?;
    retire_option_owners(engine).await?;
    retire_records(engine).await?;
    retire_projections(engine).await?;
    // Rebuild retained command recipes only after their copied base aggregates
    // have been removed, so an unrelated favorite cannot restore an old list.
    retire_optimism(engine).await?;
    retire_ownership_metadata(engine).await?;
    engine.complete_authority_transition(authority).await
}

async fn retire_ownership_metadata<S: PredicateIndexStorage>(
    engine: &mut Engine<S>,
) -> Result<(), EngineError<S::Error>> {
    let mut after = None;
    loop {
        let keys = engine
            .storage()
            .record_keys(OWNER_TYPE, after.as_deref(), PAGE)
            .await
            .map_err(EngineError::Storage)?;
        let Some(last) = keys.last() else {
            break;
        };
        after = Some(last.id().unwrap_or_default().to_owned());
        let records = engine
            .storage()
            .get_batch(&keys)
            .await
            .map_err(EngineError::Storage)?;
        let remove = keys
            .into_iter()
            .zip(records)
            .filter_map(|(key, record)| {
                match record
                    .as_ref()
                    .and_then(|record| record.fields.get("owner"))
                {
                    Some(CacheValue::Ref(owner)) if content_key(owner) => Some(key),
                    _ => None,
                }
            })
            .collect::<Vec<_>>();
        if !remove.is_empty() {
            engine.delete_keys_with_projections(&remove, &[]).await?;
        }
    }
    Ok(())
}

#[tracing::instrument(name = "crm.access.retire_property_owners", skip_all, fields(crm.access.scanned = tracing::field::Empty), err)]
async fn retire_property_owners<S: PredicateIndexStorage>(
    engine: &mut Engine<S>,
) -> Result<(), EngineError<S::Error>> {
    let mut scanned = 0usize;
    // Collect ownership before parents disappear. Metadata is bounded per
    // page and survives a partial retirement, making retries idempotent.
    for typename in CRM_CONTENT_TYPES.iter().chain(OTHER_PROPERTY_OWNERS) {
        let mut after = None;
        loop {
            let keys = engine
                .storage()
                .record_keys(typename, after.as_deref(), PAGE)
                .await
                .map_err(EngineError::Storage)?;
            scanned += keys.len();
            let Some(last) = keys.last() else {
                break;
            };
            after = Some(last.id().unwrap_or_default().to_owned());
            let records = engine
                .storage()
                .get_batch(&keys)
                .await
                .map_err(EngineError::Storage)?;
            let mut owners = BTreeMap::new();
            for (key, record) in keys.iter().zip(&records) {
                let Some(record) = record else {
                    continue;
                };
                for (field, value) in &record.fields {
                    if field_name(field) != "properties" {
                        continue;
                    }
                    refs(value, &mut |property| {
                        if let Some(metadata) = property_owner_key(property) {
                            owners.insert(metadata, owner_record(key.clone()));
                        }
                    });
                }
            }
            if !owners.is_empty() {
                engine
                    .retire_record_fields(owners.into_iter().collect(), vec![])
                    .await?;
            }
        }
    }

    tracing::Span::current().record("crm.access.scanned", scanned as i64);
    Ok(())
}

#[tracing::instrument(name = "crm.access.retire_option_owners", skip_all, fields(crm.access.scanned = tracing::field::Empty), err)]
async fn retire_option_owners<S: PredicateIndexStorage>(
    engine: &mut Engine<S>,
) -> Result<(), EngineError<S::Error>> {
    let mut scanned = 0usize;
    // Options may be selected without a normalized pipeline column. Preserve
    // only positive shared-definition ownership; unknown legacy options need
    // revalidation like unknown assignment and database-row snapshots.
    let mut after = None;
    loop {
        let keys = engine
            .storage()
            .record_keys("GraphqlPropertyDefinition", after.as_deref(), PAGE)
            .await
            .map_err(EngineError::Storage)?;
        scanned += keys.len();
        let Some(last) = keys.last() else {
            break;
        };
        after = Some(last.id().unwrap_or_default().to_owned());
        let records = engine
            .storage()
            .get_batch(&keys)
            .await
            .map_err(EngineError::Storage)?;
        let mut owners = Vec::new();
        for (key, record) in keys.into_iter().zip(records) {
            let Some(record) = record else {
                continue;
            };
            if !shared_definition(&record) {
                continue;
            }
            if let Some(value) = record.fields.get("options") {
                refs(value, &mut |option| {
                    if option.typename() == Some("GraphqlPropertyOption") {
                        owners.push((
                            EntityKey::entity(
                                "CachePropertyOptionOwner",
                                &[option.id().unwrap_or_default()],
                            ),
                            owner_record(key.clone()),
                        ));
                    }
                });
            }
        }
        if !owners.is_empty() {
            engine.retire_record_fields(owners, vec![]).await?;
        }
    }

    tracing::Span::current().record("crm.access.scanned", scanned as i64);
    Ok(())
}

#[tracing::instrument(name = "crm.access.retire_records", skip_all, fields(crm.access.scanned = tracing::field::Empty), err)]
async fn retire_records<S: PredicateIndexStorage>(
    engine: &mut Engine<S>,
) -> Result<(), EngineError<S::Error>> {
    let mut scanned = 0usize;
    // Shared definitions stay. Options selected by a pipeline column, and
    // assignments on protected parents, are copied pipeline/record content.
    for typename in CRM_CONTENT_TYPES.iter().copied().chain([
        "GraphqlPropertyOption",
        "GraphqlPropertyDefinition",
        "GraphqlActivityEvent",
        "GraphqlFavorite",
        "GraphqlSavedView",
        "GraphqlProperty",
        "GraphqlUser",
    ]) {
        let mut after = None;
        loop {
            let keys = engine
                .storage()
                .record_keys(typename, after.as_deref(), PAGE)
                .await
                .map_err(EngineError::Storage)?;
            scanned += keys.len();
            let Some(last) = keys.last() else {
                break;
            };
            after = Some(last.id().unwrap_or_default().to_owned());
            let records = engine
                .storage()
                .get_batch(&keys)
                .await
                .map_err(EngineError::Storage)?;
            let entries = keys
                .into_iter()
                .zip(records)
                .filter_map(|(key, record)| record.map(|record| (key, record)))
                .collect::<Vec<_>>();
            let remove = selected_keys(engine, &entries, BTreeMap::new())
                .await?
                .into_iter()
                .collect::<Vec<_>>();
            let mut replace = Vec::new();
            if typename == "GraphqlUser" {
                for (key, mut record) in entries {
                    let before = record.fields.len();
                    record
                        .fields
                        .retain(|field, value| !viewer_field(field, value));
                    if before != record.fields.len() {
                        replace.push((key, record));
                    }
                }
            }
            if !remove.is_empty() {
                delete(engine, remove).await?;
            }
            if !replace.is_empty() {
                engine.retire_record_fields(replace, vec![]).await?;
            }
        }
    }
    tracing::Span::current().record("crm.access.scanned", scanned as i64);
    Ok(())
}

#[tracing::instrument(name = "crm.access.retire_projections", skip_all, fields(crm.access.scanned = tracing::field::Empty), err)]
async fn retire_projections<S: PredicateIndexStorage>(
    engine: &mut Engine<S>,
) -> Result<(), EngineError<S::Error>> {
    let mut scanned = 0usize;
    // Predicate facts can outlive a partial or missing normalized record. They
    // must not keep authorizing local selection after raw-record retirement.
    for typename in CRM_CONTENT_TYPES.iter().copied().chain([
        "GraphqlPropertyOption",
        "GraphqlPropertyDefinition",
        "GraphqlActivityEvent",
        "GraphqlFavorite",
        "GraphqlSavedView",
        "GraphqlProperty",
    ]) {
        let mut after = None;
        loop {
            let keys = engine
                .storage()
                .projection_keys(typename, after.as_deref(), PAGE)
                .await
                .map_err(EngineError::Storage)?;
            scanned += keys.len();
            let Some(last) = keys.last() else {
                break;
            };
            after = Some(last.id().unwrap_or_default().to_owned());
            let records = engine
                .storage()
                .get_batch(&keys)
                .await
                .map_err(EngineError::Storage)?;
            let entries = keys
                .into_iter()
                .zip(records)
                .map(|(key, record)| (key, record.unwrap_or_default()))
                .collect::<Vec<_>>();
            let remove = selected_keys(engine, &entries, BTreeMap::new()).await?;
            if !remove.is_empty() {
                delete(engine, remove.into_iter().collect()).await?;
            }
        }
    }
    tracing::Span::current().record("crm.access.scanned", scanned as i64);
    Ok(())
}
