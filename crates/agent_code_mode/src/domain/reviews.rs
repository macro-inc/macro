//! Persistent session interactions; completing an execution never closes a review.
//! A view (`views`) is the stateless kind: presented the same way, never saved.
use super::{CodeModeError, ExecutionId, ExecutionStore};
use agent_runtime_protocol::domain::notification::{
    DecisionOutcome, DecisionVia, ItemStatus, NotificationEvent, ReviewItemOutcome, ReviewOutcome,
    ReviewSettlement,
};
use agent_session::domain::model::{AgentSessionId, TurnPrompter};
use agent_session::domain::notifications::{PendingNotification, ProduceNotification};
use async_trait::async_trait;
use entity_access::domain::models::{
    EditAccessLevel, EntityAccessReceipt, EntityType, ViewAccessLevel,
};
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tracing::Instrument as _;
use utoipa::ToSchema;

mod drafts;
mod views;
pub use views::{PresentView, PresentedView};

#[cfg(test)]
mod test;

pub use drafts::*;

const MAX_REVIEWS_PER_SESSION: u16 = 100;
const MAX_DRAFT_BYTES: usize = 128 * 1024;
const MAX_RECORD_BYTES: usize = 2 * 1024 * 1024;
const MAX_INPUT_BYTES: usize = 1024 * 1024;
const STALE_SUBMISSION_MS: i64 = 300_000;
const ACTION_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(60);

/// Persisted review identity.
#[derive(
    Clone,
    Copy,
    Debug,
    PartialEq,
    Eq,
    Serialize,
    Deserialize,
    ToSchema,
    schemars::JsonSchema,
    specta::Type,
)]
#[serde(transparent)]
pub struct ReviewId(
    #[schemars(with = "String")]
    #[specta(type = String)]
    pub Uuid,
);

/// The component and action used to finish a review.
#[derive(
    Clone,
    Copy,
    Debug,
    PartialEq,
    Eq,
    Serialize,
    Deserialize,
    ToSchema,
    schemars::JsonSchema,
    specta::Type,
)]
#[serde(rename_all = "snake_case")]
pub enum ReviewKind {
    /// Editable email stack.
    Email,
    /// Editable calendar event stack.
    Calendar,
    /// A staged workspace import plan, approved as one item.
    Import,
}

/// A reference returned by generated code; it confers no authorization.
#[derive(Clone, Serialize, Deserialize, ToSchema)]
pub struct ReviewReference {
    /// Kind of the persisted block.
    pub kind: ReviewKind,
    /// Review identity.
    pub id: ReviewId,
}

/// Review creation. Decoding it validates every draft; creating a review only
/// presents the drafts, and the account holder acts separately.
#[derive(Clone, Deserialize, Serialize, ToSchema, schemars::JsonSchema, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CreateReview {
    /// Optional code execution that prepared these drafts.
    #[serde(default)]
    pub execution_id: Option<ExecutionId>,
    /// Stack label.
    #[schema(value_type = String)]
    pub title: ReviewTitle,
    /// The review's kind (email, calendar, import) and its drafts: 1–100
    /// SendEmail or CreateCalendarEvent arguments, or exactly one import
    /// plan selection.
    #[serde(flatten)]
    #[schema(value_type = Object)]
    pub drafts: ReviewDrafts,
}

/// Persisted review item state shared with typed system notifications.
pub use agent_runtime_protocol::domain::notification::ItemStatus as ReviewItemStatus;

