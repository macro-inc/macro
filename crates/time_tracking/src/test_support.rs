//! Hand-written doubles of the domain's ports, shared by the service and
//! router tests.

use std::{
    collections::{HashMap, HashSet},
    convert::Infallible,
    sync::{Arc, Mutex},
};

use chrono::{DateTime, TimeZone, Utc};
use entity_access::domain::{
    models::{
        AccessError, AccessLevel, BotAccessScope, BotId, CallChannelInfo, Entity,
        EntityAccessReceipt, EntityPermission, EntityType, RequiredPermission, TeamRole,
        UserTeamInfo,
    },
    ports::EntityAccessService,
};
use macro_user_id::{
    cowlike::CowLike, lowercased::Lowercase, user_id::MacroUserId, user_id::MacroUserIdStr,
};
use uuid::Uuid;

use crate::domain::{
    events::{TimeEntryEventPublisher, TimeEntryMacroEvent, TimeEntryTopicEvent},
    models::{EntryValues, LoggedTime, NewEntryRow, RunningTimer, TimeEntry, TimeEntryCursor},
    ports::{
        Clock, DeleteEntryOutcome, InsertEntryOutcome, StartTimerOutcome, StopTimerOutcome,
        TimeTrackingChange, TimeTrackingRepository, TimeTrackingRollout, TimeTrackingUpdates,
        UpdateEntryOutcome,
    },
};

pub(crate) const AUTHOR: &str = "macro|author@example.com";
pub(crate) const EDITOR: &str = "macro|editor@example.com";
pub(crate) const VIEWER: &str = "macro|viewer@example.com";
pub(crate) const OUTSIDER: &str = "macro|outsider@example.com";
pub(crate) const TASK: &str = "00000000-0000-0000-0000-0000000000a1";
pub(crate) const OTHER_TASK: &str = "00000000-0000-0000-0000-0000000000a2";

pub(crate) fn user(id: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(id).unwrap().into_owned()
}

pub(crate) fn noon() -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 11, 20, 12, 0, 0)
        .single()
        .unwrap()
}

#[derive(Default)]
struct RepoState {
    entries: HashMap<Uuid, TimeEntry>,
    timers: HashMap<String, RunningTimer>,
    live_tasks: HashSet<String>,
    timer_changes_before_start: u8,
    edit_before_next_update: Option<u16>,
}

/// An in-memory repository that keeps each task's total as the sum of its entries.
#[derive(Clone, Default)]
pub(crate) struct FakeRepo(Arc<Mutex<RepoState>>);

impl FakeRepo {
    pub(crate) fn with_live_tasks(tasks: &[&str]) -> Self {
        let repo = Self::default();
        repo.0
            .lock()
            .unwrap()
            .live_tasks
            .extend(tasks.iter().map(|task| task.to_string()));
        repo
    }

    pub(crate) fn trash(&self, task_id: &str) {
        self.0.lock().unwrap().live_tasks.remove(task_id);
    }

    pub(crate) fn put_timer(&self, user_id: &str, timer: RunningTimer) {
        self.0
            .lock()
            .unwrap()
            .timers
            .insert(user_id.to_string(), timer);
    }

    /// Another device sets the entry's minutes just before the next update.
    pub(crate) fn edit_elsewhere_before_next_update(&self, minutes: u16) {
        self.0.lock().unwrap().edit_before_next_update = Some(minutes);
    }

    /// The next `count` starts find the person's timer changed.
    pub(crate) fn change_timer_before_next_starts(&self, count: u8) {
        self.0.lock().unwrap().timer_changes_before_start = count;
    }

    pub(crate) fn stored_timer(&self, user_id: &str) -> Option<RunningTimer> {
        self.0.lock().unwrap().timers.get(user_id).cloned()
    }

    pub(crate) fn entry_count(&self) -> usize {
        self.0.lock().unwrap().entries.len()
    }

    pub(crate) fn total(&self, task_id: &str) -> u32 {
        total_of(&self.0.lock().unwrap(), task_id)
    }
}

fn total_of(state: &RepoState, task_id: &str) -> u32 {
    state
        .entries
        .values()
        .filter(|entry| entry.task_id == task_id)
        .map(|entry| u32::from(entry.minutes))
        .sum()
}

