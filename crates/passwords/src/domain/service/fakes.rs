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
    pub records: Mutex<HashMap<Uuid, Record>>,
    pub staged: Mutex<HashMap<Uuid, Record>>,
    pub memberships: Mutex<HashMap<String, Vec<TeamId>>>,
    pub fail_save: AtomicBool,
    pub lock_calls: AtomicUsize,
    pub calls: AtomicUsize,
    pub closed_teams: Mutex<HashSet<Uuid>>,
    pub agents: Mutex<HashSet<String>>,
    pub admins: Mutex<HashSet<(String, TeamId)>>,
    pub cleanup_calls: AtomicUsize,
    pub erased_items: Mutex<HashSet<Uuid>>,
    pub audits: Mutex<Vec<Action>>,
    pub enrollments: Mutex<HashMap<Uuid, FakeEnrollment>>,
    /// Operations whose intents completed through `save_reconciled`.
    pub reconciled: Mutex<Vec<Uuid>>,
}
impl FakeRepository {
    pub fn new() -> Self {
        Self {
            records: Mutex::new(HashMap::new()),
            staged: Mutex::new(HashMap::new()),
            memberships: Mutex::new(HashMap::new()),
            fail_save: AtomicBool::new(false),
            lock_calls: AtomicUsize::new(0),
            calls: AtomicUsize::new(0),
            closed_teams: Mutex::new(HashSet::new()),
            agents: Mutex::new(HashSet::new()),
            admins: Mutex::new(HashSet::new()),
            cleanup_calls: AtomicUsize::new(0),
            erased_items: Mutex::new(HashSet::new()),
            audits: Mutex::new(vec![]),
            enrollments: Mutex::new(HashMap::new()),
            reconciled: Mutex::new(vec![]),
        }
    }
}
struct FakeLock;
impl ItemLock for FakeLock {}
#[async_trait]
impl Repository for FakeRepository {
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
            || self.closed_teams.lock().unwrap().contains(&team.0))
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

    async fn lock(&self, _: TeamId, _: ItemId) -> Result<Box<dyn ItemLock>, Error> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        self.lock_calls.fetch_add(1, Ordering::SeqCst);
        Ok(Box::new(FakeLock))
    }
    async fn stage(
        &self,
        operation: Uuid,
        record: &Record,
        publisher: &macro_user_id::user_id::MacroUserIdStr<'_>,
    ) -> Result<(), Error> {
        self.calls.fetch_add(1, Ordering::SeqCst);
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
        let mut record = record.clone();
        record.revision += 1;
        records.insert(record.metadata.id.0, record);
        Ok(())
    }
    async fn delete(&self, _: TeamId, item: ItemId) -> Result<(), Error> {
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
    async fn folders(&self, _: TeamId) -> Result<Vec<Folder>, Error> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        Ok(vec![])
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
}
impl FakeProvider {
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
        let mut stored = self.stored.lock().expect("fixture lock");
        let actual = stored.get(&item.0).map(|stored| stored.0).unwrap_or(0);
        if actual != expected {
            return Err(Error::Conflict);
        }
        stored.insert(item.0, (expected + 1, operation, values.clone()));
        Ok(expected + 1)
    }
    async fn read(&self, _: TeamId, item: ItemId, version: i32) -> Result<SecretValues, Error> {
        self.calls.fetch_add(1, Ordering::SeqCst);
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
        self.revoke_during_disclosure();
        Ok(vec![])
    }

    async fn set_totp(&self, _: TeamId, key: TotpKeyId, seed: &SecretString) -> Result<(), Error> {
        self.calls.fetch_add(1, Ordering::SeqCst);
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
        self.require_service_enabled().await
    }
    async fn require_service_enabled(&self) -> Result<(), Error> {
        Ok(())
    }
}
