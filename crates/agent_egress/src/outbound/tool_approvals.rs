//! Held tool calls in Postgres, and the NOTIFY that wakes their holds.
//!
//! A resolution is an `UPDATE ... WHERE status = 'pending'` that notifies in
//! the same statement, so the row and the wake-up cannot disagree: a hold on
//! any replica hears about a resolution made on any other, and re-reads the
//! row to learn what it was.

use std::sync::Arc;

use agent_runtime_protocol::domain::action::AgentActionId;
use agent_runtime_protocol::domain::tool_approval::ToolApprovalStatus;
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use sqlx::PgPool;
use sqlx::postgres::PgListener;
use tokio::sync::broadcast;

use crate::domain::approval::{ToolApproval, ToolApprovalId};
use crate::domain::error::EgressError;
use crate::domain::model::AgentSessionId;
use crate::domain::ports::{ToolApprovalSignals, ToolApprovalStore, ToolApprovalSubscription};

/// The channel resolutions are announced on; the payload is the approval id.
pub const TOOL_APPROVAL_CHANNEL: &str = "agent_session_tool_approval";

fn storage(error: impl std::fmt::Display) -> EgressError {
    EgressError::Internal(rootcause::report!("tool approval storage failed: {error}"))
}

struct Row {
    id: Uuid,
    agent_session_id: Uuid,
    turn_action_id: Uuid,
    request_id: serde_json::Value,
    owner_id: MacroUserIdStr<'static>,
    requested_by: Option<MacroUserIdStr<'static>>,
    server_slug: String,
    server_name: String,
    tool_name: String,
    arguments: serde_json::Value,
    status: String,
    resolved_by: Option<MacroUserIdStr<'static>>,
}

impl Row {
    fn into_approval(self) -> Result<ToolApproval, EgressError> {
        Ok(ToolApproval {
            id: ToolApprovalId::from_uuid(self.id),
            session: AgentSessionId::new_from_uuid(self.agent_session_id),
            turn_action_id: AgentActionId::from_uuid(self.turn_action_id),
            request_id: self.request_id,
            owner: self.owner_id,
            requested_by: self.requested_by,
            server_slug: self.server_slug,
            server_name: self.server_name,
            tool_name: self.tool_name,
            arguments: self.arguments,
            status: ToolApprovalStatus::parse(&self.status)
                .ok_or_else(|| storage(format!("unknown status {:?}", self.status)))?,
            resolved_by: self.resolved_by,
        })
    }
}

/// [`ToolApprovalStore`] over the `agent_session_tool_approval` table.
#[derive(Clone)]
pub struct PgToolApprovalStore {
    pool: PgPool,
}

