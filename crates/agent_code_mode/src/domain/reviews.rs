//! Persistent session interactions; completing an execution never closes a review.
use super::{CodeModeError, ExecutionId, ExecutionStore};
use agent_session::domain::model::AgentSessionId;
use async_trait::async_trait;
use entity_access::domain::models::{
    EditAccessLevel, EntityAccessReceipt, EntityType, ViewAccessLevel,
};
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Arc;
use utoipa::ToSchema;

#[cfg(test)]
mod test;

const MAX_REVIEWS_PER_SESSION: u16 = 100;
const NOTIFICATION_RETRY_MS: i64 = 30_000;
const MAX_DRAFT_BYTES: usize = 128 * 1024;
const MAX_RECORD_BYTES: usize = 2 * 1024 * 1024;
const MAX_INPUT_BYTES: usize = 1024 * 1024;
const STALE_SUBMISSION_MS: i64 = 300_000;
const ACTION_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(60);
const MAX_RESULT_BYTES: usize = 8192;

/// Persisted review identity.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(transparent)]
pub struct ReviewId(pub Uuid);

/// The component and action used to finish a review.
#[derive(
    Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema, schemars::JsonSchema,
)]
#[serde(rename_all = "snake_case")]
pub enum ReviewKind {
    /// Editable email stack.
    Email,
    /// Editable calendar event stack.
    Calendar,
}

/// A reference returned by generated code; it confers no authorization.
#[derive(Clone, Serialize, Deserialize, ToSchema)]
pub struct ReviewReference {
    /// Kind of the persisted block.
    pub kind: ReviewKind,
    /// Review identity.
    pub id: ReviewId,
}

/// Review creation. Drafts are validated by the action's owning adapter.
#[derive(Clone, Deserialize, Serialize, ToSchema, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateReview {
    /// Optional code execution that prepared these drafts.
    #[serde(default)]
    pub execution_id: Option<ExecutionId>,
    /// Existing UI and action to use.
    pub kind: ReviewKind,
    /// Stack label.
    pub title: String,
    /// One to one hundred independent drafts. Email: {subject, body: Markdown,
    /// to: [{email, name?}], cc?: [{email, name?}], bcc?: [{email, name?}],
    /// replyingToId?, attachments?: [{documentId}]}. Calendar: {title,
    /// time: {kind: "timed", startsAt: ISO datetime, endsAt: ISO datetime,
    /// timeZone?: IANA zone} or {kind: "allDay", startDate: ISO date,
    /// endDate: exclusive ISO date}, description?, location?, attendees?:
    /// [{email, isOptional?}]}.
    /// Creating any review only presents these drafts; the user acts separately.
    pub drafts: Vec<Value>,
}

/// A review item never retries an ambiguous external result automatically.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ReviewItemStatus {
    /// Still editable and not submitted.
    Pending,
    /// Claimed before external work begins.
    Submitting,
    /// External success was observed and saved.
    Completed,
    /// User dismissed this draft.
    Dismissed,
    /// External work might have happened; reconcile before retrying.
    Unknown,
}

/// One editable item and its durable outcome.
#[derive(Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReviewItem {
    /// Stable item identity across stack navigation and edits.
    pub id: Uuid,
    /// Validated arguments for the existing composer/action.
    pub draft: Value,
    /// Current outcome.
    pub status: ReviewItemStatus,
    /// Actual backend response, never a model assertion.
    pub result: Option<Value>,
    /// Failure or uncertainty description.
    pub error: Option<String>,
}

/// Full UI record, fetched outside the model context.
#[derive(Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReviewRecord {
    /// Review identity.
    pub id: ReviewId,
    /// Owning session.
    #[schema(value_type = Uuid)]
    pub session_id: AgentSessionId,
    /// Originating code execution, absent for directly presented reviews.
    pub execution_id: Option<ExecutionId>,
    /// Durable presentation acknowledgment, separate from user decisions.
    #[serde(default)]
    pub presented_at: Option<i64>,
    /// Component kind.
    pub kind: ReviewKind,
    /// Stack label.
    pub title: String,
    /// Compare-and-swap revision for edits and submissions.
    pub revision: i64,
    /// Milliseconds since epoch of the last state change.
    pub updated_at: i64,
    /// Drafts and per-item outcomes.
    pub items: Vec<ReviewItem>,
    /// Stable queued-action identity until the outcome has reached the session.
    /// A failed notification may be retried without repeating external actions.
    #[serde(default)]
    pub notification_id: Option<Uuid>,
    /// Most recent delivery claim, allowing retry after a replica stops.
    #[serde(default)]
    pub notification_attempt_at: Option<i64>,
}

