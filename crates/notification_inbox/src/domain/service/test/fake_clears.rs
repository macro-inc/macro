//! An in-memory bulk action store over the fake notifications, with the
//! leases and fencing of the real one, and a hook that lets a test act
//! between a clear's chunks.

use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

use attention_feed::test_support::{FakeNotifications, at, with_state};
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use notification::domain::{
    bulk_action::{
        AppliedChunk, ApplyChunk, BulkAction, BulkActionLease, BulkActionStatus, BulkActionStore,
        ChunkOutcome, CreatedBulkAction, NewBulkAction, RevertedChunk, UndoRequested,
    },
    models::NotificationState,
};
use rootcause::Report;
use uuid::Uuid;

/// One ledger row.
struct LedgerRow {
    notification_id: Uuid,
    was_unseen: bool,
    group_key: String,
    undone: bool,
}

/// One stored action with its lease and ledger.
struct Stored {
    action: BulkAction,
    token: Uuid,
    lease_expired: bool,
    ledger: Vec<LedgerRow>,
}

/// What a test does just before apply chunk number `n` (from 0) is checked.
type BeforeChunk = Box<dyn FnMut(usize, &FakeClears) + Send>;

/// The fake store. Clones share state.
#[derive(Clone)]
pub(super) struct FakeClears {
    notifications: FakeNotifications,
    stored: Arc<Mutex<HashMap<Uuid, Stored>>>,
    /// The time a new action is stamped with.
    pub(super) now: Arc<Mutex<DateTime<Utc>>>,
    before_chunk: Arc<Mutex<Option<BeforeChunk>>>,
    chunks: Arc<Mutex<usize>>,
    /// Apply chunks whose number is listed fail, once each.
    pub(super) failing_chunks: Arc<Mutex<Vec<usize>>>,
}

impl FakeClears {
    /// A store changing `notifications`, stamping actions well after every
    /// fixture notification.
    pub(super) fn over(notifications: FakeNotifications) -> Self {
        Self {
            notifications,
            stored: Arc::default(),
            now: Arc::new(Mutex::new(at(59))),
            before_chunk: Arc::default(),
            chunks: Arc::default(),
            failing_chunks: Arc::default(),
        }
    }

    /// Run `hook` just before each apply chunk is checked.
    pub(super) fn before_chunk(&self, hook: impl FnMut(usize, &FakeClears) + Send + 'static) {
        *self.before_chunk.lock().unwrap() = Some(Box::new(hook));
    }

    /// Apply chunks attempted so far.
    pub(super) fn chunks(&self) -> usize {
        *self.chunks.lock().unwrap()
    }

    /// The worker holding `id` died: its lease has run out.
    pub(super) fn expire_lease(&self, id: Uuid) {
        if let Some(stored) = self.stored.lock().unwrap().get_mut(&id) {
            stored.lease_expired = true;
        }
    }

    /// Start an undo the way a second request would.
    pub(super) fn undo_now(&self, id: Uuid) -> Option<BulkActionLease> {
        let mut stored = self.stored.lock().unwrap();
        let stored = stored.get_mut(&id)?;
        if !matches!(
            stored.action.status,
            BulkActionStatus::Applying | BulkActionStatus::Done | BulkActionStatus::Failed
        ) {
            return None;
        }
        stored.action.status = BulkActionStatus::Undoing;
        stored.action.revision += 1;
        stored.token = Uuid::now_v7();
        stored.lease_expired = false;
        Some(lease(stored))
    }

    fn set_state(
        &self,
        id: Uuid,
        change: impl Fn(NotificationState) -> Option<NotificationState>,
    ) -> bool {
        let mut by_entity = self.notifications.by_entity.lock().unwrap();
        let Some(notification) = by_entity
            .values_mut()
            .flatten()
            .find(|notification| notification.notification_id == id)
        else {
            return false;
        };
        match change(notification.state) {
            Some(state) => {
                *notification = with_state(notification, state);
                true
            }
            None => false,
        }
    }

    fn created_at(&self, id: Uuid) -> Option<DateTime<Utc>> {
        self.notifications
            .by_entity
            .lock()
            .unwrap()
            .values()
            .flatten()
            .find(|notification| notification.notification_id == id)
            .map(|notification| notification.created_at)
    }

