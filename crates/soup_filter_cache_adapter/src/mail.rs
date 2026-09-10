//! Canonical email facts and revision-bound pagination over synchronized Mail.
use super::*;
use cache_core::{
    engine::{Engine, EngineError},
    normalize::normalize,
    predicate::{PredicateIndexStorage, ProjectionState},
    store::Storage,
    value::{CacheValue, EntityKey, Record},
};
use item_filter_index::mail as vocabulary;
use predicate_index::{ExactFact, IntegerFact};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

#[cfg(all(test, not(target_arch = "wasm32")))]
mod test;

const TYPE: &str = "GraphqlSoupEmailThread";
const FIELDS: &[&str] = &[
    "linkId",
    "isRead",
    "inboxVisible",
    "isSignal",
    "hasNonTrashedMessages",
    "latestInboundMessageTs",
    "latestNonSpamMessageTs",
    "updatedAt",
];
fn error(e: impl std::fmt::Display) -> SoupFilterCacheAdapterError {
    SoupFilterCacheAdapterError(e.to_string())
}
fn string<'a>(r: &'a Record, field: &str) -> Option<&'a str> {
    match r.fields.get(field)? {
        CacheValue::String(s) => Some(s),
        _ => None,
    }
}
fn timestamp(r: &Record, field: &str) -> Option<Option<i64>> {
    match r.fields.get(field)? {
        CacheValue::Null => Some(None),
        CacheValue::String(s) => chrono::DateTime::parse_from_rfc3339(s)
            .ok()
            .map(|ts| Some(ts.timestamp_micros())),
        _ => None,
    }
}
fn bool_fact(r: &Record, field: &str, attribute: &str) -> Option<ExactFact> {
    let CacheValue::Bool(value) = r.fields.get(field)? else {
        return None;
    };
    Some(ExactFact {
        attribute: vocabulary::token(attribute),
        value: ExactValue::new([u8::from(*value)]).ok()?,
    })
}
fn uuid_fact(attribute: &str, value: &str) -> Option<ExactFact> {
    Some(ExactFact {
        attribute: vocabulary::token(attribute),
        value: ExactValue::new(uuid::Uuid::parse_str(value).ok()?.as_bytes()).ok()?,
    })
}
fn project(key: RecordKey, record: &Record) -> Option<IndexDocument> {
    let id = key.as_str().strip_prefix(&format!("{TYPE}:"))?;
    let facts = vec![
        uuid_fact("id", id)?,
        uuid_fact("mail-link-id", string(record, "linkId")?)?,
        bool_fact(record, "isRead", "mail-read")?,
        bool_fact(record, "inboxVisible", "mail-inbox")?,
        bool_fact(record, "isSignal", "mail-signal")?,
        bool_fact(record, "hasNonTrashedMessages", "mail-has-message")?,
    ];
    let updated = timestamp(record, "updatedAt")??;
    let all = timestamp(record, "latestNonSpamMessageTs")?.unwrap_or(updated);
    let mut times = vec![IntegerFact {
        attribute: vocabulary::token("mail-all-ts"),
        value: all,
    }];
    if let Some(inbound) = timestamp(record, "latestInboundMessageTs")? {
        times.push(IntegerFact {
            attribute: vocabulary::token("mail-inbox-ts"),
            value: inbound,
        });
    }
    Some(IndexDocument {
        record_key: key,
        profile: vocabulary::profile(),
        partition: vocabulary::partition(),
        exact_facts: facts,
        integer_facts: times.clone(),
        sort_facts: times,
    })
}

fn canonical_preview(
    selections: &[Selection],
    variables: &Map<String, Value>,
) -> Result<bool, SoupFilterCacheAdapterError> {
    fn addresses(value: &Value) -> bool {
        match value {
            Value::Object(object) => object.iter().any(|(key, value)| {
                matches!(key.as_str(), "sender" | "recipient" | "cc" | "bcc") || addresses(value)
            }),
            Value::Array(values) => values.iter().any(addresses),
            _ => false,
        }
    }
    for selection in selections {
        let children = match selection {
            Selection::Field(field) => {
                if field.name == "soup" {
                    let args =
                        cache_core::document::resolve_args(field, variables).map_err(error)?;
                    if let Some(input) = args.get("input").and_then(|input| {
                        input.get("initial").or_else(|| input.get("continuation"))
                    }) && (input
                        .get("emailView")
                        .and_then(Value::as_str)
                        .is_some_and(|view| !matches!(view, "ALL" | "INBOX"))
                        || input
                            .get("filters")
                            .and_then(|filters| filters.get("emailFilter"))
                            .is_some_and(addresses))
                    {
                        return Ok(false);
                    }
                }
                &field.selection_set
            }
            Selection::Fragment { selection_set, .. } => selection_set,
        };
        if !canonical_preview(children, variables)? {
            return Ok(false);
        }
    }
    Ok(true)
}