impl PgToolApprovalStore {
    /// Build the store over `pool`.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

impl ToolApprovalStore for PgToolApprovalStore {
    async fn insert(&self, approval: &ToolApproval) -> Result<(), EgressError> {
        sqlx::query!(
            r#"
            INSERT INTO agent_session_tool_approval (
                id, agent_session_id, turn_action_id, request_id, owner_id, requested_by,
                server_slug, server_name, tool_name, arguments, status
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            "#,
            approval.id.as_uuid(),
            approval.session.as_uuid(),
            approval.turn_action_id.as_uuid(),
            approval.request_id,
            approval.owner.as_ref(),
            approval.requested_by.as_ref().map(|user| user.as_ref()),
            approval.server_slug,
            approval.server_name,
            approval.tool_name,
            approval.arguments,
            approval.status.as_str(),
        )
        .execute(&self.pool)
        .await
        .map_err(storage)?;
        Ok(())
    }

    async fn resolve(
        &self,
        id: ToolApprovalId,
        status: ToolApprovalStatus,
        resolved_by: Option<&MacroUserIdStr<'static>>,
    ) -> Result<Option<ToolApproval>, EgressError> {
        let row = sqlx::query_as!(
            Row,
            r#"
            WITH resolved AS (
                UPDATE agent_session_tool_approval
                SET status = $2, resolved_by = $3, resolved_at = now()
                WHERE id = $1 AND status = 'pending'
                RETURNING *
            )
            SELECT
                resolved.id AS "id!",
                resolved.agent_session_id AS "agent_session_id!",
                resolved.turn_action_id AS "turn_action_id!",
                resolved.request_id AS "request_id!",
                resolved.owner_id AS "owner_id!: MacroUserIdStr<'static>",
                resolved.requested_by AS "requested_by: MacroUserIdStr<'static>",
                resolved.server_slug AS "server_slug!",
                resolved.server_name AS "server_name!",
                resolved.tool_name AS "tool_name!",
                resolved.arguments AS "arguments!",
                resolved.status AS "status!",
                resolved.resolved_by AS "resolved_by: MacroUserIdStr<'static>"
            FROM resolved, pg_notify($4, resolved.id::text)
            "#,
            id.as_uuid(),
            status.as_str(),
            resolved_by.map(|user| user.as_ref()),
            TOOL_APPROVAL_CHANNEL,
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(storage)?;
        row.map(Row::into_approval).transpose()
    }

    async fn get(&self, id: ToolApprovalId) -> Result<Option<ToolApproval>, EgressError> {
        let row = sqlx::query_as!(
            Row,
            r#"
            SELECT
                id, agent_session_id, turn_action_id, request_id,
                owner_id AS "owner_id: MacroUserIdStr<'static>",
                requested_by AS "requested_by: MacroUserIdStr<'static>",
                server_slug, server_name, tool_name, arguments, status,
                resolved_by AS "resolved_by: MacroUserIdStr<'static>"
            FROM agent_session_tool_approval
            WHERE id = $1
            "#,
            id.as_uuid(),
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(storage)?;
        row.map(Row::into_approval).transpose()
    }

    async fn pending_for_request(
        &self,
        session: AgentSessionId,
        request_id: &serde_json::Value,
    ) -> Result<Option<ToolApprovalId>, EgressError> {
        let id = sqlx::query_scalar!(
            r#"
            SELECT id FROM agent_session_tool_approval
            WHERE agent_session_id = $1 AND request_id = $2 AND status = 'pending'
            ORDER BY created_at DESC
            LIMIT 1
            "#,
            session.as_uuid(),
            request_id,
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(storage)?;
        Ok(id.map(ToolApprovalId::from_uuid))
    }

    async fn pending_for_session(
        &self,
        session: AgentSessionId,
    ) -> Result<Vec<ToolApprovalId>, EgressError> {
        let ids = sqlx::query_scalar!(
            r#"
            SELECT id FROM agent_session_tool_approval
            WHERE agent_session_id = $1 AND status = 'pending'
            "#,
            session.as_uuid(),
        )
        .fetch_all(&self.pool)
        .await
        .map_err(storage)?;
        Ok(ids.into_iter().map(ToolApprovalId::from_uuid).collect())
    }
}

/// [`ToolApprovalSignals`] over `LISTEN`, fanned out in process.
///
/// One listener connection per process, whatever the number of holds. A
/// dropped connection loses the notifications sent while it was down, which
/// costs a hold no more than its next keepalive: it re-reads the row then.
#[derive(Clone)]
pub struct PgToolApprovalSignals {
    resolved: broadcast::Sender<Uuid>,
}

impl PgToolApprovalSignals {
    /// Start listening. The listener runs until the process exits.
    pub fn spawn(pool: PgPool) -> Self {
        let (resolved, _) = broadcast::channel(256);
        let sender = resolved.clone();
        tokio::spawn(async move {
            loop {
                if let Err(error) = listen(&pool, &sender).await {
                    tracing::warn!(error = %error, "tool approval listener failed; reconnecting");
                }
                tokio::time::sleep(std::time::Duration::from_secs(1)).await;
            }
        });
        Self { resolved }
    }
}

async fn listen(pool: &PgPool, resolved: &broadcast::Sender<Uuid>) -> Result<(), sqlx::Error> {
    let mut listener = PgListener::connect_with(pool).await?;
    listener.listen(TOOL_APPROVAL_CHANNEL).await?;
    loop {
        let notification = listener.recv().await?;
        if let Ok(id) = notification.payload().parse::<Uuid>() {
            // Nobody listening is not an error: no hold is waiting.
            let _ = resolved.send(id);
        }
    }
}

impl ToolApprovalSignals for PgToolApprovalSignals {
    type Subscription = BroadcastSubscription;

    fn subscribe(&self, id: ToolApprovalId) -> BroadcastSubscription {
        BroadcastSubscription {
            id: id.as_uuid(),
            receiver: self.resolved.subscribe(),
        }
    }
}

/// A waiter on one approval id among every resolution the process hears.
pub struct BroadcastSubscription {
    id: Uuid,
    receiver: broadcast::Receiver<Uuid>,
}

impl ToolApprovalSubscription for BroadcastSubscription {
    async fn changed(&mut self) {
        loop {
            match self.receiver.recv().await {
                Ok(id) if id == self.id => return,
                Ok(_) => {}
                // Missed some: this one may be among them.
                Err(broadcast::error::RecvError::Lagged(_)) => return,
                // The listener is gone; the hold's keepalive re-reads.
                Err(broadcast::error::RecvError::Closed) => {
                    std::future::pending::<()>().await;
                }
            }
        }
    }
}

/// Signals within one process, for tests and single-process tooling.
#[derive(Clone, Default)]
pub struct InProcessToolApprovalSignals {
    resolved: Arc<std::sync::OnceLock<broadcast::Sender<Uuid>>>,
}

impl InProcessToolApprovalSignals {
    fn sender(&self) -> &broadcast::Sender<Uuid> {
        self.resolved.get_or_init(|| broadcast::channel(256).0)
    }

    /// Wake whoever waits on `id`.
    pub fn notify(&self, id: ToolApprovalId) {
        let _ = self.sender().send(id.as_uuid());
    }
}

impl ToolApprovalSignals for InProcessToolApprovalSignals {
    type Subscription = BroadcastSubscription;

    fn subscribe(&self, id: ToolApprovalId) -> BroadcastSubscription {
        BroadcastSubscription {
            id: id.as_uuid(),
            receiver: self.sender().subscribe(),
        }
    }
}

/// [`ToolApprovalStore`] in memory, waking its own signals: tests and
/// single-process tooling. Clones share one store.
#[derive(Clone, Default)]
pub struct InMemoryToolApprovalStore {
    rows: Arc<std::sync::Mutex<std::collections::HashMap<ToolApprovalId, ToolApproval>>>,
    signals: InProcessToolApprovalSignals,
}

impl InMemoryToolApprovalStore {
    /// An empty store.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// The signals its resolutions wake.
    #[must_use]
    pub fn signals(&self) -> InProcessToolApprovalSignals {
        self.signals.clone()
    }

    /// Every approval, in no particular order.
    #[must_use]
    pub fn all(&self) -> Vec<ToolApproval> {
        self.rows
            .lock()
            .expect("tool approvals poisoned")
            .values()
            .cloned()
            .collect()
    }
}

impl ToolApprovalStore for InMemoryToolApprovalStore {
    async fn insert(&self, approval: &ToolApproval) -> Result<(), EgressError> {
        self.rows
            .lock()
            .expect("tool approvals poisoned")
            .insert(approval.id, approval.clone());
        Ok(())
    }

    async fn resolve(
        &self,
        id: ToolApprovalId,
        status: ToolApprovalStatus,
        resolved_by: Option<&MacroUserIdStr<'static>>,
    ) -> Result<Option<ToolApproval>, EgressError> {
        let resolved = {
            let mut rows = self.rows.lock().expect("tool approvals poisoned");
            let Some(row) = rows.get_mut(&id).filter(|row| row.status.is_pending()) else {
                return Ok(None);
            };
            row.status = status;
            row.resolved_by = resolved_by.cloned();
            row.clone()
        };
        self.signals.notify(id);
        Ok(Some(resolved))
    }

    async fn get(&self, id: ToolApprovalId) -> Result<Option<ToolApproval>, EgressError> {
        Ok(self
            .rows
            .lock()
            .expect("tool approvals poisoned")
            .get(&id)
            .cloned())
    }

    async fn pending_for_request(
        &self,
        session: AgentSessionId,
        request_id: &serde_json::Value,
    ) -> Result<Option<ToolApprovalId>, EgressError> {
        Ok(self
            .rows
            .lock()
            .expect("tool approvals poisoned")
            .values()
            .find(|row| {
                row.session == session && row.request_id == *request_id && row.status.is_pending()
            })
            .map(|row| row.id))
    }

    async fn pending_for_session(
        &self,
        session: AgentSessionId,
    ) -> Result<Vec<ToolApprovalId>, EgressError> {
        Ok(self
            .rows
            .lock()
            .expect("tool approvals poisoned")
            .values()
            .filter(|row| row.session == session && row.status.is_pending())
            .map(|row| row.id)
            .collect())
    }
}
