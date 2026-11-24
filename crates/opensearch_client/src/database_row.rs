//! The `database_rows` index: one document per row of a Macro database.
//!
//! Every write and delete by id carries the row's table version as an
//! `external_gte` version, so the index refuses a state older than the one
//! it holds. Such a refusal is not an error: a newer state is already there.

use models_opensearch::{SearchIndex, database_row::DatabaseRowDocument};
use serde_json::json;
use uuid::Uuid;

use crate::{
    OpensearchClient, Result,
    error::{OpensearchClientError, OpensearchOperation, write_refusal},
    retry::resend_on_lost_connection,
    upsert::REPORTED_ITEM_ERRORS,
};

/// One change to the index.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DatabaseRowWrite {
    /// Index the row as the document says, unless a newer version is indexed.
    Upsert(DatabaseRowDocument),
    /// Remove the row, unless a version newer than `table_version` is indexed.
    Delete {
        /// The row.
        row_id: Uuid,
        /// The table version at which the row was found gone.
        table_version: i64,
    },
}

/// What a batch of [`DatabaseRowWrite`]s did.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct DatabaseRowWrites {
    /// Writes and deletes applied.
    pub applied: usize,
    /// Writes and deletes refused because the index holds a newer version.
    pub superseded: usize,
}

/// A row document as the reconcile pages through the index.
#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize)]
pub struct IndexedDatabaseRow {
    /// The row.
    pub row_id: Uuid,
    /// The database holding it.
    pub database_id: Uuid,
    /// The table version the document reflects.
    pub table_version: i64,
}

/// Which documents a scoped delete removes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DatabaseRowScope {
    /// Every row of a database.
    Database(Uuid),
    /// Every row of a table.
    Table(Uuid),
    /// The rows of a table indexed at a version older than `version`.
    TableOlderThan {
        /// The table.
        table_id: Uuid,
        /// Documents below this version are removed.
        version: i64,
    },
}

const INDEX: SearchIndex = SearchIndex::DatabaseRows;

impl OpensearchClient {
    /// Apply `writes` in one bulk request.
    #[tracing::instrument(skip_all, fields(writes = writes.len()), err)]
    pub async fn write_database_rows(
        &self,
        writes: &[DatabaseRowWrite],
    ) -> Result<DatabaseRowWrites> {
        if writes.is_empty() {
            return Ok(DatabaseRowWrites::default());
        }
        resend_on_lost_connection(|| write_rows(&self.inner, INDEX.as_ref(), writes)).await
    }

    /// Remove every document `scope` names, returning how many went. A
    /// document written at a newer version while the delete runs stays.
    #[tracing::instrument(skip(self), err)]
    pub async fn delete_database_rows(&self, scope: DatabaseRowScope) -> Result<u64> {
        resend_on_lost_connection(|| delete_rows(&self.inner, INDEX.as_ref(), scope)).await
    }

    /// One page of indexed rows in row id order, after `after_row_id`.
    #[tracing::instrument(skip(self), err)]
    pub async fn page_database_rows(
        &self,
        after_row_id: Option<Uuid>,
        size: usize,
    ) -> Result<Vec<IndexedDatabaseRow>> {
        resend_on_lost_connection(|| page_rows(&self.inner, INDEX.as_ref(), after_row_id, size))
            .await
    }
}

/// The bulk body: an action line per write, and the document after each upsert.
pub(crate) fn bulk_body(writes: &[DatabaseRowWrite]) -> Result<Vec<String>> {
    let serialize = |value: &serde_json::Value| {
        serde_json::to_string(value).map_err(|error| OpensearchClientError::SerializationFailed {
            details: error.to_string(),
            operation: OpensearchOperation::WriteDatabaseRows,
        })
    };

    let mut body = Vec::with_capacity(writes.len() * 2);
    for write in writes {
        match write {
            DatabaseRowWrite::Upsert(document) => {
                body.push(serialize(&json!({"index": {
                    "_id": document.row_id,
                    "version": document.table_version,
                    "version_type": "external_gte",
                }}))?);
                let document = serde_json::to_value(document).map_err(|error| {
                    OpensearchClientError::SerializationFailed {
                        details: error.to_string(),
                        operation: OpensearchOperation::WriteDatabaseRows,
                    }
                })?;
                body.push(serialize(&document)?);
            }
            DatabaseRowWrite::Delete {
                row_id,
                table_version,
            } => {
                body.push(serialize(&json!({"delete": {
                    "_id": row_id,
                    "version": table_version,
                    "version_type": "external_gte",
                }}))?);
            }
        }
    }
    Ok(body)
}