/// Compose full canonical snapshots, or bounded patches preserving completeness.
/// Unsupported preview views invalidate Mail projection rather than displaying a
/// SENT/DRAFTS-specific preview as the canonical ALL/INBOX preview offline.
pub async fn projection_updates<S: Storage>(
    storage: &S,
    query: &str,
    operation: Option<&str>,
    variables: &Map<String, Value>,
    data: &Value,
) -> Result<Vec<ProjectionMutation>, SoupFilterCacheAdapterError> {
    projection_updates_for_write(storage, query, operation, variables, data, true).await
}

/// Prepare Mail facts without consulting the old user's records when the write
/// will reset cache identity. Complete incoming snapshots remain projectable;
/// partial incoming rows remain incomplete instead of borrowing old metadata.
/// The cache engine, not this adapter, performs the actual identity reset.
pub async fn projection_updates_for_write<S: Storage>(
    storage: &S,
    query: &str,
    operation: Option<&str>,
    variables: &Map<String, Value>,
    data: &Value,
    reuse_stored_identity: bool,
) -> Result<Vec<ProjectionMutation>, SoupFilterCacheAdapterError> {
    let parsed = Document::parse(query).map_err(error)?;
    let op = parsed.operation(operation).map_err(error)?;
    let updates = normalize(op, variables, data)
        .map_err(error)?
        .into_iter()
        .filter(|(key, record)| {
            key.as_ref().starts_with(&format!("{TYPE}:"))
                && FIELDS
                    .iter()
                    .any(|field| record.fields.contains_key(*field))
        })
        .collect::<Vec<_>>();
    if updates.is_empty() {
        return Ok(vec![]);
    }
    let keys = updates
        .iter()
        .map(|(key, _)| key.clone())
        .collect::<Vec<_>>();
    let bases = if reuse_stored_identity {
        storage.get_batch(&keys).await.map_err(error)?
    } else {
        vec![None; keys.len()]
    };
    let supported_view = canonical_preview(&op.selection_set, variables)?;
    Ok(updates
        .into_iter()
        .zip(bases)
        .filter_map(|((key, update), base)| {
            let key = RecordKey::new(key.to_string()).ok()?;
            let full = FIELDS
                .iter()
                .all(|field| update.fields.contains_key(*field));
            let changed = update.fields.keys().cloned().collect::<HashSet<_>>();
            let mut merged = base.unwrap_or_default();
            merged.merge(update);
            let incomplete = || ProjectionMutation::MarkIncomplete {
                record_key: key.clone(),
                profile: vocabulary::profile(),
                partition: vocabulary::partition(),
                kind: ProjectionIncompleteKind::Missing,
            };
            if !supported_view {
                return Some(incomplete());
            }
            let Some(document) = project(key.clone(), &merged) else {
                return Some(incomplete());
            };
            if full {
                return Some(ProjectionMutation::Replace(document));
            }
            // Sort patches cannot express deletion. Suppress this projection until
            // a full snapshot arrives rather than retaining a cleared inbox timestamp.
            if changed.contains("latestInboundMessageTs")
                && timestamp(&merged, "latestInboundMessageTs") == Some(None)
            {
                return Some(incomplete());
            }
            let affected = |attribute: &str| match attribute {
                "mail-link-id" => changed.contains("linkId"),
                "mail-read" => changed.contains("isRead"),
                "mail-inbox" => changed.contains("inboxVisible"),
                "mail-signal" => changed.contains("isSignal"),
                "mail-has-message" => changed.contains("hasNonTrashedMessages"),
                "mail-all-ts" => {
                    changed.contains("latestNonSpamMessageTs") || changed.contains("updatedAt")
                }
                "mail-inbox-ts" => changed.contains("latestInboundMessageTs"),
                _ => false,
            };
            let exact = document
                .exact_facts
                .into_iter()
                .filter(|fact| affected(fact.attribute.as_str()))
                .map(|fact| ExactAttributePatch {
                    attribute: fact.attribute,
                    values: vec![fact.value],
                })
                .collect();
            let integers = ["mail-all-ts", "mail-inbox-ts"]
                .into_iter()
                .filter(|attr| affected(attr))
                .map(|attr| predicate_index::IntegerAttributePatch {
                    attribute: vocabulary::token(attr),
                    values: document
                        .integer_facts
                        .iter()
                        .filter(|fact| fact.attribute == vocabulary::token(attr))
                        .map(|fact| fact.value)
                        .collect(),
                })
                .collect();
            Some(ProjectionMutation::Patch {
                record_key: key,
                profile: vocabulary::profile(),
                partition: vocabulary::partition(),
                exact,
                integers,
                sorts: document
                    .sort_facts
                    .into_iter()
                    .filter(|fact| affected(fact.attribute.as_str()))
                    .collect(),
            })
        })
        .collect())
}