    fn state(&self, id: Uuid) -> Option<NotificationState> {
        self.notifications
            .by_entity
            .lock()
            .unwrap()
            .values()
            .flatten()
            .find(|notification| notification.notification_id == id)
            .map(|notification| notification.state)
    }
}

fn lease(stored: &Stored) -> BulkActionLease {
    BulkActionLease {
        action_id: stored.action.id,
        user_id: stored.action.user_id.clone(),
        token: stored.token,
    }
}

impl BulkActionStore for FakeClears {
    async fn create(&self, new: NewBulkAction) -> Result<CreatedBulkAction, Report> {
        let mut stored = self.stored.lock().unwrap();
        if let Some(existing) = stored.get(&new.id) {
            return Ok(
                if existing.action.user_id == new.user_id && existing.action.scope == new.scope {
                    CreatedBulkAction::Existing(existing.action.clone())
                } else {
                    CreatedBulkAction::Conflict
                },
            );
        }
        let now = *self.now.lock().unwrap();
        let created = Stored {
            action: BulkAction {
                id: new.id,
                user_id: new.user_id,
                scope: new.scope,
                as_of: now,
                status: BulkActionStatus::Applying,
                cursor: None,
                units: 0,
                applied: 0,
                restored: 0,
                revision: 0,
                created_at: now,
            },
            token: Uuid::now_v7(),
            lease_expired: false,
            ledger: Vec::new(),
        };
        let outcome = CreatedBulkAction::Created(created.action.clone(), lease(&created));
        stored.insert(new.id, created);
        Ok(outcome)
    }

    async fn apply_chunk(
        &self,
        lease: &BulkActionLease,
        chunk: ApplyChunk,
    ) -> Result<ChunkOutcome<AppliedChunk>, Report> {
        let number = {
            let mut chunks = self.chunks.lock().unwrap();
            *chunks += 1;
            *chunks - 1
        };
        let hook = self.before_chunk.lock().unwrap().take();
        if let Some(mut hook) = hook {
            hook(number, self);
            self.before_chunk.lock().unwrap().get_or_insert(hook);
        }
        {
            let mut failing = self.failing_chunks.lock().unwrap();
            if let Some(index) = failing.iter().position(|failing| *failing == number) {
                failing.remove(index);
                return Err(rootcause::report!("chunk {number} failed"));
            }
        }
        let as_of = {
            let stored = self.stored.lock().unwrap();
            let Some(stored) = stored.get(&lease.action_id) else {
                return Ok(ChunkOutcome::Stopped);
            };
            if stored.token != lease.token || stored.action.status != BulkActionStatus::Applying {
                return Ok(ChunkOutcome::Stopped);
            }
            stored.action.as_of
        };
        let mut changed = Vec::new();
        let mut rows = Vec::new();
        for item in chunk.items {
            if self
                .created_at(item.notification_id)
                .is_none_or(|at| at > as_of)
            {
                continue;
            }
            let Some(before) = self.state(item.notification_id) else {
                continue;
            };
            if self.set_state(item.notification_id, |state| {
                (state != NotificationState::Done).then_some(NotificationState::Done)
            }) {
                changed.push(item.notification_id);
                rows.push(LedgerRow {
                    notification_id: item.notification_id,
                    was_unseen: before == NotificationState::Unseen,
                    group_key: item.group_key,
                    undone: false,
                });
            }
        }
        let mut stored = self.stored.lock().unwrap();
        let stored = stored.get_mut(&lease.action_id).expect("checked above");
        stored.ledger.extend(rows);
        stored.action.cursor = chunk.cursor;
        stored.action.units += chunk.units;
        stored.action.applied += u32::try_from(changed.len()).unwrap();
        stored.action.revision += 1;
        if chunk.finished {
            stored.action.status = BulkActionStatus::Done;
        }
        Ok(ChunkOutcome::Committed(AppliedChunk {
            action: stored.action.clone(),
            changed,
        }))
    }