fn entry_from(row: &NewEntryRow) -> TimeEntry {
    TimeEntry {
        id: row.id,
        task_id: row.task_id.clone(),
        user_id: row.user_id.clone(),
        date: row.values.date,
        minutes: row.values.minutes,
        note: row.values.note.clone(),
        started_at: row.values.span.map(|span| span.started_at),
        ended_at: row.values.span.map(|span| span.ended_at),
        source: row.source,
        created_at: noon(),
        updated_at: noon(),
    }
}

fn store(state: &mut RepoState, row: &NewEntryRow) -> LoggedTime {
    let entry = entry_from(row);
    state.entries.insert(entry.id, entry.clone());
    LoggedTime {
        total_minutes: total_of(state, &row.task_id),
        entry,
    }
}

impl TimeTrackingRepository for FakeRepo {
    type Err = Infallible;

    async fn entries(
        &self,
        task_id: &str,
        limit: u16,
        after: Option<TimeEntryCursor>,
    ) -> Result<Vec<TimeEntry>, Infallible> {
        let state = self.0.lock().unwrap();
        let mut entries: Vec<TimeEntry> = state
            .entries
            .values()
            .filter(|entry| entry.task_id == task_id)
            .filter(|entry| {
                after.is_none_or(|cursor| (entry.date, entry.id) < (cursor.date, cursor.id))
            })
            .cloned()
            .collect();
        entries.sort_by(|a, b| (b.date, b.id).cmp(&(a.date, a.id)));
        entries.truncate(usize::from(limit));
        Ok(entries)
    }

    async fn task_total(&self, task_id: &str) -> Result<u32, Infallible> {
        Ok(self.total(task_id))
    }

    async fn entry(&self, id: Uuid) -> Result<Option<TimeEntry>, Infallible> {
        Ok(self.0.lock().unwrap().entries.get(&id).cloned())
    }

    async fn insert_entry(&self, row: &NewEntryRow) -> Result<InsertEntryOutcome, Infallible> {
        let mut state = self.0.lock().unwrap();
        if !state.live_tasks.contains(&row.task_id) {
            return Ok(InsertEntryOutcome::TaskUnavailable);
        }
        if let Some(existing) = state.entries.get(&row.id) {
            return Ok(InsertEntryOutcome::Existing(existing.clone()));
        }
        Ok(InsertEntryOutcome::Inserted(store(&mut state, row)))
    }

    async fn update_entry(
        &self,
        id: Uuid,
        user_id: &MacroUserIdStr<'_>,
        values: &EntryValues,
        read_updated_at: DateTime<Utc>,
    ) -> Result<UpdateEntryOutcome, Infallible> {
        let mut state = self.0.lock().unwrap();
        if let Some(minutes) = state.edit_before_next_update.take()
            && let Some(entry) = state.entries.get_mut(&id)
        {
            entry.minutes = minutes;
            entry.updated_at += chrono::TimeDelta::seconds(1);
        }
        let Some(entry) = state
            .entries
            .get(&id)
            .filter(|entry| entry.user_id.as_ref() == user_id.as_ref())
            .cloned()
        else {
            return Ok(UpdateEntryOutcome::EntryMissing);
        };
        if !state.live_tasks.contains(&entry.task_id) {
            return Ok(UpdateEntryOutcome::TaskUnavailable);
        }
        if entry.updated_at != read_updated_at {
            return Ok(UpdateEntryOutcome::Changed);
        }
        let updated = TimeEntry {
            date: values.date,
            minutes: values.minutes,
            note: values.note.clone(),
            started_at: values.span.map(|span| span.started_at),
            ended_at: values.span.map(|span| span.ended_at),
            updated_at: entry.updated_at + chrono::TimeDelta::seconds(1),
            ..entry
        };
        state.entries.insert(id, updated.clone());
        Ok(UpdateEntryOutcome::Written(LoggedTime {
            total_minutes: total_of(&state, &updated.task_id),
            entry: updated,
        }))
    }