/// Email optimism patches only a known authoritative base; it cannot prove
/// message eligibility or invent a complete mailbox projection for a new row.
pub fn optimistic_updates(updates: Vec<ProjectionMutation>) -> Vec<OptimisticProjectionMutation> {
    updates
        .into_iter()
        .map(|update| match update {
            ProjectionMutation::Patch {
                record_key,
                profile,
                partition,
                exact,
                integers,
                sorts,
            } => OptimisticProjectionMutation::Patch {
                record_key,
                profile,
                partition,
                exact,
                integers,
                sorts,
            },
            ProjectionMutation::Replace(document) => OptimisticProjectionMutation::Patch {
                record_key: document.record_key,
                profile: document.profile,
                partition: document.partition,
                exact: document
                    .exact_facts
                    .into_iter()
                    .map(|f| ExactAttributePatch {
                        attribute: f.attribute,
                        values: vec![f.value],
                    })
                    .collect(),
                integers: document
                    .integer_facts
                    .into_iter()
                    .map(|f| predicate_index::IntegerAttributePatch {
                        attribute: f.attribute,
                        values: vec![f.value],
                    })
                    .collect(),
                sorts: document.sort_facts,
            },
            ProjectionMutation::MarkIncomplete {
                record_key,
                profile,
                partition,
                ..
            } => OptimisticProjectionMutation::Unknown {
                record_key,
                profile,
                partition,
                affected_attributes: vec![],
            },
            _ => unreachable!("Mail projection update family"),
        })
        .collect()
}

/// Invalidate canonical Mail facts when a thread is invalidated externally.
pub fn dirty_updates(keys: &[String]) -> Vec<ProjectionMutation> {
    keys.iter()
        .filter(|key| key.starts_with(&format!("{TYPE}:")))
        .filter_map(|key| {
            Some(ProjectionMutation::MarkIncomplete {
                record_key: RecordKey::new(key.clone()).ok()?,
                profile: vocabulary::profile(),
                partition: vocabulary::partition(),
                kind: ProjectionIncompleteKind::Dirty,
            })
        })
        .collect()
}

/// A browser-engine generation identity, distinct from its reusable revision counter.
pub fn new_generation() -> String {
    uuid::Uuid::new_v4().to_string()
}

/// Explicit Mail local-page request. Never translates a server cursor.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PageRequest {
    /// ALL or INBOX.
    pub view: String,
    /// Opaque revision/query-bound local continuation.
    pub cursor: Option<String>,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Cursor {
    generation: String,
    revision: String,
    query: String,
    key: RecordKey,
    value: i64,
}

/// Local Mail results are complete only over known cached projections, not the mailbox.
#[derive(Serialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum PageResult {
    /// Matching cached email keys and an exclusive continuation.
    MailPage {
        /// Effective cache revision.
        revision: String,
        /// Normalized matching email keys.
        keys: Vec<String>,
        /// View-correct display timestamps, aligned with keys.
        sort_timestamps: Vec<String>,
        /// Query/revision-bound local continuation.
        next_cursor: Option<String>,
        /// Whether queued optimistic work contributes to this page.
        optimistic: bool,
    },
    /// Query is beyond the first Mail slice.
    Unsupported,
    /// The identity-scoped readable-account catalog has not been cached yet.
    Incomplete {
        /// Revision whose catalog is unavailable.
        revision: String,
    },
    /// Generation, revision or query changed. Restart at page one.
    StaleCursor {
        /// Current revision to restart from.
        revision: String,
    },
}