/// Full UI record, fetched outside the model context.
#[derive(Clone, Serialize, Deserialize, ToSchema, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ReviewRecord {
    /// Review identity.
    pub id: ReviewId,
    /// Owning session.
    #[schema(value_type = Uuid)]
    #[specta(type = String)]
    pub session_id: AgentSessionId,
    /// Account whose email/calendar the drafts use.
    #[schema(value_type = String)]
    #[specta(type = String)]
    pub acting_user: MacroUserIdStr<'static>,
    /// Originating code execution, absent for directly presented reviews.
    pub execution_id: Option<ExecutionId>,
    /// Durable presentation acknowledgment, separate from user decisions.
    #[serde(default)]
    #[specta(type = Option<i32>)]
    pub presented_at: Option<i64>,
    /// Stack label.
    #[schema(value_type = String)]
    pub title: ReviewTitle,
    /// Compare-and-swap revision for edits and submissions.
    #[specta(type = i32)]
    pub revision: i64,
    /// Milliseconds since epoch of the last state change.
    #[specta(type = i32)]
    pub updated_at: i64,
    /// Component kind, drafts and per-item outcomes.
    #[serde(flatten)]
    #[schema(value_type = Object)]
    pub items: ReviewItems,
    /// Current batch's authenticated decision, preserved for interrupted work.
    #[serde(default)]
    pub decision: Option<ReviewDecisionContext>,
}

impl ReviewRecord {
    /// The component and action used to finish this review.
    pub fn kind(&self) -> ReviewKind {
        self.items.kind()
    }
}

/// Facts about the most recent account-holder decision.
#[derive(Clone, Serialize, Deserialize, ToSchema, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ReviewDecisionContext {
    /// Authenticated account holder.
    pub by: String,
    /// Entry surface.
    pub via: DecisionVia,
    /// Revision claimed by this batch, used in notification deduplication.
    #[specta(type = i32)]
    pub revision: i64,
    /// Items selected by this decision.
    #[specta(type = Vec<String>)]
    pub items: Vec<Uuid>,
}

/// One atomic user decision against the displayed revision.
#[derive(Clone, Deserialize, Serialize, ToSchema, schemars::JsonSchema, specta::Type)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum ReviewDecision {
    /// Save one edited draft.
    Edit {
        /// Revision displayed by the caller.
        #[specta(type = i32)]
        revision: i64,
        /// Pending item to update.
        #[specta(type = String)]
        item: Uuid,
        /// Replacement action arguments, keyed by the review's kind.
        #[schema(value_type = Object)]
        draft: Box<ReviewDraft>,
    },
    /// Send/create selected items, or all pending items when empty.
    Submit {
        /// Revision displayed by the caller.
        #[specta(type = i32)]
        revision: i64,
        /// Pending items, or an empty list to select all pending items.
        #[specta(type = Vec<String>)]
        items: Vec<Uuid>,
    },
    /// Dismiss selected pending items, or all pending items when empty.
    Dismiss {
        /// Revision displayed by the caller.
        #[specta(type = i32)]
        revision: i64,
        /// Pending items, or an empty list to select all pending items.
        #[specta(type = Vec<String>)]
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
    async fn save(
        &self,
        expected: i64,
        record: &ReviewRecord,
        notification: Option<&PendingNotification>,
    ) -> Result<(), CodeModeError>;
}

/// Authoritative session facts used by review authorization and dispatch.
pub struct ReviewSession {
    /// Session owner, independent of the account saved on each review.
    pub owner: MacroUserIdStr<'static>,
    /// Archived sessions cannot start actions or new notification turns.
    pub archived: bool,
    /// Current invocation authority, used only for agent-initiated decisions.
    pub prompter: Option<TurnPrompter>,
}

