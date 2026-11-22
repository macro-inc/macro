//! Hand-written fakes for the service's ports, shared by the domain and HTTP
//! tests.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};

use agent_fold::domain::log::AgentSessionId;
use chrono::{TimeDelta, Utc};
use entity_access::domain::models::{
    AccessLevel, Entity, EntityAccessReceipt, EntityPermission, EntityType, RequiredPermission,
};
use feature_flags::outbound::fake::FakeFeatureFlags;
use feature_flags::{FlagSnapshot, FlagValue};
use macro_user_id::user_id::MacroUserIdStr;
use messages::domain::api::MessageReader;
use messages::domain::models::{Message, MessageKind, MessageParent, MessageThread};
use messages::domain::ports::{
    MessageError, MessagePage, MessageTimelinePage, MessageTimelineQuery,
};
use messages::domain::service::MessageView;
use rootcause::Report;
use uuid::Uuid;

use crate::domain::model::{
    AGENT_RESPONSE_FEEDBACK_FLAG, AppendOutcome, ExportCursor, ExportLimit, FeedbackEvent,
    FeedbackState, FeedbackWrite, MyFeedback, SubjectKind,
};
use crate::domain::ports::{
    AgentAccounts, AgentSessions, FeedbackRepo, RoutineRuns, RunFacts, SessionFacts,
};
use crate::domain::service::FeedbackService;

pub(crate) const RATER: &str = "macro|rater@example.com";
pub(crate) const FLAG_OFF: &str = "macro|flag-off@example.com";
pub(crate) const FLAGS_DOWN: &str = "macro|flags-down@example.com";
pub(crate) const TEAMMATE: &str = "macro|teammate@example.com";
pub(crate) const PERSON: &str = "macro|person@example.com";

pub(crate) fn user(id: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(id.to_owned()).expect("valid user id")
}

/// [`RATER`] has the flag, [`FLAG_OFF`] doesn't, [`FLAGS_DOWN`]'s flags can't be read.
pub(crate) fn flags() -> FakeFeatureFlags {
    let mut flags = FakeFeatureFlags::default();
    flags.set(
        user(RATER),
        Ok(FlagSnapshot::new([(
            AGENT_RESPONSE_FEEDBACK_FLAG.to_owned(),
            FlagValue::Boolean(true),
        )])),
    );
    flags.set(
        user(FLAG_OFF),
        Ok(FlagSnapshot::new([(
            AGENT_RESPONSE_FEEDBACK_FLAG.to_owned(),
            FlagValue::Boolean(false),
        )])),
    );
    flags.set(user(FLAGS_DOWN), Err("posthog unreachable".to_owned()));
    flags
}

/// A view receipt `user` holds for an entity.
pub(crate) fn receipt<T: RequiredPermission>(
    user_id: &str,
    entity_id: &str,
    entity_type: EntityType,
) -> EntityAccessReceipt<T> {
    EntityAccessReceipt::try_new_authenticated_user(
        user(user_id),
        Entity {
            entity_id: entity_id.to_owned(),
            entity_type,
        },
        EntityPermission::AccessLevel {
            access_level: AccessLevel::View,
        },
    )
    .expect("view satisfies the requirement")
}

/// One stored row.
#[derive(Debug, Clone)]
pub(crate) struct StoredRow {
    pub(crate) write: FeedbackWrite,
    pub(crate) event: FeedbackEvent,
}

/// The append-only table, kept in memory, honoring the port's contract.
#[derive(Clone, Default)]
pub(crate) struct FakeRepo {
    pub(crate) rows: Arc<Mutex<Vec<StoredRow>>>,
}

impl FakeRepo {
    pub(crate) fn rows(&self) -> Vec<StoredRow> {
        self.rows.lock().expect("rows").clone()
    }
}

fn same_response(row: &FeedbackWrite, write: &FeedbackWrite) -> bool {
    row.user == write.user
        && row.subject.kind() == write.subject.kind()
        && row.subject.subject_id() == write.subject.subject_id()
        && row.subject.turn() == write.subject.turn()
}

fn state_of(row: &StoredRow) -> FeedbackState {
    FeedbackState {
        rating: row.write.rating,
        note: row.write.note.as_ref().map(|note| note.as_str().to_owned()),
        updated_at: Some(row.event.created_at),
    }
}