/// Mail page failures retain typed engine/storage errors for host recovery.
#[derive(Debug, thiserror::Error)]
pub enum PageError<S: std::error::Error + 'static> {
    /// Cache failure, including storage errors that may require a physical reset.
    #[error(transparent)]
    Engine(#[from] EngineError<S>),
    /// Invalid request or unsupported projection evidence.
    #[error(transparent)]
    Adapter(#[from] SoupFilterCacheAdapterError),
}

/// Evaluate a bounded local page without requiring this query to have a server baseline.
pub async fn page<S: PredicateIndexStorage>(
    engine: &mut Engine<S>,
    generation: &str,
    filters: Value,
    sort_method: &str,
    direction: &str,
    limit: u16,
    request: PageRequest,
) -> Result<PageResult, PageError<S::Error>> {
    let revision = engine.current_revision().to_string();
    if limit == 0 || limit >= predicate_index::MAX_QUERY_LIMIT {
        return Err(error(format!(
            "Mail page limit must be 1..{}",
            predicate_index::MAX_QUERY_LIMIT - 1
        ))
        .into());
    }
    let Some(viewer) = engine.current_identity().await? else {
        return Ok(PageResult::Incomplete { revision });
    };
    let user = EntityKey(format!("GraphqlUser:{viewer}").into());
    let records = engine
        .storage()
        .get_batch(&[user])
        .await
        .map_err(EngineError::Storage)?;
    let Some(Some(record)) = records.first() else {
        return Ok(PageResult::Incomplete { revision });
    };
    let Some(CacheValue::List(links)) = record.fields.get("emailLinks") else {
        return Ok(PageResult::Incomplete { revision });
    };
    let links = links
        .iter()
        .map(|value| match value {
            CacheValue::Ref(key) => {
                uuid::Uuid::parse_str(key.as_ref().strip_prefix("GraphqlEmailLink:")?).ok()
            }
            _ => None,
        })
        .collect::<Option<Vec<_>>>();
    let Some(links) = links else {
        return Ok(PageResult::Incomplete { revision });
    };
    let ast = materialize_graphql_filter(filters).map_err(error)?;
    let sort = match sort_method {
        "CREATED_AT" => SoupIndexSort::CreatedAt,
        "UPDATED_AT" => SoupIndexSort::UpdatedAt,
        _ => SoupIndexSort::Unsupported,
    };
    let direction = match direction {
        "ASC" => SortDirection::Asc,
        "DESC" => SortDirection::Desc,
        _ => return Err(error("invalid sort direction").into()),
    };
    let outcome = vocabulary::compile(
        &ast,
        SoupFlatRequest {
            sort,
            direction,
            limit: limit + 1,
            has_cursor: false,
        },
        &request.view,
        &links,
    )
    .map_err(error)?;
    let LocalCompileOutcome::Supported(mut query) = outcome else {
        return Ok(PageResult::Unsupported);
    };
    let fingerprint = uuid::Uuid::new_v5(
        &uuid::Uuid::NAMESPACE_OID,
        serde_json::to_string(&query).map_err(error)?.as_bytes(),
    )
    .to_string();
    if let Some(cursor) = request.cursor {
        if cursor.len() > 4096 {
            return Err(error("oversized Mail cursor").into());
        }
        let cursor: Cursor = serde_json::from_str(&cursor).map_err(error)?;
        if cursor.generation != generation
            || cursor.revision != revision
            || cursor.query != fingerprint
        {
            return Ok(PageResult::StaleCursor { revision });
        }
        query = query.after(cursor.value, cursor.key).map_err(error)?;
    }
    // Unknown rows never become fabricated matches; the UI labels this cached mail.
    let result = engine.reconcile_predicate_index(&query, &[]).await?;
    let mut keys = result.value.keys;
    let more = keys.len() > usize::from(limit);
    keys.truncate(usize::from(limit));
    let bases = engine
        .storage()
        .load_projection_states(&keys)
        .await
        .map_err(EngineError::Storage)?;
    let shadows = engine
        .storage()
        .load_optimistic_projections(&keys)
        .await
        .map_err(EngineError::Storage)?;
    let values = bases
        .iter()
        .zip(&shadows)
        .map(|(base, shadow)| {
            let document = match shadow.as_ref().map(|shadow| &shadow.state) {
                Some(predicate_index::OptimisticProjectionState::Complete(doc)) => Some(doc),
                Some(_) => None,
                None => match base {
                    Some(ProjectionState::Complete(doc)) => Some(doc),
                    _ => None,
                },
            }
            .ok_or_else(|| error("page has no complete sort evidence"))?;
            document
                .sort_facts
                .iter()
                .find(|fact| fact.attribute == query.as_query().sort_attribute)
                .map(|fact| fact.value)
                .ok_or_else(|| error("missing page sort"))
        })
        .collect::<Result<Vec<_>, _>>()?;
    let sort_timestamps = values
        .iter()
        .map(|value| {
            chrono::DateTime::from_timestamp_micros(*value)
                .map(|ts| ts.to_rfc3339())
                .ok_or_else(|| error("invalid page timestamp"))
        })
        .collect::<Result<Vec<_>, _>>()?;
    let next_cursor = if more {
        Some(
            serde_json::to_string(&Cursor {
                generation: generation.into(),
                revision: revision.clone(),
                query: fingerprint,
                key: keys.last().expect("nonempty page").clone(),
                value: *values.last().expect("page has sort evidence"),
            })
            .map_err(error)?,
        )
    } else {
        None
    };
    Ok(PageResult::MailPage {
        revision,
        keys: keys
            .into_iter()
            .map(|key| key.as_str().to_owned())
            .collect(),
        sort_timestamps,
        next_cursor,
        optimistic: result.value.optimistic,
    })
}
