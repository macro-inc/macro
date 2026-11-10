use super::super::*;
use async_trait::async_trait;
use std::{
    collections::{HashMap, HashSet},
    sync::{
        Mutex,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    },
};

pub struct FakeRepository {
    pub records: Mutex<HashMap<Uuid, Record>>,
    pub staged: Mutex<HashMap<Uuid, Record>>,
    pub memberships: Mutex<HashMap<String, Vec<TeamId>>>,
    pub fail_save: AtomicBool,
    pub lock_calls: AtomicUsize,
    pub closed_teams: Mutex<HashSet<Uuid>>,
    pub closed_users: Mutex<HashSet<String>>,
    pub erased_items: Mutex<HashSet<Uuid>>,
    pub team_owners: Mutex<HashMap<Uuid, macro_user_id::user_id::MacroUserIdStr<'static>>>,
    pub audits: Mutex<Vec<Action>>,
    pub enrollments: Mutex<HashMap<Uuid, (TeamId, ItemId, bool, bool, bool)>>,
}
impl FakeRepository {
    pub fn new() -> Self {
        Self {
            records: Mutex::new(HashMap::new()),
            staged: Mutex::new(HashMap::new()),
            memberships: Mutex::new(HashMap::new()),
            fail_save: AtomicBool::new(false),
            lock_calls: AtomicUsize::new(0),
            closed_teams: Mutex::new(HashSet::new()),
            closed_users: Mutex::new(HashSet::new()),
            erased_items: Mutex::new(HashSet::new()),
            team_owners: Mutex::new(HashMap::new()),
            audits: Mutex::new(vec![]),
            enrollments: Mutex::new(HashMap::new()),
        }
    }
}
struct FakeLock;
impl ItemLock for FakeLock {}
#[async_trait]
impl Repository for FakeRepository {
    async fn retired_user_items(
        &self,
        team: TeamId,
        user: &macro_user_id::user_id::MacroUserIdStr<'_>,
    ) -> Result<Vec<ItemId>, Error> {
        Ok(self
            .records
            .lock()
            .unwrap()
            .values()
            .filter(|r| {
                r.metadata.team_id == team
                    && r.user_id == *user
                    && r.deleting
                    && !self.erased_items.lock().unwrap().contains(&r.metadata.id.0)
            })
            .map(|r| r.metadata.id)
            .collect())
    }
    async fn close_user(
        &self,
        user: &macro_user_id::user_id::MacroUserIdStr<'_>,
    ) -> Result<(), Error> {
        self.closed_users.lock().unwrap().insert(user.to_string());
        Ok(())
    }
    async fn user_vault_teams(
        &self,
        user: &macro_user_id::user_id::MacroUserIdStr<'_>,
    ) -> Result<Vec<TeamId>, Error> {
        Ok(self
            .records
            .lock()
            .unwrap()
            .values()
            .filter(|r| r.user_id == *user)
            .map(|r| r.metadata.team_id)
            .collect())
    }
    async fn team_owner(
        &self,
        team: TeamId,
    ) -> Result<macro_user_id::user_id::MacroUserIdStr<'static>, Error> {
        self.team_owners
            .lock()
            .unwrap()
            .get(&team.0)
            .cloned()
            .ok_or(Error::NotFound)
    }
    async fn depart_user(
        &self,
        team: TeamId,
        user: &macro_user_id::user_id::MacroUserIdStr<'_>,
        owner: &macro_user_id::user_id::MacroUserIdStr<'_>,
    ) -> Result<(), Error> {
        for record in self
            .records
            .lock()
            .unwrap()
            .values_mut()
            .filter(|r| r.metadata.team_id == team)
        {
            crate::domain::lifecycle::depart_member(
                record,
                user,
                owner,
                crate::domain::lifecycle::Departure::Administrative,
            )?;
        }
        Ok(())
    }
    async fn scrub_user_metadata(
        &self,
        _: TeamId,
        _: &macro_user_id::user_id::MacroUserIdStr<'_>,
    ) -> Result<(), Error> {
        Ok(())
    }

    async fn close_team(&self, team: TeamId) -> Result<(), Error> {
        self.closed_teams.lock().unwrap().insert(team.0);
        Ok(())
    }
    async fn purge_team_metadata(&self, team: TeamId) -> Result<(), Error> {
        self.records
            .lock()
            .unwrap()
            .retain(|_, record| record.metadata.team_id != team);
        Ok(())
    }
    async fn item_cleanup_due(&self) -> Result<Vec<(TeamId, ItemId)>, Error> {
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
        self.enrollments
            .lock()
            .expect("fixture lock")
            .insert(key.0, (team, item, false, false, false));
        Ok(())
    }
    async fn activate_totp(
        &self,
        team: TeamId,
        item: ItemId,
        key: TotpKeyId,
        expected_revision: i64,
    ) -> Result<(), Error> {
        let mut records = self.records.lock().expect("fixture lock");
        let record = records
            .get_mut(&item.0)
            .filter(|record| record.metadata.team_id == team && !record.deleting)
            .ok_or(Error::NotFound)?;
        if record.revision != expected_revision {
            return Err(Error::Conflict);
        }
        let mut enrollments = self.enrollments.lock().expect("fixture lock");
        if !enrollments
            .get(&key.0)
            .is_some_and(|entry| entry.0 == team && entry.1 == item && !entry.4)
        {
            return Err(Error::Conflict);
        }
        for (id, entry) in enrollments.iter_mut() {
            if entry.0 == team && entry.1 == item {
                entry.2 = *id == key.0;
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
            if entry.0 == team && entry.1 == item {
                entry.2 = false;
            }
        }
        record.totp_key_id = None;
        record.metadata.has_totp = false;
        record.revision += 1;
        Ok(())
    }
    async fn totp_keys(&self, team: TeamId, item: ItemId) -> Result<Vec<TotpKeyId>, Error> {
        Ok(self
            .enrollments
            .lock()
            .expect("fixture lock")
            .iter()
            .filter(|(_, entry)| entry.0 == team && entry.1 == item)
            .map(|(id, _)| TotpKeyId(*id))
            .collect())
    }
    async fn totp_cleanup_due(&self) -> Result<Vec<TotpCleanup>, Error> {
        Ok(self
            .enrollments
            .lock()
            .expect("fixture lock")
            .iter()
            .filter(|(_, entry)| !entry.2 && (!entry.4 || entry.3))
            .map(|(id, entry)| TotpCleanup {
                team_id: entry.0,
                item_id: entry.1,
                key_id: TotpKeyId(*id),
            })
            .collect())
    }
    async fn totp_cleanup_ready(&self, cleanup: TotpCleanup) -> Result<bool, Error> {
        let mut enrollments = self.enrollments.lock().expect("fixture lock");
        let Some(entry) = enrollments.get_mut(&cleanup.key_id.0) else {
            return Ok(false);
        };
        if entry.0 != cleanup.team_id || entry.1 != cleanup.item_id || entry.2 {
            return Ok(false);
        }
        if !entry.4 {
            entry.4 = true;
            entry.3 = false;
            return Ok(false);
        }
        Ok(entry.3)
    }
    async fn finish_totp_cleanup(&self, cleanup: TotpCleanup) -> Result<(), Error> {
        if let Some(entry) = self
            .enrollments
            .lock()
            .expect("fixture lock")
            .get_mut(&cleanup.key_id.0)
        {
            entry.3 = false;
        }
        Ok(())
    }

    async fn lock(&self, _: TeamId, _: ItemId) -> Result<Box<dyn ItemLock>, Error> {
        self.lock_calls.fetch_add(1, Ordering::SeqCst);
        Ok(Box::new(FakeLock))
    }
    async fn stage(&self, operation: Uuid, record: &Record) -> Result<(), Error> {
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
    async fn finish(&self, _: Uuid) -> Result<(), Error> {
        Ok(())
    }
    async fn teams(&self, actor: &Actor) -> Result<Vec<TeamId>, Error> {
        if self
            .closed_users
            .lock()
            .unwrap()
            .contains(actor.user_id.as_ref())
        {
            return Ok(vec![]);
        }
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
        self.audits.lock().expect("fixture lock").push(action);
        Ok(())
    }
    async fn activity(&self, _: TeamId, _: ItemId) -> Result<Vec<Activity>, Error> {
        Ok(vec![])
    }
    async fn folders(&self, _: TeamId) -> Result<Vec<Folder>, Error> {
        Ok(vec![])
    }
    async fn save_folder(&self, _: &Folder) -> Result<(), Error> {
        Ok(())
    }
    async fn delete_folder(&self, _: TeamId, _: Uuid) -> Result<(), Error> {
        Ok(())
    }
}
type UsernameGate = (Arc<tokio::sync::Notify>, Arc<tokio::sync::Notify>);
pub struct FakeProvider {
    pub stored: Mutex<HashMap<Uuid, (i32, Uuid, SecretValues)>>,
    pub reads: AtomicUsize,
    pub fail_delete: AtomicBool,
    pub fail_purge: AtomicBool,
    pub purged: Mutex<Vec<TeamId>>,
    pub tombstones: Mutex<HashSet<Uuid>>,
    pub totp_seeds: Mutex<HashMap<Uuid, SecretString>>,
    pub fail_set: AtomicBool,
    pub revoke_on_username: Mutex<Option<Arc<FakeRepository>>>,
    pub username_gate: Mutex<Option<UsernameGate>>,
}
impl FakeProvider {
    pub fn new() -> Self {
        Self {
            stored: Mutex::new(HashMap::new()),
            reads: AtomicUsize::new(0),
            fail_delete: AtomicBool::new(false),
            fail_purge: AtomicBool::new(false),
            purged: Mutex::new(vec![]),
            tombstones: Mutex::new(HashSet::new()),
            totp_seeds: Mutex::new(HashMap::new()),
            fail_set: AtomicBool::new(false),
            revoke_on_username: Mutex::new(None),
            username_gate: Mutex::new(None),
        }
    }
}
#[async_trait]
impl SecretProvider for FakeProvider {
    async fn purge_namespace(&self, team: TeamId) -> Result<(), Error> {
        if self.fail_purge.load(Ordering::SeqCst) {
            return Err(Error::Unavailable);
        }
        self.purged.lock().unwrap().push(team);
        Ok(())
    }
    async fn username(&self, _: TeamId, item: ItemId, version: i32) -> Result<SecretString, Error> {
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
        let mut stored = self.stored.lock().expect("fixture lock");
        let actual = stored.get(&item.0).map(|stored| stored.0).unwrap_or(0);
        if actual != expected {
            return Err(Error::Conflict);
        }
        stored.insert(item.0, (expected + 1, operation, values.clone()));
        Ok(expected + 1)
    }
    async fn read(&self, _: TeamId, item: ItemId, version: i32) -> Result<SecretValues, Error> {
        self.reads.fetch_add(1, Ordering::SeqCst);
        let stored = self.stored.lock().expect("fixture lock");
        let stored = stored.get(&item.0).ok_or(Error::NotFound)?;
        if stored.0 != version {
            return Err(Error::NotFound);
        }
        Ok(stored.2.clone())
    }
    async fn delete(&self, _: TeamId, item: ItemId) -> Result<(), Error> {
        if self.fail_delete.load(Ordering::SeqCst) {
            return Err(Error::Unavailable);
        }
        self.stored.lock().expect("fixture lock").remove(&item.0);
        self.tombstones.lock().expect("fixture lock").insert(item.0);
        Ok(())
    }
    async fn history(&self, _: TeamId, _: ItemId) -> Result<Vec<Version>, Error> {
        Ok(vec![])
    }

    async fn set_totp(&self, _: TeamId, key: TotpKeyId, seed: &SecretString) -> Result<(), Error> {
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
        if self.fail_delete.load(Ordering::SeqCst) {
            return Err(Error::Unavailable);
        }
        self.totp_seeds.lock().expect("fixture lock").remove(&key.0);
        Ok(())
    }
    async fn totp(&self, _: TeamId, key: TotpKeyId) -> Result<TotpCode, Error> {
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
pub struct FakeReauthentication {
    pub recent: AtomicBool,
}
#[async_trait]
impl Reauthentication for FakeReauthentication {
    async fn verify(&self, _: &Actor) -> Result<(), Error> {
        if self.recent.load(Ordering::SeqCst) {
            Ok(())
        } else {
            Err(Error::ReauthenticationRequired)
        }
    }
}
pub struct FakeAvailability;
#[async_trait]
impl Availability for FakeAvailability {
    async fn require_enabled(&self, _: &Actor) -> Result<(), Error> {
        Ok(())
    }
}