    async fn delete_entry(
        &self,
        id: Uuid,
        user_id: &MacroUserIdStr<'_>,
    ) -> Result<DeleteEntryOutcome, Infallible> {
        let mut state = self.0.lock().unwrap();
        let Some(task_id) = state
            .entries
            .get(&id)
            .filter(|entry| entry.user_id.as_ref() == user_id.as_ref())
            .map(|entry| entry.task_id.clone())
        else {
            return Ok(DeleteEntryOutcome::EntryMissing);
        };
        if !state.live_tasks.contains(&task_id) {
            return Ok(DeleteEntryOutcome::TaskUnavailable);
        }
        state.entries.remove(&id);
        Ok(DeleteEntryOutcome::Deleted(total_of(&state, &task_id)))
    }

    async fn timer(
        &self,
        user_id: &MacroUserIdStr<'_>,
    ) -> Result<Option<RunningTimer>, Infallible> {
        Ok(self.stored_timer(user_id.as_ref()))
    }

    async fn start_timer(
        &self,
        user_id: &MacroUserIdStr<'_>,
        timer: &RunningTimer,
        previous: Option<&NewEntryRow>,
    ) -> Result<StartTimerOutcome, Infallible> {
        let mut state = self.0.lock().unwrap();
        if state.timer_changes_before_start > 0 {
            state.timer_changes_before_start -= 1;
            return Ok(StartTimerOutcome::TimerChanged);
        }
        if !state.live_tasks.contains(&timer.task_id) {
            return Ok(StartTimerOutcome::TaskUnavailable);
        }
        if state.entries.contains_key(&timer.id) {
            return Ok(StartTimerOutcome::IdTaken);
        }
        let current = state.timers.get(user_id.as_ref()).map(|timer| timer.id);
        if current != previous.map(|row| row.id) {
            return Ok(StartTimerOutcome::TimerChanged);
        }
        let stopped = previous.map(|row| store(&mut state, row));
        state
            .timers
            .insert(user_id.as_ref().to_string(), timer.clone());
        Ok(StartTimerOutcome::Started(stopped))
    }

    async fn stop_timer(&self, row: &NewEntryRow) -> Result<StopTimerOutcome, Infallible> {
        let mut state = self.0.lock().unwrap();
        let running = state
            .timers
            .get(row.user_id.as_ref())
            .is_some_and(|timer| timer.id == row.id);
        if !running {
            return Ok(StopTimerOutcome::TimerGone);
        }
        state.timers.remove(row.user_id.as_ref());
        Ok(StopTimerOutcome::Stopped(store(&mut state, row)))
    }

    async fn discard_timer(
        &self,
        user_id: &MacroUserIdStr<'_>,
        timer_id: Uuid,
    ) -> Result<(), Infallible> {
        let mut state = self.0.lock().unwrap();
        if state
            .timers
            .get(user_id.as_ref())
            .is_some_and(|timer| timer.id == timer_id)
        {
            state.timers.remove(user_id.as_ref());
        }
        Ok(())
    }
}

/// Access levels per (user, task); anything else is not found.
#[derive(Clone, Default)]
pub(crate) struct FakeAccess(Arc<Mutex<HashMap<(String, String), AccessLevel>>>);

impl FakeAccess {
    pub(crate) fn grant(self, user_id: &str, task_id: &str, level: AccessLevel) -> Self {
        self.0
            .lock()
            .unwrap()
            .insert((user_id.to_string(), task_id.to_string()), level);
        self
    }

    /// Author and editor edit both tasks, the viewer views them, the outsider has nothing.
    pub(crate) fn team() -> Self {
        let mut access = Self::default();
        for task in [TASK, OTHER_TASK] {
            access = access
                .grant(AUTHOR, task, AccessLevel::Edit)
                .grant(EDITOR, task, AccessLevel::Edit)
                .grant(VIEWER, task, AccessLevel::View);
        }
        access
    }
}

impl EntityAccessService for FakeAccess {
    async fn generate_entity_access_receipt<T: RequiredPermission>(
        &self,
        user_id: &MacroUserId<Lowercase<'_>>,
        _user_org_id: Option<i64>,
        entity_id: &str,
        entity_type: EntityType,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        let level = self
            .0
            .lock()
            .unwrap()
            .get(&(user_id.as_ref().to_string(), entity_id.to_string()))
            .copied()
            .ok_or(AccessError::NotFound("document"))?;
        EntityAccessReceipt::try_new_authenticated_user(
            user(user_id.as_ref()),
            Entity {
                entity_id: entity_id.to_string(),
                entity_type,
            },
            EntityPermission::AccessLevel {
                access_level: level,
            },
        )
    }

