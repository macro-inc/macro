//! Postgres transactions and durable delivery leases.
use crate::domain::{models::*, ports::*};
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use models_permissions::{share_permission::access_level::AccessLevel, sharing::SharingFacts};
use rootcause::prelude::IntoRootcause;
use sqlx::{PgPool, Postgres, Transaction, types::Json};
use tracing_opentelemetry::OpenTelemetrySpanExt;
use uuid::Uuid;

impl From<sqlx::Error> for RequestError {
    fn from(value: sqlx::Error) -> Self {
        Self::Internal(value.into())
    }
}

/// Postgres request store. Clone shares the pool, never an open transaction.
#[derive(Clone)]
pub struct PgRequestRepository {
    pool: PgPool,
}
impl PgRequestRepository {
    /// Construct at the composition root.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}
/// Entity-scoped transaction; the domain decides which changes to write.
pub struct PgRequestTransaction {
    tx: Transaction<'static, Postgres>,
    entity: ShareEntity,
    facts: SharingFacts,
}
#[derive(sqlx::FromRow)]
struct StoredRequest {
    id: Uuid,
    requester_id: String,
    requested_level: AccessLevel,
    status: String,
    revision: i32,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    resolved_at: Option<DateTime<Utc>>,
    granted_level: Option<AccessLevel>,
    retry_after: Option<DateTime<Utc>>,
}
impl TryFrom<StoredRequest> for AccessRequest {
    type Error = RequestError;
    fn try_from(r: StoredRequest) -> Result<Self, Self::Error> {
        let status = match r.status.as_str() {
            "pending" => RequestStatus::Pending,
            "granted" => RequestStatus::Granted,
            "denied" => RequestStatus::Denied,
            "cancelled" => RequestStatus::Cancelled,
            _ => {
                return Err(RequestError::Internal(rootcause::report!(
                    "invalid request status"
                )));
            }
        };
        Ok(Self {
            id: r.id,
            requester_id: MacroUserIdStr::try_from(r.requester_id)
                .map_err(|e| RequestError::Internal(e.into()))?,
            requested_level: r.requested_level,
            status,
            revision: r.revision,
            created_at: r.created_at,
            updated_at: r.updated_at,
            resolved_at: r.resolved_at,
            granted_level: r.granted_level,
            retry_after: r.retry_after,
        })
    }
}
impl RequestRepository for PgRequestRepository {
    type Transaction = PgRequestTransaction;
    async fn begin(&self, entity: ShareEntity) -> Result<Self::Transaction, RequestError> {
        let mut tx = self.pool.begin().await?;
        // Folder grant propagation and topology changes must read the same
        // serialized snapshot. Acquire the global guard before entity/row locks.
        if entity.entity_type == ShareEntityType::Project {
            entity_access_db_utils::team_share::acquire_guard(&mut tx).await?;
        }
        // Stable PostgreSQL hash: serialize first creation as well as existing rows.
        let kind = model_entity::EntityType::from(entity.entity_type);
        let lock_key = format!("access-request:{}:{}", kind.as_ref(), entity.entity_id);
        sqlx::query!(
            "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
            lock_key
        )
        .execute(tx.as_mut())
        .await?;
        let facts = entity_access_db_utils::direct_share::facts(&mut tx, &entity.entity_id, kind)
            .await
            .map_err(|error| RequestError::Internal(error.into_rootcause()))?
            .ok_or(RequestError::NotFound)?;
        Ok(PgRequestTransaction { tx, entity, facts })
    }
    async fn claim_events(&self) -> Result<Vec<RequestEvent>, RequestError> {
        let rows = sqlx::query_scalar!(
            r#"WITH due AS (
            SELECT id FROM entity_access_request_event
            WHERE delivered_at IS NULL AND available_at <= now()
            ORDER BY created_at, id FOR UPDATE SKIP LOCKED LIMIT 25
        ) UPDATE entity_access_request_event e SET available_at = now() + interval '30 seconds'
        FROM due WHERE e.id = due.id RETURNING e.payload AS "payload!: Json<RequestEvent>""#
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.into_iter().map(|r| r.0).collect())
    }
    async fn delivered(&self, id: Uuid) -> Result<(), RequestError> {
        sqlx::query!(
            "UPDATE entity_access_request_event SET delivered_at = now() WHERE id = $1",
            id
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }
}
impl PgRequestTransaction {
    async fn read(
        &mut self,
        user: Option<&str>,
        id: Option<Uuid>,
    ) -> Result<Option<AccessRequest>, RequestError> {
        let kind = model_entity::EntityType::from(self.entity.entity_type);
        let row = sqlx::query_as!(StoredRequest, r#"SELECT id, requester_id, requested_level AS "requested_level: AccessLevel", status, revision, created_at, updated_at, resolved_at, granted_level AS "granted_level: AccessLevel", retry_after
            FROM entity_access_request WHERE entity_type = $1 AND entity_id = $2 AND ($3::text IS NULL OR requester_id = $3) AND ($4::uuid IS NULL OR id = $4) LIMIT 1"#,
            kind.as_ref(), self.entity.entity_id, user, id).fetch_optional(self.tx.as_mut()).await?;
        row.map(TryInto::try_into).transpose()
    }
}
impl RequestTransaction for PgRequestTransaction {
    fn facts(&self) -> &SharingFacts {
        &self.facts
    }
    async fn mine(
        &mut self,
        user: &MacroUserIdStr<'_>,
    ) -> Result<Option<AccessRequest>, RequestError> {
        self.read(Some(user.as_ref()), None).await
    }
    async fn request(&mut self, id: Uuid) -> Result<Option<AccessRequest>, RequestError> {
        self.read(None, Some(id)).await
    }
    async fn pending(
        &mut self,
        offset: u32,
        limit: u32,
    ) -> Result<(Vec<AccessRequest>, i64), RequestError> {
        let kind = model_entity::EntityType::from(self.entity.entity_type);
        let total = sqlx::query_scalar!("SELECT count(*) AS \"count!\" FROM entity_access_request WHERE entity_type = $1 AND entity_id = $2 AND status = 'pending'", kind.as_ref(), self.entity.entity_id).fetch_one(self.tx.as_mut()).await?;
        let rows = sqlx::query_as!(StoredRequest, r#"SELECT id, requester_id, requested_level AS "requested_level: AccessLevel", status, revision, created_at, updated_at, resolved_at, granted_level AS "granted_level: AccessLevel", retry_after
            FROM entity_access_request WHERE entity_type = $1 AND entity_id = $2 AND status = 'pending' ORDER BY created_at, id LIMIT $3 OFFSET $4"#,
            kind.as_ref(), self.entity.entity_id, i64::from(limit), i64::from(offset)).fetch_all(self.tx.as_mut()).await?;
        Ok((
            rows.into_iter()
                .map(TryInto::try_into)
                .collect::<Result<_, _>>()?,
            total,
        ))
    }
    async fn save(&mut self, r: &AccessRequest) -> Result<(), RequestError> {
        let kind = model_entity::EntityType::from(self.entity.entity_type);
        let status = match r.status {
            RequestStatus::Pending => "pending",
            RequestStatus::Granted => "granted",
            RequestStatus::Denied => "denied",
            RequestStatus::Cancelled => "cancelled",
        };
        sqlx::query!(r#"INSERT INTO entity_access_request(id, entity_type, entity_id, requester_id, requested_level, status, revision, created_at, updated_at, resolved_at, granted_level, retry_after)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
            ON CONFLICT(id) DO UPDATE SET requested_level = EXCLUDED.requested_level, status = EXCLUDED.status, revision = EXCLUDED.revision, created_at = EXCLUDED.created_at, updated_at = EXCLUDED.updated_at, resolved_at = EXCLUDED.resolved_at, granted_level = EXCLUDED.granted_level, retry_after = EXCLUDED.retry_after"#,
            r.id, kind.as_ref(), self.entity.entity_id, r.requester_id.as_ref(), r.requested_level as _, status, r.revision, r.created_at, r.updated_at, r.resolved_at, r.granted_level as _, r.retry_after).execute(self.tx.as_mut()).await?;
        Ok(())
    }
    async fn direct_access(&mut self) -> Result<Vec<DirectAccess>, RequestError> {
        Ok(entity_access_db_utils::direct_share::list(
            &mut self.tx,
            &self.entity.entity_id,
            self.entity.entity_type.into(),
        )
        .await
        .map_err(|error| RequestError::Internal(error.into_rootcause()))?
        .into_iter()
        .map(|(user_id, access_level)| DirectAccess {
            user_id,
            access_level,
        })
        .collect())
    }
    async fn grant(
        &mut self,
        user: &MacroUserIdStr<'_>,
        level: Option<AccessLevel>,
        upgrade_only: bool,
    ) -> Result<(), RequestError> {
        entity_access_db_utils::direct_share::set(
            &mut self.tx,
            &self.entity.entity_id,
            self.entity.entity_type.into(),
            user,
            level,
            upgrade_only,
        )
        .await
        .map_err(|error| RequestError::Internal(error.into_rootcause()))
    }
    async fn enqueue(&mut self, mut event: RequestEvent) -> Result<(), RequestError> {
        opentelemetry::global::get_text_map_propagator(|propagator| {
            propagator.inject_context(
                &tracing::Span::current().context(),
                &mut event.trace_context,
            );
        });
        let request_id = event.request.as_ref().map(|r| r.id);
        if let Some(id) = request_id {
            // Each durable event withdraws its immediate predecessor. Chaining
            // those withdrawals also handles delivery in reverse order without
            // copying the entire notification history into every new payload.
            let previous_revision = event.request.as_ref().map(|request| request.revision - 1);
            let previous = sqlx::query_scalar!(r#"SELECT payload AS "payload!: Json<RequestEvent>" FROM entity_access_request_event WHERE request_id = $1 AND (payload->'request'->>'revision')::int = $2 LIMIT 1"#, id, previous_revision)
                .fetch_optional(self.tx.as_mut()).await?;
            event.superseded = previous
                .filter(|e| {
                    e.0.request
                        .as_ref()
                        .is_some_and(|r| r.status == RequestStatus::Pending)
                })
                .map(|e| vec![(e.0.id, e.0.reviewers)])
                .unwrap_or_default();
        }
        sqlx::query!(
            "INSERT INTO entity_access_request_event(id, request_id, payload) VALUES ($1,$2,$3)",
            event.id,
            request_id,
            Json(&event) as _
        )
        .execute(self.tx.as_mut())
        .await?;
        Ok(())
    }
    async fn commit(self) -> Result<(), RequestError> {
        self.tx.commit().await.map_err(Into::into)
    }
}