/// One atomic user decision against the displayed revision.
#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(tag = "action", rename_all = "snake_case", deny_unknown_fields)]
pub enum ReviewDecision {
    /// Save one edited draft.
    Edit {
        /// Revision displayed by the caller.
        revision: i64,
        /// Pending item to update.
        item: Uuid,
        /// Replacement action arguments.
        draft: Value,
    },
    /// Send/create selected items, or all pending items when empty.
    Submit {
        /// Revision displayed by the caller.
        revision: i64,
        /// Pending items, or an empty list to select all pending items.
        items: Vec<Uuid>,
    },
    /// Dismiss selected pending items, or all pending items when empty.
    Dismiss {
        /// Revision displayed by the caller.
        revision: i64,
        /// Pending items, or an empty list to select all pending items.
        items: Vec<Uuid>,
    },
}

/// Storage with an atomic revision check. No external action precedes its claim.
#[async_trait]
pub trait ReviewStore: Send + Sync + 'static {
    /// Insert while atomically enforcing the domain's per-session stack limit.
    async fn create(
        &self,
        record: &ReviewRecord,
        max_per_session: u16,
    ) -> Result<(), CodeModeError>;
    /// Look up only within the session.
    async fn get(
        &self,
        session: AgentSessionId,
        id: ReviewId,
    ) -> Result<ReviewRecord, CodeModeError>;
    /// List bounded execution-owned blocks.
    async fn list(
        &self,
        session: AgentSessionId,
        execution: ExecutionId,
    ) -> Result<Vec<ReviewRecord>, CodeModeError>;
    /// Save iff the persisted revision equals `expected`.
    async fn save(&self, expected: i64, record: &ReviewRecord) -> Result<(), CodeModeError>;
}

/// Authoritative session facts used by review authorization and dispatch.
pub struct ReviewSession {
    /// User that owns actions initiated from this session.
    pub owner: MacroUserIdStr<'static>,
    /// Archived sessions cannot start actions or new notification turns.
    pub archived: bool,
}

/// Existing domain actions and session control composed by the harness.
#[async_trait]
pub trait ReviewActions: Send + Sync + 'static {
    /// Read current ownership and lifecycle facts without applying review policy.
    async fn session(&self, session: AgentSessionId) -> Result<ReviewSession, CodeModeError>;
    /// Validate draft structure without performing the action.
    fn validate(&self, kind: ReviewKind, draft: &Value) -> Result<(), CodeModeError>;
    /// Execute the reviewed draft as its authenticated owner.
    async fn execute(
        &self,
        owner: &MacroUserIdStr<'static>,
        kind: ReviewKind,
        draft: Value,
    ) -> Result<Value, CodeModeError>;
    /// Persist and stream a completed presentation without waiting for user action.
    /// Repeated calls with the same review ID must not duplicate its ACP frames.
    async fn present(
        &self,
        owner: &MacroUserIdStr<'static>,
        record: &ReviewRecord,
    ) -> Result<(), CodeModeError>;
    /// Deliver one batch outcome through the existing ordered session control queue.
    async fn notify(
        &self,
        owner: &MacroUserIdStr<'static>,
        record: &ReviewRecord,
    ) -> Result<(), CodeModeError>;
}

/// Session-owned interaction service. User decisions outlive the Deno process.
#[derive(Clone)]
pub struct ReviewService {
    store: Arc<dyn ReviewStore>,
    executions: Arc<dyn ExecutionStore>,
    actions: Arc<dyn ReviewActions>,
}