    async fn request_undo(
        &self,
        user_id: &MacroUserIdStr<'_>,
        id: Uuid,
    ) -> Result<Option<UndoRequested>, Report> {
        let owned = self
            .stored
            .lock()
            .unwrap()
            .get(&id)
            .is_some_and(|stored| stored.action.user_id.as_ref() == user_id.as_ref());
        if !owned {
            return Ok(None);
        }
        if let Some(lease) = self.undo_now(id) {
            let action = self.stored.lock().unwrap()[&id].action.clone();
            return Ok(Some(UndoRequested::Started(action, lease)));
        }
        Ok(Some(UndoRequested::Already(
            self.stored.lock().unwrap()[&id].action.clone(),
        )))
    }

    async fn revert_chunk(
        &self,
        lease: &BulkActionLease,
        limit: u16,
    ) -> Result<ChunkOutcome<RevertedChunk>, Report> {
        let batch: Vec<(Uuid, bool, String)> = {
            let mut stored = self.stored.lock().unwrap();
            let Some(stored) = stored.get_mut(&lease.action_id) else {
                return Ok(ChunkOutcome::Stopped);
            };
            if stored.token != lease.token || stored.action.status != BulkActionStatus::Undoing {
                return Ok(ChunkOutcome::Stopped);
            }
            stored
                .ledger
                .iter_mut()
                .filter(|row| !row.undone)
                .take(usize::from(limit))
                .map(|row| {
                    row.undone = true;
                    (row.notification_id, row.was_unseen, row.group_key.clone())
                })
                .collect()
        };
        let exhausted = batch.is_empty();
        let mut groups = Vec::new();
        for (id, was_unseen, group) in batch {
            let reopened = self.set_state(id, |state| {
                (state == NotificationState::Done).then_some(if was_unseen {
                    NotificationState::Unseen
                } else {
                    NotificationState::Seen
                })
            });
            if reopened {
                groups.push(group);
            }
        }
        let reopened = u32::try_from(groups.len()).unwrap();
        groups.sort_unstable();
        groups.dedup();
        let mut stored = self.stored.lock().unwrap();
        let stored = stored.get_mut(&lease.action_id).expect("checked above");
        stored.action.restored += reopened;
        stored.action.revision += 1;
        if exhausted {
            stored.action.status = BulkActionStatus::Undone;
        }
        Ok(ChunkOutcome::Committed(RevertedChunk {
            action: stored.action.clone(),
            groups,
        }))
    }

    async fn claim_stalled(
        &self,
        limit: u16,
    ) -> Result<Vec<(BulkAction, BulkActionLease)>, Report> {
        Ok(self
            .stored
            .lock()
            .unwrap()
            .values_mut()
            .filter(|stored| stored.lease_expired && stored.action.status.is_running())
            .take(usize::from(limit))
            .map(|stored| {
                stored.token = Uuid::now_v7();
                stored.lease_expired = false;
                stored.action.revision += 1;
                (stored.action.clone(), lease(stored))
            })
            .collect())
    }

    async fn release(&self, lease: &BulkActionLease) -> Result<(), Report> {
        if let Some(stored) = self.stored.lock().unwrap().get_mut(&lease.action_id)
            && stored.token == lease.token
        {
            stored.lease_expired = true;
        }
        Ok(())
    }

    async fn get(
        &self,
        user_id: &MacroUserIdStr<'_>,
        id: Uuid,
    ) -> Result<Option<BulkAction>, Report> {
        Ok(self
            .stored
            .lock()
            .unwrap()
            .get(&id)
            .filter(|stored| stored.action.user_id.as_ref() == user_id.as_ref())
            .map(|stored| stored.action.clone()))
    }

    async fn running(&self, user_id: &MacroUserIdStr<'_>) -> Result<Vec<BulkAction>, Report> {
        Ok(self
            .stored
            .lock()
            .unwrap()
            .values()
            .filter(|stored| {
                stored.action.user_id.as_ref() == user_id.as_ref()
                    && stored.action.status.is_running()
            })
            .map(|stored| stored.action.clone())
            .collect())
    }

    async fn purge_finished(&self, _before: DateTime<Utc>, _limit: u16) -> Result<u64, Report> {
        Ok(0)
    }
}