impl FeedbackRepo for FakeRepo {
    async fn append_if_changed(&self, write: &FeedbackWrite) -> Result<AppendOutcome, Report> {
        let mut rows = self.rows.lock().expect("rows");
        let latest = rows
            .iter()
            .rev()
            .find(|row| same_response(&row.write, write))
            .map(state_of)
            .unwrap_or_default();

        if let Some(stored) = rows.iter().find(|row| row.write.id == write.id) {
            if !same_response(&stored.write, write) {
                return Ok(AppendOutcome::IdTaken);
            }
            return Ok(AppendOutcome::Replayed(latest));
        }

        let note = write.note.as_ref().map(|note| note.as_str().to_owned());
        if latest.rating == write.rating && latest.note == note {
            return Ok(AppendOutcome::Unchanged(latest));
        }

        // Later rows sort later, as clock_timestamp does under the lock.
        let created_at = Utc::now() + TimeDelta::milliseconds(rows.len() as i64);
        let context = &write.context;
        let row = StoredRow {
            write: write.clone(),
            event: FeedbackEvent {
                id: write.id,
                user_id: write.user.as_ref().to_owned(),
                subject_kind: write.subject.kind(),
                container_id: write.subject.container_id(),
                subject_id: write.subject.subject_id(),
                turn: write.subject.turn(),
                rating: write.rating,
                note: note.clone(),
                surface: write.surface,
                message_parent_type: context.message_parent_type.map(str::to_owned),
                agent_session_id: context.agent_session_id.map(|id| id.as_uuid()),
                agent_bot_id: context.agent_bot_id.map(|id| id.as_uuid()),
                agent_user_id: context
                    .agent_user_id
                    .as_ref()
                    .map(|id| id.as_ref().to_owned()),
                agent_kind: context.agent_kind,
                harness: context.harness.clone(),
                model: context.model.clone(),
                trace_id: write.trace_id.clone(),
                created_at,
            },
        };
        let state = state_of(&row);
        rows.push(row);
        Ok(AppendOutcome::Created(state))
    }

    async fn current_in_container(
        &self,
        user: &MacroUserIdStr<'static>,
        kind: SubjectKind,
        container_id: &str,
    ) -> Result<Vec<MyFeedback>, Report> {
        let rows = self.rows.lock().expect("rows");
        let mut latest: Vec<&StoredRow> = Vec::new();
        for row in rows.iter().filter(|row| {
            row.write.user == *user
                && row.write.subject.kind() == kind
                && row.write.subject.container_id() == container_id
        }) {
            latest.retain(|kept| !same_response(&kept.write, &row.write));
            latest.push(row);
        }
        Ok(latest
            .into_iter()
            .filter_map(|row| {
                Some(MyFeedback {
                    subject_id: row.event.subject_id,
                    turn: row.event.turn,
                    rating: row.write.rating?,
                    note: row.event.note.clone(),
                    updated_at: row.event.created_at,
                })
            })
            .collect())
    }

    async fn events_after(
        &self,
        after: Option<ExportCursor>,
        limit: ExportLimit,
    ) -> Result<Vec<FeedbackEvent>, Report> {
        let rows = self.rows.lock().expect("rows");
        Ok(rows
            .iter()
            .map(|row| row.event.clone())
            .filter(|event| match after {
                Some(after) => {
                    (event.created_at, event.id) > (after.after_created_at, after.after_id)
                }
                None => true,
            })
            .take(usize::from(limit.get()))
            .collect())
    }
}

/// Sessions by id.
#[derive(Clone, Default)]
pub(crate) struct FakeSessions(pub(crate) HashMap<Uuid, SessionFacts>);

impl AgentSessions for FakeSessions {
    async fn session(&self, id: AgentSessionId) -> Result<Option<SessionFacts>, Report> {
        Ok(self.0.get(&id.as_uuid()).cloned())
    }
}

/// Runs by (routine, run).
#[derive(Clone, Default)]
pub(crate) struct FakeRuns(pub(crate) HashMap<(Uuid, Uuid), RunFacts>);

impl RoutineRuns for FakeRuns {
    async fn run(&self, routine_id: Uuid, run_id: Uuid) -> Result<Option<RunFacts>, Report> {
        Ok(self.0.get(&(routine_id, run_id)).cloned())
    }
}