/// Read a bulk answer item by item. A version conflict means the index holds
/// a newer state and a delete of a missing document has nothing to do; both
/// are done. Any other failed item fails the call.
pub(crate) fn classify_bulk_answer(status: u16, body: &str) -> Result<DatabaseRowWrites> {
    let operation = OpensearchOperation::WriteDatabaseRows;
    let parsed = serde_json::from_str::<serde_json::Value>(body);

    if !(200..300).contains(&status) {
        let error = parsed
            .map(|value| value["error"].clone())
            .unwrap_or_default();
        if let Some(cause) = write_refusal(status, &error) {
            return Err(OpensearchClientError::WritesRefused {
                details: body.to_owned(),
                cause,
                operation,
            });
        }
        return Err(OpensearchClientError::Unknown {
            details: body.to_owned(),
            operation,
        });
    }

    let answer = parsed.map_err(|error| OpensearchClientError::DeserializationFailed {
        details: error.to_string(),
        operation,
    })?;
    let items =
        answer["items"]
            .as_array()
            .ok_or_else(|| OpensearchClientError::DeserializationFailed {
                details: "bulk response has no items array".to_owned(),
                operation,
            })?;

    let mut writes = DatabaseRowWrites::default();
    let mut failed = 0;
    let mut refusal = None;
    let mut errors: Vec<String> = Vec::new();
    for item in items {
        let Some((action, result)) = item.as_object().and_then(|item| item.iter().next()) else {
            failed += 1;
            continue;
        };
        let status = result["status"].as_u64().unwrap_or_default();
        let error = &result["error"];
        let conflict = error["type"].as_str() == Some("version_conflict_engine_exception");
        let already_gone = action == "delete" && result["result"].as_str() == Some("not_found");

        if (200..300).contains(&status) || already_gone {
            writes.applied += 1;
            continue;
        }
        if conflict {
            writes.superseded += 1;
            continue;
        }

        failed += 1;
        refusal = refusal.or(write_refusal(
            u16::try_from(status).unwrap_or_default(),
            error,
        ));
        let described = format!(
            "{}: {}",
            error["type"].as_str().unwrap_or("unknown"),
            error["reason"].as_str().unwrap_or_default()
        );
        if errors.len() < REPORTED_ITEM_ERRORS && !errors.contains(&described) {
            errors.push(described);
        }
    }

    if failed > 0 {
        return Err(OpensearchClientError::BulkItemsFailed {
            failed,
            total: items.len(),
            refusal,
            errors,
            operation,
        });
    }
    Ok(writes)
}

pub(crate) async fn write_rows(
    client: &opensearch::OpenSearch,
    index: &str,
    writes: &[DatabaseRowWrite],
) -> Result<DatabaseRowWrites> {
    let operation = OpensearchOperation::WriteDatabaseRows;
    let response = client
        .bulk(opensearch::BulkParts::Index(index))
        // Never let a write create an index under the alias name.
        .require_alias(true)
        .body(bulk_body(writes)?)
        .send()
        .await
        .map_err(|error| OpensearchClientError::request_failed(operation, &error))?;

    let status = response.status_code().as_u16();
    let body = response
        .text()
        .await
        .map_err(|error| OpensearchClientError::deserialization_failed(operation, &error))?;
    classify_bulk_answer(status, &body)
}

pub(crate) fn scope_query(scope: DatabaseRowScope) -> serde_json::Value {
    match scope {
        DatabaseRowScope::Database(database_id) => {
            json!({"term": {"database_id": database_id}})
        }
        DatabaseRowScope::Table(table_id) => json!({"term": {"table_id": table_id}}),
        DatabaseRowScope::TableOlderThan { table_id, version } => json!({"bool": {"filter": [
            {"term": {"table_id": table_id}},
            {"range": {"table_version": {"lt": version}}},
        ]}}),
    }
}