    async fn generate_bot_entity_access_receipt<T: RequiredPermission>(
        &self,
        _bot_id: BotId,
        _scope: BotAccessScope,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        unimplemented!("time tracking mints no bot receipts")
    }

    async fn get_access_level(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<Option<AccessLevel>, AccessError> {
        unimplemented!("time tracking mints receipts")
    }

    async fn check_access(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
        _required_level: AccessLevel,
    ) -> Result<AccessLevel, AccessError> {
        unimplemented!("time tracking mints receipts")
    }

    async fn check_public_access(
        &self,
        _entity_id: &str,
        _entity_type: EntityType,
        _required_level: AccessLevel,
    ) -> Result<AccessLevel, AccessError> {
        unimplemented!("time tracking mints receipts")
    }

    async fn get_entity_permission(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
        _user_org_id: Option<i64>,
    ) -> Result<EntityPermission, AccessError> {
        unimplemented!("time tracking mints receipts")
    }

    async fn get_crm_entity_permission_with_team(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<(EntityPermission, Uuid, TeamRole), AccessError> {
        unimplemented!("time tracking reads no CRM records")
    }

    async fn get_users_by_entity(
        &self,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<Vec<MacroUserIdStr<'static>>, AccessError> {
        unimplemented!("time tracking lists no audiences")
    }

    async fn get_call_channel(
        &self,
        _call_id: &Uuid,
    ) -> Result<Option<CallChannelInfo>, AccessError> {
        unimplemented!("time tracking reads no calls")
    }

    async fn get_call_channel_by_channel_id(
        &self,
        _channel_id: &Uuid,
    ) -> Result<Option<CallChannelInfo>, AccessError> {
        unimplemented!("time tracking reads no calls")
    }

    async fn get_user_team(
        &self,
        _user_id: &MacroUserId<Lowercase<'_>>,
    ) -> Result<Option<UserTeamInfo>, AccessError> {
        unimplemented!("time tracking reads no teams")
    }
}

/// A fixed rollout answer.
pub(crate) struct FixedRollout(pub(crate) bool);

#[async_trait::async_trait]
impl TimeTrackingRollout for FixedRollout {
    async fn enabled_for(&self, _user_id: &MacroUserIdStr<'_>) -> bool {
        self.0
    }
}

/// Every published event, in order.
#[derive(Clone, Default)]
pub(crate) struct RecordingPublisher(Arc<Mutex<Vec<(String, TimeEntryTopicEvent)>>>);

impl RecordingPublisher {
    pub(crate) fn published(&self) -> Vec<(String, TimeEntryTopicEvent)> {
        self.0.lock().unwrap().clone()
    }
}

impl TimeEntryEventPublisher for RecordingPublisher {
    fn publish(&self, event: TimeEntryMacroEvent) {
        use macro_event_broker::MacroEvent;
        self.0
            .lock()
            .unwrap()
            .push((event.key().to_string(), event.event().event.clone()));
    }
}

/// Every session update sent, in order, with the person it went to.
#[derive(Clone, Default)]
pub(crate) struct RecordingUpdates(Arc<Mutex<Vec<(String, TimeTrackingChange)>>>);

impl RecordingUpdates {
    pub(crate) fn sent(&self) -> Vec<(String, TimeTrackingChange)> {
        self.0.lock().unwrap().clone()
    }
}

impl TimeTrackingUpdates for RecordingUpdates {
    fn changed(&self, user_id: &MacroUserIdStr<'static>, change: TimeTrackingChange) {
        self.0
            .lock()
            .unwrap()
            .push((user_id.as_ref().to_string(), change));
    }
}

/// A clock the test moves.
#[derive(Clone)]
pub(crate) struct TestClock(Arc<Mutex<DateTime<Utc>>>);

impl TestClock {
    pub(crate) fn at(now: DateTime<Utc>) -> Self {
        Self(Arc::new(Mutex::new(now)))
    }

    pub(crate) fn advance(&self, by: chrono::TimeDelta) {
        let mut now = self.0.lock().unwrap();
        *now += by;
    }
}

impl Clock for TestClock {
    fn now(&self) -> DateTime<Utc> {
        *self.0.lock().unwrap()
    }
}