/// Existing domain actions and session control composed by the harness.
#[async_trait]
pub trait ReviewActions: Send + Sync + 'static {
    /// Read current ownership and lifecycle facts without applying review policy.
    async fn session(&self, session: AgentSessionId) -> Result<ReviewSession, CodeModeError>;
    /// Whether `record`'s action can start now. A kind whose action depends on
    /// work still in progress refuses until it is ready.
    async fn approvable(
        &self,
        _account_holder: &MacroUserIdStr<'static>,
        _record: &ReviewRecord,
    ) -> Result<bool, CodeModeError> {
        Ok(true)
    }
    /// Send a reviewed email as the record's saved, authenticated account holder.
    async fn send_email(
        &self,
        account_holder: &MacroUserIdStr<'static>,
        draft: &EmailDraft,
    ) -> Result<EmailResult, CodeModeError>;
    /// Create a reviewed calendar event as the record's account holder.
    async fn create_calendar_event(
        &self,
        account_holder: &MacroUserIdStr<'static>,
        draft: &CalendarDraft,
    ) -> Result<CalendarResult, CodeModeError>;
    /// Start writing `record`'s approved import plan. Its background write
    /// reports its own end as a `review.settled` event once it stops.
    async fn start_import(
        &self,
        account_holder: &MacroUserIdStr<'static>,
        record: &ReviewRecord,
        draft: &ImportDraft,
    ) -> Result<ImportResult, CodeModeError>;
    /// Persist and stream a completed presentation without waiting for user action.
    /// Repeated calls with the same review ID must not duplicate its ACP frames.
    async fn present(
        &self,
        owner: &MacroUserIdStr<'static>,
        record: &ReviewRecord,
    ) -> Result<(), CodeModeError>;
    /// Tell the session's viewers that `record` was saved at its current
    /// revision, so open cards fetch it instead of polling. Carries no draft
    /// content.
    async fn announce_update(&self, record: &ReviewRecord) -> Result<(), CodeModeError>;
    /// Stream a checked view as a completed `PresentView` call. Nothing is
    /// saved: the presented call is the view's only record.
    async fn present_view(
        &self,
        owner: &MacroUserIdStr<'static>,
        session: AgentSessionId,
        view: &PresentedView,
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
    async fn record_actor(
        &self,
        record: &ReviewRecord,
    ) -> Result<MacroUserIdStr<'static>, CodeModeError> {
        self.owner(record.session_id).await?;
        Ok(record.acting_user.clone())
    }
    async fn authorize(
        &self,
        access: &EntityAccessReceipt<EditAccessLevel>,
        actor: &MacroUserIdStr<'static>,
    ) -> Result<AgentSessionId, CodeModeError> {
        let session = session_id(access.entity().entity_type, &access.entity().entity_id)?;
        self.owner(session).await?;
        if access.acting_user_id() != Some(actor) {
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
        self.authorize_session(session, actor).await?;
        self.create_owned(session.id, actor, input).await
    }
    /// An authenticated agent session may present for its current owner, or
    /// for the person who prompted the turn it acts for.
    async fn authorize_session(
        &self,
        session: &agent_session::domain::model::AgentSession,
        actor: &MacroUserIdStr<'static>,
    ) -> Result<(), CodeModeError> {
        let state = self.actions.session(session.id).await?;
        if session.owner_user().map_err(|_| CodeModeError::Forbidden)? != &state.owner {
            return Err(CodeModeError::Forbidden);
        }
        if state.archived
            || (state.owner != *actor
                && state.prompter.as_ref().and_then(TurnPrompter::acting_user) != Some(actor))
        {
            return Err(CodeModeError::Forbidden);
        }
        Ok(())
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
        if serde_json::to_vec(&input).map_err(|_| invalid())?.len() > MAX_INPUT_BYTES
            || !input.drafts.each_within(MAX_DRAFT_BYTES)
        {
            return Err(invalid());
        }
        let record = ReviewRecord {
            id: ReviewId(macro_uuid::generate_uuid_v7()),
            session_id: session,
            acting_user: actor.clone(),
            execution_id: input.execution_id,
            presented_at: None,
            title: input.title,
            revision: 0,
            updated_at: chrono::Utc::now().timestamp_millis(),
            decision: None,
            items: input.drafts.into(),
        };
        self.store.create(&record, MAX_REVIEWS_PER_SESSION).await?;
        self.present(record).await
    }
    async fn present(&self, mut record: ReviewRecord) -> Result<ReviewRecord, CodeModeError> {
        if record.presented_at.is_some() {
            return Ok(record);
        }
        // Persisted frames use the review identity for deduplication, including a
        // retry after the writer succeeded but this acknowledgment was interrupted.
        // Presentation writes the session transcript, whose capability belongs
        // to the session owner. The record's immutable actor governs all actions.
        let owner = self.owner(record.session_id).await?;
        self.actions.present(&owner, &record).await?;
        record.presented_at = Some(chrono::Utc::now().timestamp_millis());
        match self.save(&mut record, None).await {
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
            record = self.present(record).await?;
        }
        // A killed replica cannot leave a permanent spinner or permit a blind retry.
        if chrono::Utc::now().timestamp_millis() - record.updated_at > STALE_SUBMISSION_MS
            && record
                .items
                .states()
                .iter()
                .any(|item| item.status == ReviewItemStatus::Submitting)
        {
            for item in record.items.states_mut() {
                if item.status == ReviewItemStatus::Submitting {
                    item.status = ReviewItemStatus::Unknown;
                    item.error = Some(
                        "Submission was interrupted; check the destination before retrying.".into(),
                    );
                }
            }
            let event = record.decision.as_ref().map(|_| {
                NotificationEvent::ReviewSettled(ReviewSettlement::Actions(review_outcome(&record)))
            });
            match self.save(&mut record, event).await {
                Ok(()) => {}
                Err(CodeModeError::Conflict) => {
                    record = self.store.get(record.session_id, record.id).await?
                }
                Err(error) => return Err(error),
            }
        }
        Ok(record)
    }
    async fn save(
        &self,
        record: &mut ReviewRecord,
        event: Option<NotificationEvent>,
    ) -> Result<(), CodeModeError> {
        if serde_json::to_vec(record).map_err(|_| invalid())?.len() > MAX_RECORD_BYTES {
            return Err(invalid());
        }
        let previous = record.revision;
        record.revision += 1;
        record.updated_at = chrono::Utc::now().timestamp_millis();
        let pending = event
            .map(|event| {
                // An approved import only started: its write settles later, and
                // that wakes the session instead.
                let wake = !(record.kind() == ReviewKind::Import
                    && matches!(&event, NotificationEvent::ReviewDecided(outcome) if outcome.outcome != DecisionOutcome::Dismissed));
                PendingNotification::new(ProduceNotification {
                    session_id: record.session_id,
                    subject_id: record.id.0.to_string(),
                    dedupe_key: Some(format!(
                        "{}:{}:{}",
                        event.kind(),
                        record.id.0,
                        record
                            .decision
                            .as_ref()
                            .map_or(previous, |decision| decision.revision)
                    )),
                    event,
                    wake,
                })
                .map_err(|error| CodeModeError::Storage(rootcause::report!(error).into()))
            })
            .transpose()?;
        self.store.save(previous, record, pending.as_ref()).await?;
        // Best effort: the save stands either way, and a card that misses
        // this revision fetches it with the next one or on reload.
        if let Err(error) = self.actions.announce_update(record).await {
            tracing::error!(
                error = ?error,
                review_id = %record.id.0,
                revision = record.revision,
                "could not announce a saved review"
            );
        }
        Ok(())
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
        self.decide_owned(session, actor, id, decision, DecisionVia::Card)
            .await
    }

    /// Read final drafts and results from an authenticated session tool.
    pub async fn read_for_session(
        &self,
        session: AgentSessionId,
        actor: &MacroUserIdStr<'static>,
        id: ReviewId,
    ) -> Result<ReviewRecord, CodeModeError> {
        let record = self.store.get(session, id).await?;
        if self.record_actor(&record).await? != *actor {
            return Err(CodeModeError::Forbidden);
        }
        self.refresh(record).await
    }

    /// Decisions in chat require a real prompt from the review’s account holder.
    /// A system event cannot approve itself.
    pub async fn decide_for_session(
        &self,
        session: AgentSessionId,
        actor: &MacroUserIdStr<'static>,
        id: ReviewId,
        decision: ReviewDecision,
    ) -> Result<ReviewRecord, CodeModeError> {
        let state = self.actions.session(session).await?;
        if state.archived
            || !state.prompter.is_some_and(|prompter| {
                prompter.kind == agent_session::domain::model::PrompterKind::User
                    && prompter.user.as_ref() == Some(actor)
            })
        {
            return Err(CodeModeError::Forbidden);
        }
        if let ReviewDecision::Submit { .. } = decision {
            let record = self.store.get(session, id).await?;
            if self.record_actor(&record).await? != *actor {
                return Err(CodeModeError::Forbidden);
            }
            if !self.actions.approvable(actor, &record).await? {
                return Err(CodeModeError::Invalid(
                    "This review is not ready to approve yet. Check it again before approving."
                        .into(),
                ));
            }
        }
        self.decide_owned(session, actor, id, decision, DecisionVia::Chat)
            .await
    }

    #[tracing::instrument(name = "review.decide", skip_all, fields(session_id = %session, review_id = %id.0), err)]
    async fn decide_owned(
        &self,
        session: AgentSessionId,
        actor: &MacroUserIdStr<'static>,
        id: ReviewId,
        decision: ReviewDecision,
        via: DecisionVia,
    ) -> Result<ReviewRecord, CodeModeError> {
        let mut record = self.store.get(session, id).await?;
        if self.record_actor(&record).await? != *actor {
            return Err(CodeModeError::Forbidden);
        }
        let revision = match &decision {
            ReviewDecision::Edit { revision, .. }
            | ReviewDecision::Submit { revision, .. }
            | ReviewDecision::Dismiss { revision, .. } => *revision,
        };
        if revision != record.revision
            || record.presented_at.is_none()
            || record
                .items
                .states()
                .iter()
                .any(|item| item.status == ReviewItemStatus::Submitting)
        {
            return Err(CodeModeError::Conflict);
        }
        let (ids, submit) = match decision {
            ReviewDecision::Edit { item, draft, .. } => {
                if serde_json::to_vec(&draft).map_err(|_| invalid())?.len() > MAX_DRAFT_BYTES {
                    return Err(invalid());
                }
                record.items.edit(item, *draft)?;
                if serde_json::to_vec(&record.items)
                    .map_err(|_| invalid())?
                    .len()
                    > MAX_INPUT_BYTES
                {
                    return Err(invalid());
                }
                self.save(&mut record, None).await?;
                return Ok(record);
            }
            ReviewDecision::Submit { items, .. } => (items, true),
            ReviewDecision::Dismiss { items, .. } => (items, false),
        };
        let states = record.items.states();
        if ids.iter().any(|id| {
            !states
                .iter()
                .any(|item| item.id == *id && item.status == ReviewItemStatus::Pending)
        }) {
            return Err(CodeModeError::Conflict);
        }
        let selected: Vec<(usize, Uuid)> = states
            .iter()
            .enumerate()
            .filter(|(_, item)| {
                item.status == ReviewItemStatus::Pending
                    && (ids.is_empty() || ids.contains(&item.id))
            })
            .map(|(index, item)| (index, item.id))
            .collect();
        if selected.is_empty() {
            return Ok(record);
        }
        if submit {
            for (position, (index, _)) in selected.iter().enumerate() {
                if let Some(problem) = record.items.submission_problem(*index) {
                    return Err(CodeModeError::Invalid(if selected.len() == 1 {
                        problem.to_string()
                    } else {
                        format!("Draft {} of {}: {problem}", position + 1, selected.len())
                    }));
                }
            }
        }
        let mut states = record.items.states_mut();
        for (index, _) in &selected {
            if let Some(item) = states.get_mut(*index) {
                item.status = if submit {
                    ReviewItemStatus::Submitting
                } else {
                    ReviewItemStatus::Dismissed
                };
            }
        }
        record.decision = Some(ReviewDecisionContext {
            by: actor.to_string(),
            via,
            revision,
            items: selected.iter().map(|(_, id)| *id).collect(),
        });
        let event = NotificationEvent::ReviewDecided(review_outcome(&record));
        self.save(&mut record, Some(event)).await?;
        let response = record.clone();
        let service = self.clone();
        let actor = actor.clone();
        tokio::spawn(async move {
            if submit {
                let last = selected.last().map(|(index, _)| *index);
                for (index, _) in selected {
                    let outcome = tokio::time::timeout(ACTION_TIMEOUT, async {
                        if service.record_actor(&record).await? != actor {
                            return Err(CodeModeError::Forbidden);
                        }
                        service.perform(&actor, &record, index).await
                    })
                    .await;
                    let completed = match outcome {
                        Ok(Ok(result)) => record.items.complete(index, result).is_ok(),
                        _ => false,
                    };
                    if !completed
                        && let Some(item) = record.items.states_mut().get_mut(index)
                    {
                        item.status = ReviewItemStatus::Unknown;
                        item.error = Some("The submission outcome could not be confirmed. Check the destination before retrying.".into());
                    }
                    // A started import settles when its write ends; only one that
                    // could not start settles here.
                    let event = (Some(index) == last
                        && !(record.kind() == ReviewKind::Import && completed))
                        .then(|| {
                            NotificationEvent::ReviewSettled(ReviewSettlement::Actions(
                                review_outcome(&record),
                            ))
                        });
                    if service.save(&mut record, event).await.is_err() {
                        return;
                    }
                }
            }
        }.in_current_span());
        Ok(response)
    }

    /// Run the existing action for the item at `index` with its typed draft.
    async fn perform(
        &self,
        account_holder: &MacroUserIdStr<'static>,
        record: &ReviewRecord,
        index: usize,
    ) -> Result<ReviewResult, CodeModeError> {
        match &record.items {
            ReviewItems::Email(items) => {
                let item = items.get(index).ok_or(CodeModeError::Conflict)?;
                let result = self.actions.send_email(account_holder, &item.draft).await?;
                Ok(ReviewResult::Email(result))
            }
            ReviewItems::Calendar(items) => {
                let item = items.get(index).ok_or(CodeModeError::Conflict)?;
                let result = self
                    .actions
                    .create_calendar_event(account_holder, &item.draft)
                    .await?;
                Ok(ReviewResult::Calendar(result))
            }
            ReviewItems::Import(items) => {
                let item = items.get(index).ok_or(CodeModeError::Conflict)?;
                let result = self
                    .actions
                    .start_import(account_holder, record, &item.draft)
                    .await?;
                Ok(ReviewResult::Import(result))
            }
        }
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
    CodeModeError::Invalid(
        "Keep a review's drafts within 1 MiB, and each draft within 128 KiB.".into(),
    )
}

/// Bounded outcome facts; final drafts and provider results stay on the review.
pub fn review_outcome(record: &ReviewRecord) -> ReviewOutcome {
    let decision = record.decision.as_ref();
    let items: Vec<_> = record
        .items
        .states()
        .into_iter()
        .filter(|item| decision.is_some_and(|decision| decision.items.contains(&item.id)))
        .map(|item| ReviewItemOutcome {
            id: item.id,
            status: item.status,
            edited: item.edited,
            error: item.error.clone(),
        })
        .collect();
    let outcome = if items
        .iter()
        .all(|item| item.status == ItemStatus::Dismissed)
    {
        DecisionOutcome::Dismissed
    } else if items
        .iter()
        .all(|item| matches!(item.status, ItemStatus::Completed | ItemStatus::Submitting))
    {
        DecisionOutcome::Approved
    } else {
        DecisionOutcome::Partial
    };
    ReviewOutcome {
        outcome,
        by: decision.map_or_else(String::new, |decision| decision.by.clone()),
        via: decision.map_or(DecisionVia::Card, |decision| decision.via),
        items,
    }
}
