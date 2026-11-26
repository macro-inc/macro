use super::super::*;
use async_trait::async_trait;
use std::{
    collections::{HashMap, HashSet},
    sync::{
        Mutex,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    },
};

pub struct FakeEnrollment {
    pub team_id: TeamId,
    pub item_id: ItemId,
    pub active: bool,
    pub grace_elapsed: bool,
    pub cleanup_started: bool,
}

pub struct FakeRepository {
    pub import_capacity: AtomicUsize,
    pub live_leases: Arc<AtomicUsize>,
    pub records: Mutex<HashMap<Uuid, Record>>,
    pub favorites: Mutex<HashSet<(TeamId, ItemId, String)>>,
    pub staged: Mutex<HashMap<Uuid, Record>>,
    /// Held across every staging check and insert, like the operation-id lock:
    /// an intent and an enrollment never reserve the same id.
    pub reservations: Mutex<()>,
    /// The agent and action of each agent-published intent; absent means human.
    pub intent_agents: Mutex<HashMap<Uuid, (String, crate::domain::agent::AgentAction)>>,
    pub memberships: Mutex<HashMap<String, Vec<TeamId>>>,
    pub fail_save: AtomicBool,
    pub fail_import_audit: AtomicBool,
    pub lock_calls: AtomicUsize,
    pub calls: AtomicUsize,
    pub closed_teams: Mutex<HashSet<Uuid>>,
    pub agents: Mutex<HashSet<String>>,
    pub admins: Mutex<HashSet<(String, TeamId)>>,
    pub cleanup_calls: AtomicUsize,
    pub erased_items: Mutex<HashSet<Uuid>>,
    pub audits: Mutex<Vec<Action>>,
    pub folders: Mutex<HashMap<(TeamId, Uuid), Folder>>,
    pub imports: Mutex<Vec<(TeamId, Uuid, ImportFormat, ImportCounts)>>,
    pub busy_items: Mutex<HashSet<Uuid>>,
    pub enrollments: Mutex<HashMap<Uuid, FakeEnrollment>>,
    /// Operations whose intents completed through `save_reconciled`.
    pub reconciled: Mutex<Vec<Uuid>>,
    /// Membership lookups (`teams`), to count admission work.
    pub team_lookups: AtomicUsize,
    /// Answer `ensure_folder` without keeping the folder, as if it were
    /// deleted right after.
    pub forget_ensured_folders: AtomicBool,
}
impl FakeRepository {
    pub fn new() -> Self {
        Self {
            import_capacity: AtomicUsize::new(25),
            live_leases: Arc::new(AtomicUsize::new(0)),
            records: Mutex::new(HashMap::new()),
            favorites: Mutex::new(HashSet::new()),
            staged: Mutex::new(HashMap::new()),
            reservations: Mutex::new(()),
            intent_agents: Mutex::new(HashMap::new()),
            memberships: Mutex::new(HashMap::new()),
            fail_save: AtomicBool::new(false),
            fail_import_audit: AtomicBool::new(false),
            lock_calls: AtomicUsize::new(0),
            calls: AtomicUsize::new(0),
            closed_teams: Mutex::new(HashSet::new()),
            agents: Mutex::new(HashSet::new()),
            admins: Mutex::new(HashSet::new()),
            cleanup_calls: AtomicUsize::new(0),
            erased_items: Mutex::new(HashSet::new()),
            audits: Mutex::new(vec![]),
            folders: Mutex::new(HashMap::new()),
            imports: Mutex::new(vec![]),
            busy_items: Mutex::new(HashSet::new()),
            enrollments: Mutex::new(HashMap::new()),
            reconciled: Mutex::new(vec![]),
            team_lookups: AtomicUsize::new(0),
            forget_ensured_folders: AtomicBool::new(false),
        }
    }
}
struct FakeLock(Arc<AtomicUsize>);
impl Drop for FakeLock {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::SeqCst);
    }
}
#[async_trait]
impl ItemLock for FakeLock {
    async fn release(self: Box<Self>) -> Result<(), Error> {
        Ok(())
    }
}
#[async_trait]
impl Repository for FakeRepository {
    fn import_capacity(&self) -> std::num::NonZeroUsize {
        std::num::NonZeroUsize::new(self.import_capacity.load(Ordering::SeqCst))
            .expect("nonzero fixture capacity")
    }
    async fn is_human(
        &self,
        user: &macro_user_id::user_id::MacroUserIdStr<'_>,
    ) -> Result<bool, Error> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        Ok(!self.agents.lock().unwrap().contains(user.as_ref()))
    }
    async fn is_team_admin(
        &self,
        user: &macro_user_id::user_id::MacroUserIdStr<'_>,
        team: TeamId,
    ) -> Result<bool, Error> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        Ok(self
            .admins
            .lock()
            .unwrap()
            .contains(&(user.to_string(), team)))
    }
    async fn has_team_data(&self, team: TeamId) -> Result<bool, Error> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        Ok(self
            .records
            .lock()
            .unwrap()
            .values()
            .any(|record| record.metadata.team_id == team)
            || self
                .staged
                .lock()
                .unwrap()
                .values()
                .any(|record| record.metadata.team_id == team)
            || self
                .enrollments
                .lock()
                .unwrap()
                .values()
                .any(|entry| entry.team_id == team)
            || self.closed_teams.lock().unwrap().contains(&team.0)
            || self
                .imports
                .lock()
                .unwrap()
                .iter()
                .any(|entry| entry.0 == team)
            || self.folders.lock().unwrap().keys().any(|key| key.0 == team))
    }

    async fn close_team(&self, team: TeamId) -> Result<(), Error> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        self.closed_teams.lock().unwrap().insert(team.0);
        Ok(())
    }
    async fn purge_team_metadata(&self, team: TeamId) -> Result<(), Error> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        self.records
            .lock()
            .unwrap()
            .retain(|_, record| record.metadata.team_id != team);
        self.favorites
            .lock()
            .expect("fixture")
            .retain(|(stored_team, _, _)| *stored_team != team);
        self.imports.lock().unwrap().retain(|entry| entry.0 != team);
        self.folders.lock().unwrap().retain(|key, _| key.0 != team);
        Ok(())
    }
    async fn item_cleanup_due(&self) -> Result<Vec<(TeamId, ItemId)>, Error> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        self.cleanup_calls.fetch_add(1, Ordering::SeqCst);
        Ok(self
            .records
            .lock()
            .unwrap()
            .values()
            .filter(|r| r.deleting && !self.erased_items.lock().unwrap().contains(&r.metadata.id.0))
            .map(|r| (r.metadata.team_id, r.metadata.id))
            .collect())
    }

    async fn stage_totp(&self, team: TeamId, item: ItemId, key: TotpKeyId) -> Result<(), Error> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        self.enrollments.lock().expect("fixture lock").insert(
            key.0,
            FakeEnrollment {
                team_id: team,
                item_id: item,
                active: false,
                grace_elapsed: false,
                cleanup_started: false,
            },
        );
        Ok(())
    }
    async fn activate_totp(
        &self,
        team: TeamId,
        item: ItemId,
        key: TotpKeyId,
        expected_revision: i64,
    ) -> Result<(), Error> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        let mut records = self.records.lock().expect("fixture lock");
        let record = records
            .get_mut(&item.0)
            .filter(|record| record.metadata.team_id == team && !record.deleting)
            .ok_or(Error::NotFound)?;
        if record.revision != expected_revision {
            return Err(Error::Conflict);
        }
        let mut enrollments = self.enrollments.lock().expect("fixture lock");
        if !enrollments.get(&key.0).is_some_and(|entry| {
            entry.team_id == team && entry.item_id == item && !entry.cleanup_started
        }) {
            return Err(Error::Conflict);
        }
        for (id, entry) in enrollments.iter_mut() {
            if entry.team_id == team && entry.item_id == item {
                entry.active = *id == key.0;
            }
        }
        record.totp_key_id = Some(key);
        record.metadata.has_totp = true;
        record.revision += 1;
        Ok(())
    }
    async fn retire_totp(
        &self,
        team: TeamId,
        item: ItemId,
        expected_revision: Option<i64>,
    ) -> Result<(), Error> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        let mut records = self.records.lock().expect("fixture lock");
        let record = records
            .get_mut(&item.0)
            .filter(|record| record.metadata.team_id == team)
            .ok_or(Error::NotFound)?;
        if match expected_revision {
            Some(revision) => record.deleting || record.revision != revision,
            None => !record.deleting,
        } {
            return Err(Error::Conflict);
        }
        for entry in self.enrollments.lock().expect("fixture lock").values_mut() {
            if entry.team_id == team && entry.item_id == item {
                entry.active = false;
            }
        }
        record.totp_key_id = None;
        record.metadata.has_totp = false;
        record.revision += 1;
        Ok(())
    }
    async fn totp_keys(&self, team: TeamId, item: ItemId) -> Result<Vec<TotpKeyId>, Error> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        Ok(self
            .enrollments
            .lock()
            .expect("fixture lock")
            .iter()
            .filter(|(_, entry)| entry.team_id == team && entry.item_id == item)
            .map(|(id, _)| TotpKeyId(*id))
            .collect())
    }
    async fn totp_cleanup_due(&self) -> Result<Vec<TotpCleanup>, Error> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        self.cleanup_calls.fetch_add(1, Ordering::SeqCst);
        Ok(self
            .enrollments
            .lock()
            .expect("fixture lock")
            .iter()
            .filter(|(_, entry)| !entry.active && (!entry.cleanup_started || entry.grace_elapsed))
            .map(|(id, entry)| TotpCleanup {
                team_id: entry.team_id,
                item_id: entry.item_id,
                key_id: TotpKeyId(*id),
            })
            .collect())
    }
    async fn totp_cleanup_ready(&self, cleanup: TotpCleanup) -> Result<bool, Error> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        let mut enrollments = self.enrollments.lock().expect("fixture lock");
        let Some(entry) = enrollments.get_mut(&cleanup.key_id.0) else {
            return Ok(false);
        };
        if entry.team_id != cleanup.team_id || entry.item_id != cleanup.item_id || entry.active {
            return Ok(false);
        }
        if !entry.cleanup_started {
            entry.cleanup_started = true;
            entry.grace_elapsed = false;
            return Ok(false);
        }
        Ok(entry.grace_elapsed)
    }
    async fn finish_totp_cleanup(&self, cleanup: TotpCleanup) -> Result<(), Error> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        if let Some(entry) = self
            .enrollments
            .lock()
            .expect("fixture lock")
            .get_mut(&cleanup.key_id.0)
        {
            entry.grace_elapsed = false;
        }
        Ok(())
    }

    async fn lock(&self, _: TeamId, _item: ItemId) -> Result<Box<dyn ItemLock>, Error> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        self.lock_calls.fetch_add(1, Ordering::SeqCst);
        self.live_leases.fetch_add(1, Ordering::SeqCst);
        Ok(Box::new(FakeLock(self.live_leases.clone())))
    }
    async fn stage(
        &self,
        operation: Uuid,
        record: &Record,
        publisher: &macro_user_id::user_id::MacroUserIdStr<'_>,
    ) -> Result<(), Error> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        if self
            .busy_items
            .lock()
            .unwrap()
            .contains(&record.metadata.id.0)
        {
            return Err(Error::Busy);
        }
        if self
            .closed_teams
            .lock()
            .unwrap()
            .contains(&record.metadata.team_id.0)
            || !self
                .memberships
                .lock()
                .unwrap()
                .get(publisher.as_ref())
                .is_some_and(|teams| teams.contains(&record.metadata.team_id))
        {
            return Err(Error::NotFound);
        }
        let _reserved = self.reservations.lock().expect("fixture lock");
        if self
            .enrollments
            .lock()
            .expect("fixture lock")
            .contains_key(&operation)
        {
            return Err(Error::Conflict);
        }
        let mut staged = self.staged.lock().expect("fixture lock");
        if let Some(previous) = staged.get(&operation) {
            if previous.metadata.id != record.metadata.id
                || previous.metadata.team_id != record.metadata.team_id
                || previous.metadata.version != record.metadata.version
                || previous.user_id != record.user_id
            {
                return Err(Error::Conflict);
            }
        } else {
            staged.insert(operation, record.clone());
        }
        Ok(())
    }
    async fn intent_origin(
        &self,
        team: TeamId,
        item: ItemId,
        operation: Uuid,
    ) -> Result<Option<crate::domain::ports::IntentOrigin>, Error> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        let staged = self.staged.lock().expect("fixture lock");
        let Some(record) = staged.get(&operation) else {
            return Ok(None);
        };
        if record.metadata.team_id != team || record.metadata.id != item {
            return Ok(None);
        }
        Ok(Some(
            match self
                .intent_agents
                .lock()
                .expect("fixture lock")
                .get(&operation)
            {
                None => crate::domain::ports::IntentOrigin::Human,
                Some((agent, action)) => crate::domain::ports::IntentOrigin::Agent {
                    agent: macro_user_id::cowlike::CowLike::into_owned(
                        macro_user_id::user_id::MacroUserIdStr::parse_from_str(agent)
                            .expect("fixture agent"),
                    ),
                    action: *action,
                },
            },
        ))
    }
    async fn staged(&self, team: TeamId, item: ItemId, operation: Uuid) -> Result<Record, Error> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        let record = self
            .staged
            .lock()
            .expect("fixture lock")
            .get(&operation)
            .cloned()
            .ok_or(Error::NotFound)?;
        if record.metadata.team_id != team || record.metadata.id != item {
            return Err(Error::NotFound);
        }
        Ok(record)
    }
    async fn save_reconciled(
        &self,
        record: &Record,
        expected: Option<i32>,
        operation: Uuid,
    ) -> Result<(), Error> {
        self.save(record, expected).await?;
        self.reconciled
            .lock()
            .expect("fixture lock")
            .push(operation);
        Ok(())
    }
    async fn teams(&self, actor: &Actor) -> Result<Vec<TeamId>, Error> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        self.team_lookups.fetch_add(1, Ordering::SeqCst);
        Ok(self
            .memberships
            .lock()
            .expect("fixture lock")
            .get(actor.user_id.as_ref())
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .filter(|team| !self.closed_teams.lock().unwrap().contains(&team.0))
            .collect())
    }
    async fn list(&self, _: &Actor, team: TeamId, _: &str) -> Result<Vec<Record>, Error> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        Ok(self
            .records
            .lock()
            .expect("fixture lock")
            .values()
            .filter(|record| record.metadata.team_id == team && !record.deleting)
            .cloned()
            .collect())
    }
    async fn matching(
        &self,
        _: &Actor,
        team: TeamId,
        names: &[String],
    ) -> Result<Vec<Record>, Error> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        let wanted: HashSet<&str> = names.iter().map(String::as_str).collect();
        Ok(self
            .records
            .lock()
            .expect("fixture lock")
            .values()
            .filter(|record| {
                record.metadata.team_id == team
                    && !record.deleting
                    && wanted.contains(record.metadata.name.to_lowercase().as_str())
            })
            .cloned()
            .collect())
    }
    async fn favorites(
        &self,
        actor: &Actor,
        team: TeamId,
        items: &[ItemId],
    ) -> Result<Vec<ItemId>, Error> {
        let favorites = self.favorites.lock().expect("fixture");
        Ok(items
            .iter()
            .copied()
            .filter(|item| favorites.contains(&(team, *item, actor.user_id.to_string())))
            .collect())
    }
    async fn set_favorite(
        &self,
        actor: &Actor,
        team: TeamId,
        item: ItemId,
        favorite: bool,
    ) -> Result<(), Error> {
        let record = self.get(team, item).await?;
        if record.deleting {
            return Err(Error::NotFound);
        }
        let key = (team, item, actor.user_id.to_string());
        let mut favorites = self.favorites.lock().expect("fixture");
        if favorite {
            favorites.insert(key);
        } else {
            favorites.remove(&key);
        }
        Ok(())
    }
    async fn get(&self, team: TeamId, item: ItemId) -> Result<Record, Error> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        let record = self
            .records
            .lock()
            .expect("fixture lock")
            .get(&item.0)
            .cloned()
            .ok_or(Error::NotFound)?;
        if record.metadata.team_id != team {
            return Err(Error::NotFound);
        }
        Ok(record)
    }
    async fn save(&self, record: &Record, expected: Option<i32>) -> Result<(), Error> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        if self.fail_save.load(Ordering::SeqCst) {
            return Err(Error::Unavailable);
        }
        let mut records = self.records.lock().expect("fixture lock");
        match (records.get(&record.metadata.id.0), expected) {
            (Some(current), Some(expected))
                if current.metadata.version == expected && current.revision == record.revision => {}
            (None, None) => {}
            _ => return Err(Error::Conflict),
        }
        if expected.is_none()
            && record.metadata.favorite
            && self
                .memberships
                .lock()
                .expect("fixture")
                .get(record.user_id.as_ref())
                .is_some_and(|teams| teams.contains(&record.metadata.team_id))
        {
            self.favorites.lock().expect("fixture").insert((
                record.metadata.team_id,
                record.metadata.id,
                record.user_id.to_string(),
            ));
        }
        if record.deleting {
            self.favorites
                .lock()
                .expect("fixture")
                .retain(|(team, item, _)| {
                    *team != record.metadata.team_id || *item != record.metadata.id
                });
        }
        let mut record = record.clone();
        record.revision += 1;
        records.insert(record.metadata.id.0, record);
        Ok(())
    }
    async fn delete(&self, team: TeamId, item: ItemId) -> Result<(), Error> {
        self.favorites
            .lock()
            .expect("fixture")
            .retain(|(stored_team, stored_item, _)| *stored_team != team || *stored_item != item);
        self.calls.fetch_add(1, Ordering::SeqCst);
        self.erased_items.lock().unwrap().insert(item.0);
        if let Some(record) = self.records.lock().expect("fixture lock").get_mut(&item.0) {
            record.deleting = true;
        }
        Ok(())
    }
    async fn audit(
        &self,
        _: TeamId,
        _: ItemId,
        _: &Actor,
        action: Action,
        _: Uuid,
    ) -> Result<(), Error> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        self.audits.lock().expect("fixture lock").push(action);
        Ok(())
    }
    async fn activity(&self, _: TeamId, _: ItemId) -> Result<Vec<Activity>, Error> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        Ok(vec![])
    }
    async fn folders(&self, team: TeamId) -> Result<Vec<Folder>, Error> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        Ok(self
            .folders
            .lock()
            .unwrap()
            .values()
            .filter(|folder| folder.team_id == team)
            .cloned()
            .collect())
    }
    async fn ensure_folder(
        &self,
        team: TeamId,
        id: Uuid,
        name: &str,
        parent_id: Option<Uuid>,
    ) -> Result<Folder, Error> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        let mut folders = self.folders.lock().unwrap();
        if self.forget_ensured_folders.load(Ordering::SeqCst) {
            return Ok(Folder {
                id,
                team_id: team,
                name: name.into(),
                parent_id,
            });
        }
        Ok(folders
            .entry((team, id))
            .or_insert_with(|| Folder {
                id,
                team_id: team,
                name: name.into(),
                parent_id,
            })
            .clone())
    }
    async fn audit_import(
        &self,
        team: TeamId,
        id: Uuid,
        _: &Actor,
        format: ImportFormat,
        counts: ImportCounts,
    ) -> Result<(), Error> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        if self.fail_import_audit.load(Ordering::SeqCst) {
            return Err(Error::Unavailable);
        }

        self.imports
            .lock()
            .unwrap()
            .push((team, id, format, counts));
        Ok(())
    }
    async fn save_folder(&self, _: &Folder) -> Result<(), Error> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }
    async fn rename_folder(&self, team: TeamId, id: Uuid, name: &str) -> Result<Folder, Error> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        Ok(Folder {
            id,
            team_id: team,
            name: name.to_owned(),
            parent_id: None,
        })
    }
    async fn move_folder(
        &self,
        team: TeamId,
        id: Uuid,
        parent: Option<Uuid>,
    ) -> Result<Folder, Error> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        Ok(Folder {
            id,
            team_id: team,
            name: "Folder".to_owned(),
            parent_id: parent,
        })
    }
    async fn delete_folder(&self, _: TeamId, _: Uuid) -> Result<(), Error> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }
}
type UsernameGate = (Arc<tokio::sync::Notify>, Arc<tokio::sync::Notify>);
pub struct WriteGate {
    pub started: tokio::sync::Notify,
    pub release: tokio::sync::Semaphore,
    pub finished: tokio::sync::Notify,
    pub panic: AtomicBool,
}
impl WriteGate {
    pub fn new() -> Self {
        Self {
            started: tokio::sync::Notify::new(),
            release: tokio::sync::Semaphore::new(0),
            finished: tokio::sync::Notify::new(),
            panic: AtomicBool::new(false),
        }
    }
}
struct ActiveWrite<'a>(&'a AtomicUsize);
impl Drop for ActiveWrite<'_> {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::SeqCst);
    }
}
pub struct FakeProvider {
    pub calls: AtomicUsize,
    pub stored: Mutex<HashMap<Uuid, (i32, Uuid, SecretValues)>>,
    pub reads: AtomicUsize,
    pub fail_delete: AtomicBool,
    pub blocked_deletes: Mutex<HashSet<Uuid>>,
    pub blocked_totp_deletes: Mutex<HashSet<Uuid>>,
    pub fail_purge: AtomicBool,
    pub purged: Mutex<Vec<TeamId>>,
    pub tombstones: Mutex<HashSet<Uuid>>,
    pub totp_seeds: Mutex<HashMap<Uuid, SecretString>>,
    pub fail_set: AtomicBool,
    pub revoke_on_username: Mutex<Option<Arc<FakeRepository>>>,
    pub revoke_on_disclosure: Mutex<Option<Arc<FakeRepository>>>,
    pub username_gate: Mutex<Option<UsernameGate>>,
    pub write_gates: Mutex<HashMap<Uuid, Arc<WriteGate>>>,
    pub all_writes_gate: Mutex<Option<Arc<WriteGate>>>,
    pub writes_completed: Mutex<Vec<Uuid>>,
    pub writes_in_flight: AtomicUsize,
    pub max_writes_in_flight: AtomicUsize,
    /// Every value operation fails as an OpenBao team login to a missing namespace would.
    pub unprovisioned: AtomicBool,
}
impl FakeProvider {
    fn login(&self) -> Result<(), Error> {
        if self.unprovisioned.load(Ordering::SeqCst) {
            return Err(Error::NotProvisioned);
        }
        Ok(())
    }
    fn revoke_during_disclosure(&self) {
        if let Some(repository) = self.revoke_on_disclosure.lock().unwrap().take() {
            repository.memberships.lock().unwrap().clear();
        }
    }
    pub fn new() -> Self {
        Self {
            calls: AtomicUsize::new(0),
            stored: Mutex::new(HashMap::new()),
            reads: AtomicUsize::new(0),
            fail_delete: AtomicBool::new(false),
            blocked_deletes: Mutex::new(HashSet::new()),
            blocked_totp_deletes: Mutex::new(HashSet::new()),
            fail_purge: AtomicBool::new(false),
            purged: Mutex::new(vec![]),
            tombstones: Mutex::new(HashSet::new()),
            totp_seeds: Mutex::new(HashMap::new()),
            fail_set: AtomicBool::new(false),
            revoke_on_username: Mutex::new(None),
            revoke_on_disclosure: Mutex::new(None),
            username_gate: Mutex::new(None),
            write_gates: Mutex::new(HashMap::new()),
            all_writes_gate: Mutex::new(None),
            writes_completed: Mutex::new(vec![]),
            writes_in_flight: AtomicUsize::new(0),
            max_writes_in_flight: AtomicUsize::new(0),
            unprovisioned: AtomicBool::new(false),
        }
    }
}
#[async_trait]
impl SecretProvider for FakeProvider {
    async fn purge_namespace(&self, team: TeamId) -> Result<(), Error> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        if self.fail_purge.load(Ordering::SeqCst) {
            return Err(Error::Unavailable);
        }
        self.purged.lock().unwrap().push(team);
        Ok(())
    }
    async fn username(&self, _: TeamId, item: ItemId, version: i32) -> Result<SecretString, Error> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        self.login()?;
        let gate = self.username_gate.lock().expect("fixture lock").clone();
        if let Some((started, release)) = gate {
            started.notify_one();
            release.notified().await;
        }
        let username = {
            let stored = self.stored.lock().expect("fixture lock");
            let stored = stored.get(&item.0).ok_or(Error::NotFound)?;
            if stored.0 != version {
                return Err(Error::NotFound);
            }
            stored.2.username.clone()
        };
        if let Some(repository) = self.revoke_on_username.lock().expect("fixture lock").take() {
            let mut records = repository.records.lock().expect("fixture lock");
            let record = records.get_mut(&item.0).expect("record");
            record.grants.clear();
            record.revision += 1;
        }
        Ok(username)
    }
    async fn current_version(&self, _: TeamId, item: ItemId) -> Result<Option<i32>, Error> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        self.login()?;
        if self
            .tombstones
            .lock()
            .expect("fixture lock")
            .contains(&item.0)
        {
            return Ok(Some(1));
        }
        Ok(self
            .stored
            .lock()
            .expect("fixture lock")
            .get(&item.0)
            .map(|stored| stored.0))
    }
    async fn status(&self, _: TeamId, item: ItemId) -> Result<Option<(i32, Uuid)>, Error> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        self.login()?;
        self.reads.fetch_add(1, Ordering::SeqCst);
        if self
            .tombstones
            .lock()
            .expect("fixture lock")
            .contains(&item.0)
        {
            return Err(Error::Unavailable);
        }
        Ok(self
            .stored
            .lock()
            .expect("fixture lock")
            .get(&item.0)
            .map(|stored| (stored.0, stored.1)))
    }
    async fn write(
        &self,
        _: TeamId,
        item: ItemId,
        expected: i32,
        operation: Uuid,
        values: &SecretValues,
    ) -> Result<i32, Error> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        self.login()?;
        let gate = self
            .write_gates
            .lock()
            .expect("fixture lock")
            .get(&item.0)
            .cloned()
            .or_else(|| self.all_writes_gate.lock().expect("fixture lock").clone());
        let active = self.writes_in_flight.fetch_add(1, Ordering::SeqCst) + 1;
        let _active = ActiveWrite(&self.writes_in_flight);
        self.max_writes_in_flight
            .fetch_max(active, Ordering::SeqCst);
        if let Some(gate) = gate.as_ref() {
            gate.started.notify_one();
            gate.release.acquire().await.expect("write gate").forget();
            assert!(
                !gate.panic.load(Ordering::SeqCst),
                "synthetic provider panic"
            );
        }
        let mut stored = self.stored.lock().expect("fixture lock");
        let actual = stored.get(&item.0).map(|stored| stored.0).unwrap_or(0);
        if actual != expected {
            return Err(Error::Conflict);
        }
        stored.insert(item.0, (expected + 1, operation, values.clone()));
        self.writes_completed
            .lock()
            .expect("fixture lock")
            .push(item.0);
        if let Some(gate) = gate {
            gate.finished.notify_one();
        }
        Ok(expected + 1)
    }
    async fn read(&self, _: TeamId, item: ItemId, version: i32) -> Result<SecretValues, Error> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        self.login()?;
        self.revoke_during_disclosure();
        self.reads.fetch_add(1, Ordering::SeqCst);
        let stored = self.stored.lock().expect("fixture lock");
        let stored = stored.get(&item.0).ok_or(Error::NotFound)?;
        if stored.0 != version {
            return Err(Error::NotFound);
        }
        Ok(stored.2.clone())
    }
    async fn delete(&self, _: TeamId, item: ItemId) -> Result<(), Error> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        self.login()?;
        if self.fail_delete.load(Ordering::SeqCst) {
            return Err(Error::Unavailable);
        }
        let blocked = self.blocked_deletes.lock().unwrap().contains(&item.0);
        if blocked {
            return std::future::pending().await;
        }
        self.stored.lock().expect("fixture lock").remove(&item.0);
        self.tombstones.lock().expect("fixture lock").insert(item.0);
        Ok(())
    }
    async fn history(&self, _: TeamId, _: ItemId) -> Result<Vec<Version>, Error> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        self.login()?;
        self.revoke_during_disclosure();
        Ok(vec![])
    }

    async fn set_totp(&self, _: TeamId, key: TotpKeyId, seed: &SecretString) -> Result<(), Error> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        self.login()?;
        self.totp_seeds
            .lock()
            .expect("fixture lock")
            .insert(key.0, seed.clone());
        if self.fail_set.load(Ordering::SeqCst) {
            return Err(Error::Unavailable);
        }
        Ok(())
    }
    async fn delete_totp(&self, _: TeamId, key: TotpKeyId) -> Result<(), Error> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        self.login()?;
        if self.fail_delete.load(Ordering::SeqCst) {
            return Err(Error::Unavailable);
        }
        let blocked = self.blocked_totp_deletes.lock().unwrap().contains(&key.0);
        if blocked {
            return std::future::pending().await;
        }
        self.totp_seeds.lock().expect("fixture lock").remove(&key.0);
        Ok(())
    }
    async fn totp(&self, _: TeamId, key: TotpKeyId) -> Result<TotpCode, Error> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        self.login()?;
        self.revoke_during_disclosure();
        if !self
            .totp_seeds
            .lock()
            .expect("fixture lock")
            .contains_key(&key.0)
        {
            return Err(Error::NotFound);
        }
        Ok(TotpCode {
            code: SecretString("123456".into()),
            period: 30,
        })
    }
}
pub struct FakeAvailability;
#[async_trait]
impl Availability for FakeAvailability {
    async fn require_enabled(&self, _: &Actor) -> Result<(), Error> {
        self.require_provider()
    }
    fn require_provider(&self) -> Result<(), Error> {
        Ok(())
    }
}
