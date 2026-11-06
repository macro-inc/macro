//! Reports machine lifecycle transitions to the rest of the product, exactly
//! as the Durable Object does (`sync-service/src/inbound/sync_service.rs`):
//!
//! - `FirstJoin`  → DSS interaction only.
//! - `Edited`     → shallow snapshot to DSS + search reindex, then the
//!   interaction.
//! - `LastLeave`  → same as `Edited` (the DO re-publishes state when everyone
//!   leaves), then the interaction.
//!
//! Everything is fire-and-forget from the host loop's perspective: reporting
//! must never block or fail document sync, so each report runs in its own
//! task and failures are logged.

use crate::native::store::PgSyncStore;
use serde::Serialize;
use sync_machine::model::{DocId, Lifecycle};
use tracing::warn;

/// DSS internal-endpoint auth header (matches the wasm service's constant).
const DSS_AUTH_HEADER: &str = "x-document-storage-service-auth-key";
/// Shared internal-service auth header, validated by SPS's `InternalOnly`.
const INTERNAL_AUTH_HEADER: &str = "x-internal-auth-key";

/// Body for `PUT /internal/documents/{id}/interaction`.
#[derive(Serialize)]
struct InteractionRequest {
    reason: InteractionReason,
}

/// Mirrors the DSS endpoint's expected `reason` values.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
enum InteractionReason {
    FirstJoin,
    Edited,
    LastLeave,
}

impl From<Lifecycle> for InteractionReason {
    fn from(event: Lifecycle) -> Self {
        match event {
            Lifecycle::FirstJoin => Self::FirstJoin,
            Lifecycle::Edited => Self::Edited,
            Lifecycle::LastLeave => Self::LastLeave,
        }
    }
}

/// See the module docs.
#[derive(Clone)]
pub struct LifecycleReporter {
    client: reqwest::Client,
    document_storage_service_url: String,
    document_storage_service_auth_key: String,
    search_processing_service_url: String,
    internal_api_key: String,
    /// Snapshot source for the shallow-snapshot publication.
    store: PgSyncStore,
}

impl LifecycleReporter {
    /// Bundle the endpoints and credentials the reports need.
    pub fn new(
        document_storage_service_url: String,
        document_storage_service_auth_key: String,
        search_processing_service_url: String,
        internal_api_key: String,
        store: PgSyncStore,
    ) -> Self {
        Self {
            client: reqwest::Client::new(),
            document_storage_service_url,
            document_storage_service_auth_key,
            search_processing_service_url,
            internal_api_key,
            store,
        }
    }

    /// Report `event` for `doc` in a background task.
    pub fn report(&self, doc: DocId, event: Lifecycle) {
        let reporter = self.clone();
        tokio::spawn(async move {
            // State publication first, interaction second — the DO's order.
            if matches!(event, Lifecycle::Edited | Lifecycle::LastLeave) {
                reporter.publish_document_state(&doc).await;
            }
            reporter.publish_interaction(&doc, event.into()).await;
        });
    }

    /// Push the stored snapshot to DSS and poke the search reindex.
    ///
    /// The snapshot is read back from Postgres, so on `LastLeave` it may lag
    /// the live replica by the uncompacted tail; the idle compaction that
    /// follows emits `Edited` and re-publishes the settled bytes.
    async fn publish_document_state(&self, doc: &DocId) {
        let snapshot = match self.store.load(doc.as_str()).await {
            Ok((Some(snapshot), _, _)) => snapshot,
            Ok((None, _, _)) => return, // nothing compacted yet
            Err(error) => {
                warn!(error = ?error, doc = doc.as_str(), "snapshot read for DSS publish failed");
                return;
            }
        };

        let url = format!(
            "{}/internal/documents/{}/snapshot",
            self.document_storage_service_url,
            doc.as_str()
        );
        self.client
            .put(url)
            .header(DSS_AUTH_HEADER, &self.document_storage_service_auth_key)
            .header("Content-Type", "application/octet-stream")
            .body(snapshot)
            .send()
            .await
            .and_then(|response| response.error_for_status())
            .map(drop)
            .inspect_err(|error| {
                warn!(error = ?error, doc = doc.as_str(), "DSS snapshot upload failed");
            })
            .ok();

        let url = format!(
            "{}/internal/extract_sync",
            self.search_processing_service_url
        );
        self.client
            .post(url)
            .header(INTERNAL_AUTH_HEADER, &self.internal_api_key)
            .json(&serde_json::json!({
                "documents": [{ "document_id": doc.as_str(), "file_type": "md" }]
            }))
            .send()
            .await
            .and_then(|response| response.error_for_status())
            .map(drop)
            .inspect_err(|error| {
                warn!(error = ?error, doc = doc.as_str(), "search reindex request failed");
            })
            .ok();
    }

    /// Report the join/leave/edit interaction to DSS.
    async fn publish_interaction(&self, doc: &DocId, reason: InteractionReason) {
        let url = format!(
            "{}/internal/documents/{}/interaction",
            self.document_storage_service_url,
            doc.as_str()
        );
        self.client
            .put(url)
            .header(DSS_AUTH_HEADER, &self.document_storage_service_auth_key)
            .json(&InteractionRequest { reason })
            .send()
            .await
            .and_then(|response| response.error_for_status())
            .map(drop)
            .inspect_err(|error| {
                warn!(error = ?error, doc = doc.as_str(), reason = ?reason, "DSS interaction report failed");
            })
            .ok();
    }
}