/// Delete every document `scope` matches, a page at a time, each by id
/// with an `external_gte` version (see [`delete_version`]).
///
/// Not a delete-by-query: that deletes with internal versioning, which bumps
/// the version the tombstone keeps, so the index would refuse the same row
/// written again at its unchanged table version (a database restored right
/// after it was trashed) until the tombstone expires. A document written at
/// a newer version meanwhile is refused the delete and stays. Refreshes
/// first so the search reaches documents written a moment ago.
pub(crate) async fn delete_rows(
    client: &opensearch::OpenSearch,
    index: &str,
    scope: DatabaseRowScope,
) -> Result<u64> {
    let operation = OpensearchOperation::DeleteDatabaseRowScope;
    let refreshed = client
        .indices()
        .refresh(opensearch::indices::IndicesRefreshParts::Index(&[index]))
        .send()
        .await
        .map_err(|error| OpensearchClientError::request_failed(operation, &error))?;
    if !refreshed.status_code().is_success() {
        let body = refreshed
            .text()
            .await
            .map_err(|error| OpensearchClientError::deserialization_failed(operation, &error))?;
        return Err(OpensearchClientError::Unknown {
            details: body,
            operation,
        });
    }

    let mut deleted = 0;
    let mut after = None;
    loop {
        let page = search_rows(client, index, scope_query(scope), after, DELETE_PAGE_SIZE).await?;
        let Some(last) = page.last() else {
            break;
        };
        after = Some(last.row_id);
        let deletes: Vec<DatabaseRowWrite> = page
            .iter()
            .map(|row| DatabaseRowWrite::Delete {
                row_id: row.row_id,
                table_version: delete_version(scope, row),
            })
            .collect();
        deleted += write_rows(client, index, &deletes).await?.applied;
    }
    Ok(u64::try_from(deleted).unwrap_or(u64::MAX))
}

const DELETE_PAGE_SIZE: usize = 500;

/// The version a scoped delete removes a document at.
///
/// A whole database or table goes at each document's own version, so the
/// same rows written again at their unchanged version (a restore) land. The
/// rows of a table below a version are rows a full pass found gone at that
/// version, so they go at it: a pass that read one of them earlier and
/// writes it late is refused instead of bringing it back.
fn delete_version(scope: DatabaseRowScope, row: &IndexedDatabaseRow) -> i64 {
    match scope {
        DatabaseRowScope::Database(_) | DatabaseRowScope::Table(_) => row.table_version,
        DatabaseRowScope::TableOlderThan { version, .. } => version,
    }
}

pub(crate) async fn page_rows(
    client: &opensearch::OpenSearch,
    index: &str,
    after_row_id: Option<Uuid>,
    size: usize,
) -> Result<Vec<IndexedDatabaseRow>> {
    search_rows(client, index, json!({"match_all": {}}), after_row_id, size).await
}

/// One page of the documents `query` matches, in row id order.
async fn search_rows(
    client: &opensearch::OpenSearch,
    index: &str,
    query: serde_json::Value,
    after_row_id: Option<Uuid>,
    size: usize,
) -> Result<Vec<IndexedDatabaseRow>> {
    let operation = OpensearchOperation::PageDatabaseRows;
    let mut body = json!({
        "size": size,
        "query": query,
        "sort": [{"row_id": "asc"}],
        "_source": ["row_id", "database_id", "table_version"],
    });
    if let Some(after) = after_row_id {
        body["search_after"] = json!([after]);
    }

    let response = client
        .search(opensearch::SearchParts::Index(&[index]))
        .allow_partial_search_results(false)
        .body(body)
        .send()
        .await
        .map_err(|error| OpensearchClientError::request_failed(operation, &error))?;
    let status = response.status_code();
    let text = response
        .text()
        .await
        .map_err(|error| OpensearchClientError::deserialization_failed(operation, &error))?;
    if !status.is_success() {
        return Err(OpensearchClientError::Unknown {
            details: text,
            operation,
        });
    }

    let answer: serde_json::Value = serde_json::from_str(&text).map_err(|error| {
        OpensearchClientError::DeserializationFailed {
            details: error.to_string(),
            operation,
        }
    })?;
    complete_page(&answer)?
        .iter()
        .map(|hit| {
            serde_json::from_value(hit["_source"].clone()).map_err(|error| {
                OpensearchClientError::DeserializationFailed {
                    details: error.to_string(),
                    operation,
                }
            })
        })
        .collect()
}

/// The hits of a page every shard answered in time. A partial page would
/// let a caller page past rows a failed shard holds, or read an empty page
/// as the end.
pub(crate) fn complete_page(answer: &serde_json::Value) -> Result<&Vec<serde_json::Value>> {
    let operation = OpensearchOperation::PageDatabaseRows;
    let failed_shards = answer["_shards"]["failed"].as_u64().unwrap_or_default();
    if answer["timed_out"].as_bool() == Some(true) || failed_shards > 0 {
        return Err(OpensearchClientError::Unknown {
            details: format!(
                "incomplete page: timed_out={}, failed shards={failed_shards}",
                answer["timed_out"]
            ),
            operation,
        });
    }
    answer["hits"]["hits"]
        .as_array()
        .ok_or_else(|| OpensearchClientError::DeserializationFailed {
            details: "search response has no hits array".to_owned(),
            operation,
        })
}

#[cfg(test)]
mod test;