impl ReviewService {
    /// Compose persistence and existing actions.
    pub fn new(
        store: Arc<dyn ReviewStore>,
        executions: Arc<dyn ExecutionStore>,
        actions: Arc<dyn ReviewActions>,
    ) -> Self {
        Self {
            store,
            executions,
            actions,
        }
    }
    async fn owner(
        &self,
        session: AgentSessionId,
    ) -> Result<MacroUserIdStr<'static>, CodeModeError> {
        let state = self.actions.session(session).await?;
        if state.archived {
            return Err(CodeModeError::Forbidden);
        }
        Ok(state.owner)
    }
    async fn authorize(
        &self,
        access: &EntityAccessReceipt<EditAccessLevel>,
        actor: &MacroUserIdStr<'static>,
    ) -> Result<AgentSessionId, CodeModeError> {
        let session = session_id(access.entity().entity_type, &access.entity().entity_id)?;
        if access.acting_user_id() != Some(actor) || self.owner(session).await? != *actor {
            return Err(CodeModeError::Forbidden);
        }
        Ok(session)
    }
    /// Create a saved stack without waiting for a human.
    pub async fn create(
        &self,
        access: &EntityAccessReceipt<EditAccessLevel>,
        actor: &MacroUserIdStr<'static>,
        input: CreateReview,
    ) -> Result<ReviewRecord, CodeModeError> {
        let session = self.authorize(access, actor).await?;
        self.create_owned(session, actor, input).await
    }
    /// Present directly from an authenticated agent session, including non-code agents.
    pub async fn create_for_session(
        &self,
        session: &agent_session::domain::model::AgentSession,
        actor: &MacroUserIdStr<'static>,
        input: CreateReview,
    ) -> Result<ReviewRecord, CodeModeError> {
        if session.owner_user().map_err(|_| CodeModeError::Forbidden)? != actor
            || self.owner(session.id).await? != *actor
        {
            return Err(CodeModeError::Forbidden);
        }
        self.create_owned(session.id, actor, input).await
    }
    async fn create_owned(
        &self,
        session: AgentSessionId,
        actor: &MacroUserIdStr<'static>,
        input: CreateReview,
    ) -> Result<ReviewRecord, CodeModeError> {
        if let Some(execution) = input.execution_id {
            self.executions.get(session, execution).await?;
        }
        if input.title.trim().is_empty()
            || input.title.len() > 256
            || !(1..=100).contains(&input.drafts.len())
            || serde_json::to_vec(&input).map_err(|_| invalid())?.len() > MAX_INPUT_BYTES
        {
            return Err(invalid());
        }
        for draft in &input.drafts {
            self.validate_draft(input.kind, draft)?;
        }
        let record = ReviewRecord {
            id: ReviewId(macro_uuid::generate_uuid_v7()),
            session_id: session,
            execution_id: input.execution_id,
            presented_at: None,
            kind: input.kind,
            title: input.title,
            revision: 0,
            updated_at: chrono::Utc::now().timestamp_millis(),
            notification_id: None,
            notification_attempt_at: None,
            items: input
                .drafts
                .into_iter()
                .map(|draft| ReviewItem {
                    id: macro_uuid::generate_uuid_v7(),
                    draft,
                    status: ReviewItemStatus::Pending,
                    result: None,
                    error: None,
                })
                .collect(),
        };
        self.store.create(&record, MAX_REVIEWS_PER_SESSION).await?;
        self.present(actor, record).await
    }
    async fn present(
        &self,
        actor: &MacroUserIdStr<'static>,
        mut record: ReviewRecord,
    ) -> Result<ReviewRecord, CodeModeError> {
        if record.presented_at.is_some() {
            return Ok(record);
        }
        // Persisted frames use the review identity for deduplication, including a
        // retry after the writer succeeded but this acknowledgment was interrupted.
        self.actions.present(actor, &record).await?;
        record.presented_at = Some(chrono::Utc::now().timestamp_millis());
        match self.save(&mut record).await {
            Ok(()) => Ok(record),
            Err(CodeModeError::Conflict) => self.store.get(record.session_id, record.id).await,
            Err(error) => Err(error),
        }
    }
    /// Read a stack through the session's view capability.
    pub async fn read(
        &self,
        access: &EntityAccessReceipt<ViewAccessLevel>,
        id: ReviewId,
    ) -> Result<ReviewRecord, CodeModeError> {
        let session = session_id(access.entity().entity_type, &access.entity().entity_id)?;
        self.refresh(self.store.get(session, id).await?).await
    }
    /// List reviews independently of whether generated code returned their references.
    pub async fn list(
        &self,
        access: &EntityAccessReceipt<ViewAccessLevel>,
        execution: ExecutionId,
    ) -> Result<Vec<ReviewRecord>, CodeModeError> {
        let session = session_id(access.entity().entity_type, &access.entity().entity_id)?;
        let mut records = Vec::new();
        for record in self.store.list(session, execution).await? {
            records.push(self.refresh(record).await?);
        }
        Ok(records)
    }
    async fn refresh(&self, mut record: ReviewRecord) -> Result<ReviewRecord, CodeModeError> {
        if record.presented_at.is_none() {
            let owner = self.owner(record.session_id).await?;
            record = self.present(&owner, record).await?;
        }
        // A killed replica cannot leave a permanent spinner or permit a blind retry.
        if chrono::Utc::now().timestamp_millis() - record.updated_at > STALE_SUBMISSION_MS
            && record
                .items
                .iter()
                .any(|item| item.status == ReviewItemStatus::Submitting)
        {
            for item in &mut record.items {
                if item.status == ReviewItemStatus::Submitting {
                    item.status = ReviewItemStatus::Unknown;
                    item.error = Some(
                        "Submission was interrupted; check the destination before retrying.".into(),
                    );
                }
            }
            match self.save(&mut record).await {
                Ok(()) => {}
                Err(CodeModeError::Conflict) => {
                    record = self.store.get(record.session_id, record.id).await?
                }
                Err(error) => return Err(error),
            }
        }
        if record.notification_id.is_some()
            && record.notification_attempt_at.is_none_or(|attempt| {
                chrono::Utc::now().timestamp_millis() - attempt >= NOTIFICATION_RETRY_MS
            })
            && !record
                .items
                .iter()
                .any(|item| item.status == ReviewItemStatus::Submitting)
        {
            let service = self.clone();
            let pending = record.clone();
            tokio::spawn(async move {
                service.deliver_notification(pending).await;
            });
        }
        Ok(record)
    }
    fn validate_draft(&self, kind: ReviewKind, draft: &Value) -> Result<(), CodeModeError> {
        if serde_json::to_vec(draft).map_err(|_| invalid())?.len() > MAX_DRAFT_BYTES {
            return Err(invalid());
        }
        self.actions.validate(kind, draft)
    }
    async fn deliver_notification(&self, mut record: ReviewRecord) {
        let Some(_) = record.notification_id else {
            return;
        };
        let now = chrono::Utc::now().timestamp_millis();
        if record
            .notification_attempt_at
            .is_some_and(|attempt| now - attempt < NOTIFICATION_RETRY_MS)
        {
            return;
        }
        record.notification_attempt_at = Some(now);
        if self.save(&mut record).await.is_err() {
            return;
        }
        let Ok(owner) = self.owner(record.session_id).await else {
            return;
        };
        // Persisted pending state is retained on failure. A later read retries using
        // the same queue identity; it never re-enters the external action path.
        match tokio::time::timeout(
            std::time::Duration::from_secs(10),
            self.actions.notify(&owner, &record),
        )
        .await
        {
            Ok(Ok(())) => {
                record.notification_id = None;
                if let Err(error) = self.save(&mut record).await {
                    tracing::warn!(?error, "could not acknowledge review notification");
                }
            }
            _ => tracing::warn!("review notification pending retry"),
        }
    }
    async fn save(&self, record: &mut ReviewRecord) -> Result<(), CodeModeError> {
        if serde_json::to_vec(record).map_err(|_| invalid())?.len() > MAX_RECORD_BYTES {
            return Err(invalid());
        }
        let previous = record.revision;
        record.revision += 1;
        record.updated_at = chrono::Utc::now().timestamp_millis();
        self.store.save(previous, record).await
    }
    /// Claim the exact saved revision, then complete independently of the request.
    /// Persisted submitting states become unknown after interrupted work.
    /// Dropping the browser request cannot replay a provider action.
    pub async fn decide(
        &self,
        access: &EntityAccessReceipt<EditAccessLevel>,
        actor: &MacroUserIdStr<'static>,
        id: ReviewId,
        decision: ReviewDecision,
    ) -> Result<ReviewRecord, CodeModeError> {
        let session = self.authorize(access, actor).await?;
        let mut record = self.store.get(session, id).await?;
        let revision = match &decision {
            ReviewDecision::Edit { revision, .. }
            | ReviewDecision::Submit { revision, .. }
            | ReviewDecision::Dismiss { revision, .. } => *revision,
        };
        if revision != record.revision
            || record.presented_at.is_none()
            || record.notification_id.is_some()
            || record
                .items
                .iter()
                .any(|item| item.status == ReviewItemStatus::Submitting)
        {
            return Err(CodeModeError::Conflict);
        }
        if let ReviewDecision::Edit { item, draft, .. } = decision {
            self.validate_draft(record.kind, &draft)?;
            let target = record
                .items
                .iter_mut()
                .find(|entry| entry.id == item && entry.status == ReviewItemStatus::Pending)
                .ok_or(CodeModeError::Conflict)?;
            target.draft = draft;
            if record
                .items
                .iter()
                .map(|item| {
                    serde_json::to_vec(&item.draft)
                        .map(|bytes| bytes.len())
                        .unwrap_or(MAX_INPUT_BYTES + 1)
                })
                .sum::<usize>()
                > MAX_INPUT_BYTES
            {
                return Err(invalid());
            }
            self.save(&mut record).await?;
            return Ok(record);
        }
        let (ids, submit) = match decision {
            ReviewDecision::Submit { items, .. } => (items, true),
            ReviewDecision::Dismiss { items, .. } => (items, false),
            ReviewDecision::Edit { .. } => unreachable!(),
        };
        if ids.iter().any(|id| {
            !record
                .items
                .iter()
                .any(|item| item.id == *id && item.status == ReviewItemStatus::Pending)
        }) {
            return Err(CodeModeError::Conflict);
        }
        let selected: Vec<usize> = record
            .items
            .iter()
            .enumerate()
            .filter(|(_, item)| {
                item.status == ReviewItemStatus::Pending
                    && (ids.is_empty() || ids.contains(&item.id))
            })
            .map(|(index, _)| index)
            .collect();
        if selected.is_empty() {
            return Ok(record);
        }
        for index in &selected {
            record.items[*index].status = if submit {
                ReviewItemStatus::Submitting
            } else {
                ReviewItemStatus::Dismissed
            };
        }
        record.notification_id = Some(macro_uuid::generate_uuid_v7());
        record.notification_attempt_at = None;
        self.save(&mut record).await?;
        let response = record.clone();
        let service = self.clone();
        let actor = actor.clone();
        tokio::spawn(async move {
            if submit {
                for index in selected {
                    let outcome = tokio::time::timeout(ACTION_TIMEOUT, async {
                        if service.owner(record.session_id).await? != actor {
                            return Err(CodeModeError::Forbidden);
                        }
                        service
                            .actions
                            .execute(&actor, record.kind, record.items[index].draft.clone())
                            .await
                    })
                    .await;
                    let item = &mut record.items[index];
                    match outcome {
                        Ok(Ok(result)) => {
                            item.status = ReviewItemStatus::Completed;
                            item.result = Some(
                                if serde_json::to_vec(&result)
                                    .is_ok_and(|bytes| bytes.len() <= MAX_RESULT_BYTES)
                                {
                                    result
                                } else {
                                    serde_json::json!({"outputOmitted": true, "reason": "Review action succeeded; result exceeded the saved detail limit."})
                                },
                            );
                        }
                        _ => {
                            item.status = ReviewItemStatus::Unknown;
                            item.error = Some("The submission outcome could not be confirmed. Check the destination before retrying.".into());
                        }
                    }
                    if service.save(&mut record).await.is_err() {
                        return;
                    }
                }
            }
            service.deliver_notification(record).await;
        });
        Ok(response)
    }
}
fn session_id(kind: EntityType, id: &str) -> Result<AgentSessionId, CodeModeError> {
    if kind != EntityType::AgentSession {
        return Err(CodeModeError::Forbidden);
    }
    id.parse()
        .map(AgentSessionId::new_from_uuid)
        .map_err(|_| CodeModeError::Forbidden)
}
fn invalid() -> CodeModeError {
    CodeModeError::Invalid("Provide a title and 1–100 valid drafts within 1 MiB.".into())
}