/// The agent accounts.
#[derive(Clone, Default)]
pub(crate) struct FakeAccounts(pub(crate) HashSet<String>);

impl AgentAccounts for FakeAccounts {
    async fn is_agent_account(&self, user: &MacroUserIdStr<'_>) -> Result<bool, Report> {
        Ok(self.0.contains(user.as_ref()))
    }
}

/// Messages by id; a message is found only under its own parent's receipt.
#[derive(Default)]
pub(crate) struct FakeMessages(pub(crate) HashMap<Uuid, Message>);

#[async_trait::async_trait]
impl MessageReader for FakeMessages {
    async fn get(
        &self,
        access: EntityAccessReceipt<MessageView>,
        id: Uuid,
    ) -> Result<Message, MessageError> {
        self.0
            .get(&id)
            .filter(|message| message.parent.entity_id() == access.entity().entity_id)
            .cloned()
            .ok_or(MessageError::NotFound)
    }
    async fn get_thread(
        &self,
        _access: EntityAccessReceipt<MessageView>,
        _root: Uuid,
    ) -> Result<MessageThread, MessageError> {
        Err(MessageError::NotFound)
    }
    async fn timeline(
        &self,
        _access: EntityAccessReceipt<MessageView>,
        _query: MessageTimelineQuery,
    ) -> Result<MessagePage, MessageError> {
        Err(MessageError::NotFound)
    }
    async fn timeline_entries(
        &self,
        _access: EntityAccessReceipt<MessageView>,
        _query: MessageTimelineQuery,
    ) -> Result<MessageTimelinePage, MessageError> {
        Err(MessageError::NotFound)
    }
    async fn preceding(
        &self,
        _access: EntityAccessReceipt<MessageView>,
        _id: Uuid,
        _limit: u16,
    ) -> Result<Vec<Message>, MessageError> {
        Err(MessageError::NotFound)
    }
    async fn resolve_legacy(
        &self,
        _access: EntityAccessReceipt<MessageView>,
        _id: i64,
        _is_thread: bool,
    ) -> Result<Message, MessageError> {
        Err(MessageError::NotFound)
    }
    async fn parent_of(&self, _id: Uuid) -> Result<Option<MessageParent>, MessageError> {
        Ok(None)
    }
}

/// A message on `parent` from `sender` saying `content`.
pub(crate) fn message(
    id: Uuid,
    parent: MessageParent,
    sender: channel_sender::ChannelSender<'static>,
    content: &str,
) -> Message {
    let now = Utc::now();
    Message {
        id,
        parent,
        thread_id: None,
        kind: MessageKind::Message,
        sender_id: sender,
        guest_name: None,
        imported_author: None,
        bot_profile: None,
        mentions: Vec::new(),
        triggered_by: None,
        triggered_via: None,
        content: content.to_owned(),
        created_at: now,
        updated_at: now,
        edited_at: None,
        deleted_at: None,
        attachments: Vec::new(),
        reactions: Vec::new(),
    }
}

/// The service under test, over fakes.
pub(crate) type TestService =
    FeedbackService<FakeRepo, FakeFeatureFlags, FakeSessions, FakeRuns, FakeAccounts>;

/// What a test can see of the service's world.
pub(crate) struct World {
    pub(crate) repo: FakeRepo,
    pub(crate) sessions: FakeSessions,
    pub(crate) runs: FakeRuns,
    pub(crate) accounts: FakeAccounts,
    pub(crate) messages: FakeMessages,
    pub(crate) flags: Option<FakeFeatureFlags>,
}

impl Default for World {
    fn default() -> Self {
        Self {
            repo: FakeRepo::default(),
            sessions: FakeSessions::default(),
            runs: FakeRuns::default(),
            accounts: FakeAccounts::default(),
            messages: FakeMessages::default(),
            flags: Some(flags()),
        }
    }
}

impl World {
    /// The service, and the table it writes to.
    pub(crate) fn service(self) -> (TestService, FakeRepo) {
        let repo = self.repo.clone();
        (
            FeedbackService::new(
                self.repo,
                self.flags,
                self.sessions,
                self.runs,
                self.accounts,
                Arc::new(self.messages),
            ),
            repo,
        )
    }
}
