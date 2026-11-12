//! Authorization, retry recovery and product policy independent of either persistence adapter.
use super::{models::*, ports::*};
use chrono::Utc;
use std::sync::Arc;
use uuid::Uuid;

const CLEANUP_ATTEMPT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);

/// Provider-independent vault use cases with current membership and item grant enforcement.
pub struct PasswordService {
    /// Metadata, grants, durable write intents and distributed vault locks.
    pub repository: Arc<dyn Repository>,
    /// Replaceable confidential value and TOTP storage.
    pub provider: Arc<dyn SecretProvider>,
    /// Service authority, actor targeting and explicit provider availability.
    pub availability: Arc<dyn Availability>,
}
impl PasswordService {
    fn view(mut record: Record, actor: &Actor, admin: bool) -> ItemView {
        record.metadata.share_count = record
            .grants
            .iter()
            .filter(|grant| !matches!(grant.kind, GranteeKind::Agent))
            .map(|grant| (matches!(grant.kind, GranteeKind::Team), grant.id.as_str()))
            .collect::<std::collections::HashSet<_>>()
            .len();
        record.metadata.shared = record.metadata.share_count > 0;
        ItemView {
            can_manage: record.user_id == actor.user_id || admin,
            can_edit: admin || Self::permission(actor, record.metadata.team_id, &record, true),
            shared_with_team: record.grants.iter().any(|grant| {
                matches!(grant.kind, GranteeKind::Team)
                    && grant.id == record.metadata.team_id.0.to_string()
            }),
            metadata: record.metadata,
        }
    }
    async fn metadata(&self, actor: &Actor, record: Record) -> Result<ItemView, Error> {
        let admin = self
            .repository
            .is_team_admin(&actor.user_id, record.metadata.team_id)
            .await?;
        Ok(Self::view(record, actor, admin))
    }
    /// List currently enabled vault memberships.
    pub async fn teams(&self, actor: &Actor) -> Result<Vec<TeamId>, Error> {
        self.availability.require_enabled(actor).await?;
        if !self.repository.is_human(&actor.user_id).await? {
            return Err(Error::Forbidden);
        }
        self.repository.teams(actor).await
    }
    pub(crate) async fn membership(&self, actor: &Actor, team: TeamId) -> Result<(), Error> {
        self.availability.require_enabled(actor).await?;
        if !self.repository.is_human(&actor.user_id).await? {
            return Err(Error::Forbidden);
        }
        if !self.repository.teams(actor).await?.contains(&team) {
            return Err(Error::NotFound);
        }
        Ok(())
    }
    /// Reject disabled or nonmember callers before consuming lease admission capacity.
    async fn admit(
        &self,
        actor: &Actor,
        team: TeamId,
        item: ItemId,
    ) -> Result<Box<dyn ItemLock>, Error> {
        self.membership(actor, team).await?;
        let lock = self.repository.lock(team, item).await?;
        // A lifecycle mutation can revoke membership or close the vault between
        // pre-admission and lease acquisition, including for item creation.
        self.membership(actor, team).await?;
        Ok(lock)
    }
    fn permission(actor: &Actor, team: TeamId, record: &Record, edit: bool) -> bool {
        record.user_id == actor.user_id
            || record.grants.iter().any(|grant| {
                let matches = match grant.kind {
                    GranteeKind::User => grant.id == actor.user_id.as_ref(),
                    GranteeKind::Team => grant.id == team.0.to_string(),
                    GranteeKind::Agent => false,
                };
                matches && (!edit || grant.permission == Permission::Edit)
            })
    }
    /// A lost provider response can be reconciled from its operation UUID and durable metadata intent.
    /// Every caller holds the same distributed item lock throughout this and the protected action.
    pub(crate) async fn reconcile(&self, team: TeamId, item: ItemId) -> Result<(), Error> {
        let current = self.repository.get(team, item).await;
        let current_record = current.as_ref().ok().cloned();
        if matches!(&current,Ok(record) if record.deleting) {
            return Ok(());
        }
        let Some(provider_version) = self.provider.current_version(team, item).await? else {
            return Ok(());
        };
        if matches!(&current,Ok(record) if record.metadata.version>=provider_version) {
            return Ok(());
        }
        let Some((version, operation)) = self.provider.status(team, item).await? else {
            return Err(Error::Unavailable);
        };
        let expected = match current {
            Ok(record) if record.metadata.version >= version => return Ok(()),
            Ok(record) => Some(record.metadata.version),
            Err(Error::NotFound) => None,
            Err(error) => return Err(error),
        };
        let mut record = self.repository.staged(team, item, operation).await?;
        if record.metadata.version != version {
            return Err(Error::Unavailable);
        }
        if let Some(current) = current_record {
            if record.revision != current.revision {
                record.metadata = current.metadata;
                record.metadata.version = version;
            }
            record.user_id = current.user_id;
            record.grants = current.grants;
            record.totp_key_id = current.totp_key_id;
            record.revision = current.revision;
            record.metadata.has_totp = record.totp_key_id.is_some();
        }
        if record.metadata.folder_id.is_some() {
            match self.validate_folder(team, record.metadata.folder_id).await {
                Ok(()) => {}
                Err(Error::Invalid) => record.metadata.folder_id = None,
                Err(error) => return Err(error),
            }
        }
        record.metadata.shared = Self::human_shared(&record.grants);
        // Metadata, the intent's retained agent audit and its completion commit
        // together, so no reconciler can save metadata and lose the audit.
        match self
            .repository
            .save_reconciled(&record, expected, operation)
            .await
        {
            // The folder was deleted after validation; land the write unfiled.
            Err(Error::FolderMissing) => {
                record.metadata.folder_id = None;
                self.repository
                    .save_reconciled(&record, expected, operation)
                    .await
            }
            result => result,
        }
    }
    pub(crate) async fn access(
        &self,
        actor: &Actor,
        team: TeamId,
        item: ItemId,
        edit: bool,
    ) -> Result<Record, Error> {
        self.membership(actor, team).await?;
        let record = self.repository.get(team, item).await?;
        if record.deleting
            || record.metadata.team_id != team
            || !(Self::permission(actor, team, &record, edit)
                || self.repository.is_team_admin(&actor.user_id, team).await?)
        {
            return Err(Error::NotFound);
        }
        Ok(record)
    }
    /// Revalidate shared disclosure policy after external I/O, even if its lease was lost.
    #[tracing::instrument(skip_all,err,name="passwords.disclosure.recheck",fields(team_id=%team.0,item_id=%item.0,post_io_access_denied=tracing::field::Empty,outcome=tracing::field::Empty))]
    async fn recheck_disclosure(
        &self,
        actor: &Actor,
        team: TeamId,
        item: ItemId,
        expected_key: Option<TotpKeyId>,
    ) -> Result<Record, Error> {
        let current = match self.access(actor, team, item, false).await {
            Ok(record) => record,
            Err(error) => {
                tracing::Span::current().record("post_io_access_denied", true);
                tracing::Span::current().record("outcome", "denied");
                return Err(error);
            }
        };
        if expected_key.is_some() && current.totp_key_id != expected_key {
            tracing::Span::current().record("post_io_access_denied", true);
            tracing::Span::current().record("outcome", "generation_changed");
            return Err(Error::Busy);
        }
        tracing::Span::current().record("post_io_access_denied", false);
        tracing::Span::current().record("outcome", "allowed");
        Ok(current)
    }

    async fn validate_folder(&self, team: TeamId, id: Option<Uuid>) -> Result<(), Error> {
        if let Some(id) = id
            && !self
                .repository
                .folders(team)
                .await?
                .iter()
                .any(|folder| folder.id == id)
        {
            return Err(Error::Invalid);
        }
        Ok(())
    }
    #[tracing::instrument(skip_all, err, name = "passwords.list")]
    /// Search visible metadata without reading any credential values.
    pub async fn list(
        &self,
        actor: &Actor,
        team: TeamId,
        search: &str,
    ) -> Result<Vec<ItemView>, Error> {
        self.membership(actor, team).await?;
        if search.len() > 200 {
            return Err(Error::Invalid);
        }
        let admin = self.repository.is_team_admin(&actor.user_id, team).await?;
        Ok(self
            .repository
            .list(actor, team, search)
            .await?
            .into_iter()
            .filter(|record| admin || Self::permission(actor, team, record, false))
            .map(|record| Self::view(record, actor, admin))
            .collect())
    }
    /// Read an authorized metadata detail without consulting the secret provider.
    pub async fn get(&self, actor: &Actor, team: TeamId, item: ItemId) -> Result<ItemView, Error> {
        self.metadata(actor, self.access(actor, team, item, false).await?)
            .await
    }
    /// Resolve the current account identifier after normal human view authorization.
    #[tracing::instrument(skip_all,err,name="passwords.username",fields(team_id=%team.0,item_id=%item.0,copy))]
    pub async fn username(
        &self,
        actor: &Actor,
        team: TeamId,
        item: ItemId,
        copy: bool,
    ) -> Result<Username, Error> {
        let _lock = if copy {
            Some(self.admit(actor, team, item).await?)
        } else {
            None
        };
        let record = self.access(actor, team, item, false).await?;
        let username = self
            .provider
            .username(team, item, record.metadata.version)
            .await?;
        let current = self.recheck_disclosure(actor, team, item, None).await?;
        if current.revision != record.revision
            || current.metadata.version != record.metadata.version
        {
            return Err(Error::Conflict);
        }
        if copy {
            self.repository
                .audit(team, item, actor, Action::Copy, Uuid::now_v7())
                .await?;
        }
        Ok(Username {
            username,
            version: record.metadata.version,
        })
    }
    #[tracing::instrument(skip_all,err,name="passwords.create",fields(team_id=%team.0))]
    /// Create a credential using a stable operation ID and durable metadata intent.
    pub async fn create(
        &self,
        actor: &Actor,
        team: TeamId,
        command: WriteItem,
    ) -> Result<ItemView, Error> {
        let id = ItemId(command.operation_id);
        let _lock = self.admit(actor, team, id).await?;
        command.validate()?;
        if command.expected_version.is_some() || command.operation_id.get_version_num() != 7 {
            return Err(Error::Invalid);
        }
        self.validate_folder(team, command.folder_id).await?;
        if let Ok(existing) = self.repository.get(team, id).await
            && existing.user_id != actor.user_id
        {
            return Err(Error::Forbidden);
        }
        if let Ok(staged) = self.repository.staged(team, id, command.operation_id).await
            && staged.user_id != actor.user_id
        {
            return Err(Error::Forbidden);
        }
        self.reconcile(team, id).await?;
        match self.repository.get(team, id).await {
            Ok(record) if record.user_id == actor.user_id && !record.deleting => {
                self.repository
                    .audit(team, id, actor, Action::Create, command.operation_id)
                    .await?;
                return self.metadata(actor, record).await;
            }
            Ok(_) => return Err(Error::Conflict),
            Err(Error::NotFound) => {}
            Err(error) => return Err(error),
        }
        let now = Utc::now();
        let record = Record {
            user_id: actor.user_id.clone(),
            grants: if command.private {
                vec![]
            } else {
                vec![Grant {
                    kind: GranteeKind::Team,
                    id: team.0.to_string(),
                    permission: Permission::Edit,
                }]
            },
            deleting: false,
            revision: 0,
            totp_key_id: None,
            metadata: ItemMetadata {
                id,
                team_id: team,
                name: command.name,
                kind: command.kind,
                url: command.url,
                folder_id: command.folder_id,
                favorite: command.favorite,
                version: 1,
                has_totp: false,
                shared: false,
                share_count: 0,
                created_at: now,
                updated_at: now,
                last_used_at: None,
            },
        };
        self.repository
            .stage(command.operation_id, &record, &actor.user_id)
            .await?;
        self.provider
            .write(team, id, 0, command.operation_id, &command.values)
            .await?;
        self.reconcile(team, id).await?;
        self.repository
            .audit(team, id, actor, Action::Create, command.operation_id)
            .await?;
        self.metadata(actor, record).await
    }
    #[tracing::instrument(skip_all,err,name="passwords.update",fields(team_id=%team.0,item_id=%item.0))]
    /// Update an editable credential with provider CAS and retry recovery.
    pub async fn update(
        &self,
        actor: &Actor,
        team: TeamId,
        item: ItemId,
        command: WriteItem,
    ) -> Result<ItemView, Error> {
        let _lock = self.admit(actor, team, item).await?;
        self.access(actor, team, item, true).await?;
        self.reconcile(team, item).await?;
        let mut record = self.access(actor, team, item, true).await?;
        command.validate()?;
        if command.expected_version != Some(record.metadata.version) {
            if let Some((version, operation)) = self.provider.status(team, item).await?
                && operation == command.operation_id
                && version == record.metadata.version
            {
                self.repository
                    .audit(team, item, actor, Action::Update, command.operation_id)
                    .await?;
                return self.metadata(actor, record).await;
            }
            return Err(Error::Conflict);
        }
        self.validate_folder(team, command.folder_id).await?;
        let expected = record.metadata.version;
        record.metadata.version = expected.checked_add(1).ok_or(Error::Invalid)?;
        record.metadata.name = command.name;
        record.metadata.kind = command.kind;
        record.metadata.url = command.url;
        record.metadata.folder_id = command.folder_id;
        record.metadata.favorite = command.favorite;
        record.metadata.updated_at = Utc::now();
        self.repository
            .stage(command.operation_id, &record, &actor.user_id)
            .await?;
        self.provider
            .write(team, item, expected, command.operation_id, &command.values)
            .await?;
        self.reconcile(team, item).await?;
        self.repository
            .audit(team, item, actor, Action::Update, command.operation_id)
            .await?;
        self.metadata(actor, record).await
    }
    #[tracing::instrument(skip_all,err,name="passwords.metadata.update",fields(team_id=%team.0,item_id=%item.0))]
    /// Update display fields without resolving or replacing secret values.
    pub async fn patch(
        &self,
        actor: &Actor,
        team: TeamId,
        item: ItemId,
        command: PatchItem,
    ) -> Result<ItemView, Error> {
        let _lock = self.admit(actor, team, item).await?;
        let mut record = self.access(actor, team, item, true).await?;
        if command.expected_version != record.metadata.version {
            return Err(Error::Conflict);
        }
        if command.name.trim().is_empty() || command.name.len() > 200 {
            return Err(Error::Invalid);
        }
        self.validate_folder(team, command.folder_id).await?;
        record.metadata.name = command.name;
        record.metadata.kind = command.kind;
        record.metadata.url = command.url;
        record.metadata.folder_id = command.folder_id;
        record.metadata.favorite = command.favorite;
        record.metadata.updated_at = Utc::now();
        let version = record.metadata.version;
        self.repository.save(&record, Some(version)).await?;
        self.repository
            .audit(team, item, actor, Action::Update, Uuid::now_v7())
            .await?;
        self.metadata(actor, record).await
    }
    /// Deleted items retain internal tombstones for owner retries and durable provider cleanup.
    #[tracing::instrument(skip_all,err,name="passwords.delete",fields(team_id=%team.0,item_id=%item.0))]
    pub async fn delete(&self, actor: &Actor, team: TeamId, item: ItemId) -> Result<(), Error> {
        let _lock = self.admit(actor, team, item).await?;
        let mut record = match self.repository.get(team, item).await {
            Ok(record) => record,
            Err(Error::NotFound) => match self.repository.staged(team, item, item.0).await {
                Ok(record) => {
                    if record.user_id != actor.user_id
                        && !self.repository.is_team_admin(&actor.user_id, team).await?
                    {
                        return Err(Error::Forbidden);
                    }
                    self.repository.save(&record, None).await?;
                    self.repository.get(team, item).await?
                }
                Err(Error::NotFound) => return Ok(()),
                Err(error) => return Err(error),
            },
            Err(error) => return Err(error),
        };
        if record.user_id != actor.user_id
            && !self.repository.is_team_admin(&actor.user_id, team).await?
        {
            return Err(Error::Forbidden);
        }
        if !record.deleting {
            record.deleting = true;
            self.repository
                .save(&record, Some(record.metadata.version))
                .await?;
            self.repository
                .audit(team, item, actor, Action::Delete, Uuid::now_v7())
                .await?;
        }
        self.erase_retired_record(team, item).await.map(|_| ())
    }
    /// Copy an authorized version with a distinct audited action.
    #[tracing::instrument(skip_all,err,name="passwords.copy",fields(team_id=%team.0,item_id=%item.0))]
    pub async fn copy(
        &self,
        actor: &Actor,
        team: TeamId,
        item: ItemId,
        version: Option<i32>,
    ) -> Result<Revealed, Error> {
        self.reveal(actor, team, item, version, true).await
    }
    #[tracing::instrument(skip_all,err,name="passwords.reveal",fields(team_id=%team.0,item_id=%item.0,copy))]
    /// Reveal or copy an authorized version after current human and item authorization.
    pub async fn reveal(
        &self,
        actor: &Actor,
        team: TeamId,
        item: ItemId,
        version: Option<i32>,
        copy: bool,
    ) -> Result<Revealed, Error> {
        let _lock = self.admit(actor, team, item).await?;
        self.access(actor, team, item, false).await?;
        self.reconcile(team, item).await?;
        let mut record = self.access(actor, team, item, false).await?;
        let version = version.unwrap_or(record.metadata.version);
        if version < 1 || version > record.metadata.version {
            return Err(Error::Invalid);
        }
        self.repository
            .audit(
                team,
                item,
                actor,
                if copy { Action::Copy } else { Action::Reveal },
                Uuid::now_v7(),
            )
            .await?;
        record.metadata.last_used_at = Some(Utc::now());
        self.repository
            .save(&record, Some(record.metadata.version))
            .await?;
        let values = self.provider.read(team, item, version).await?;
        self.recheck_disclosure(actor, team, item, None).await?;
        Ok(Revealed { values, version })
    }
    /// List provider version metadata for an authorized item.
    pub async fn history(
        &self,
        actor: &Actor,
        team: TeamId,
        item: ItemId,
    ) -> Result<Vec<Version>, Error> {
        self.access(actor, team, item, false).await?;
        let versions = self.provider.history(team, item).await?;
        self.recheck_disclosure(actor, team, item, None).await?;
        Ok(versions)
    }
    /// List bounded audit entries for an authorized item.
    pub async fn activity(
        &self,
        actor: &Actor,
        team: TeamId,
        item: ItemId,
    ) -> Result<Vec<Activity>, Error> {
        self.access(actor, team, item, false).await?;
        self.repository.activity(team, item).await
    }
    #[tracing::instrument(skip_all,err,name="passwords.share",fields(team_id=%team.0,item_id=%item.0))]
    /// Replace explicit grants; the creator and current team administrators may share.
    pub async fn share(
        &self,
        actor: &Actor,
        team: TeamId,
        item: ItemId,
        mut grants: Vec<Grant>,
    ) -> Result<(), Error> {
        let _lock = self.admit(actor, team, item).await?;
        let mut record = self.access(actor, team, item, true).await?;
        if record.user_id != actor.user_id
            && !self.repository.is_team_admin(&actor.user_id, team).await?
        {
            return Err(Error::Forbidden);
        }
        if grants.len() > 100 {
            return Err(Error::Invalid);
        }
        for grant in &mut grants {
            match grant.kind {
                GranteeKind::Team if grant.id != team.0.to_string() => return Err(Error::Invalid),
                GranteeKind::User => {
                    let recipient = Actor {
                        user_id: macro_user_id::user_id::MacroUserIdStr::parse_from_str(&grant.id)
                            .map(macro_user_id::cowlike::CowLike::into_owned)
                            .map_err(|_| Error::Invalid)?,
                    };
                    if !self.repository.is_human(&recipient.user_id).await?
                        || !self.repository.teams(&recipient).await?.contains(&team)
                    {
                        return Err(Error::NotFound);
                    }
                    grant.id = recipient.user_id.to_string();
                }
                GranteeKind::Team => {}
                GranteeKind::Agent => return Err(Error::Invalid),
            }
        }
        // Agent grants change only through the agent access routes, which keep
        // their approvals and revisions consistent; human sharing preserves them.
        grants.extend(
            record
                .grants
                .iter()
                .filter(|grant| matches!(grant.kind, GranteeKind::Agent))
                .cloned(),
        );
        record.metadata.shared = Self::human_shared(&grants);
        record.grants = grants;
        self.repository
            .save(&record, Some(record.metadata.version))
            .await?;
        self.repository
            .audit(team, item, actor, Action::Share, Uuid::now_v7())
            .await
    }
    /// List grants for the creator and current team administrators to manage sharing.
    pub async fn grants(
        &self,
        actor: &Actor,
        team: TeamId,
        item: ItemId,
    ) -> Result<Vec<Grant>, Error> {
        let record = self.access(actor, team, item, false).await?;
        if record.user_id != actor.user_id
            && !self.repository.is_team_admin(&actor.user_id, team).await?
        {
            return Err(Error::Forbidden);
        }
        Ok(record
            .grants
            .into_iter()
            .filter(|grant| !matches!(grant.kind, GranteeKind::Agent))
            .collect())
    }
    /// Whether any human-visible grant exists; Agent grants are not sharing.
    pub(crate) fn human_shared(grants: &[Grant]) -> bool {
        grants
            .iter()
            .any(|grant| !matches!(grant.kind, GranteeKind::Agent))
    }
    /// List the current team vault folders.
    pub async fn folders(&self, actor: &Actor, team: TeamId) -> Result<Vec<Folder>, Error> {
        self.membership(actor, team).await?;
        self.repository.folders(team).await
    }
    /// Rename an existing folder within the current membership boundary.
    pub async fn rename_folder(
        &self,
        actor: &Actor,
        team: TeamId,
        id: Uuid,
        name: String,
    ) -> Result<Folder, Error> {
        let _lock = self.admit(actor, team, ItemId(Uuid::nil())).await?;
        let name = Self::folder_name(name)?;
        // The repository's own row check decides NotFound; a pre-read could be
        // stale once the lease is lost.
        self.repository.rename_folder(team, id, &name).await
    }
    /// Create an inline folder in the current team vault, optionally inside another.
    pub async fn create_folder(
        &self,
        actor: &Actor,
        team: TeamId,
        name: String,
        parent_id: Option<Uuid>,
    ) -> Result<Folder, Error> {
        let _lock = self.admit(actor, team, ItemId(Uuid::nil())).await?;
        let folder = Folder {
            id: Uuid::now_v7(),
            team_id: team,
            name: Self::folder_name(name)?,
            parent_id,
        };
        self.repository.save_folder(&folder).await?;
        Ok(folder)
    }
    /// Move a folder under another folder of the team, or to the top level.
    pub async fn move_folder(
        &self,
        actor: &Actor,
        team: TeamId,
        id: Uuid,
        parent_id: Option<Uuid>,
    ) -> Result<Folder, Error> {
        let _lock = self.admit(actor, team, ItemId(Uuid::nil())).await?;
        if parent_id == Some(id) {
            return Err(Error::Invalid);
        }
        self.repository.move_folder(team, id, parent_id).await
    }
    fn folder_name(name: String) -> Result<String, Error> {
        if name.trim().is_empty() || name.len() > 200 {
            return Err(Error::Invalid);
        }
        Ok(name)
    }
    /// Delete a folder and its subfolders, moving their items to the unfiled view.
    pub async fn delete_folder(&self, actor: &Actor, team: TeamId, id: Uuid) -> Result<(), Error> {
        let _lock = self.admit(actor, team, ItemId(Uuid::nil())).await?;
        self.repository.delete_folder(team, id).await
    }

    /// Stage a unique enrollment before setup, then atomically select it without overwriting old keys.
    #[tracing::instrument(skip_all,err,name="passwords.totp.configure",fields(team_id=%team.0,item_id=%item.0))]
    pub async fn configure_totp(
        &self,
        actor: &Actor,
        team: TeamId,
        item: ItemId,
        key: Option<SecretString>,
    ) -> Result<(), Error> {
        let _lock = self.admit(actor, team, item).await?;
        let record = self.access(actor, team, item, true).await?;
        let action = if let Some(key) = key {
            if key.0.len() > 1024 || !lazy_regex::regex_is_match!(r"^[A-Z2-7]+=*$", &key.0) {
                return Err(Error::Invalid);
            }
            let key_id = TotpKeyId(Uuid::now_v7());
            self.repository.stage_totp(team, item, key_id).await?;
            self.provider.set_totp(team, key_id, &key).await?;
            self.repository
                .activate_totp(team, item, key_id, record.revision)
                .await?;
            Action::TotpSetup
        } else {
            self.repository
                .retire_totp(team, item, Some(record.revision))
                .await?;
            if let Some(key_id) = record.totp_key_id {
                self.provider.delete_totp(team, key_id).await?;
            }
            Action::TotpRemove
        };
        self.repository
            .audit(team, item, actor, action, Uuid::now_v7())
            .await
    }
    /// Resolve only the active enrollment generation after current authorization and current human membership.
    #[tracing::instrument(skip_all,err,name="passwords.totp.code",fields(team_id=%team.0,item_id=%item.0))]
    pub async fn totp(&self, actor: &Actor, team: TeamId, item: ItemId) -> Result<TotpCode, Error> {
        let _lock = self.admit(actor, team, item).await?;
        let record = self.access(actor, team, item, false).await?;
        let key_id = record.totp_key_id.ok_or(Error::NotFound)?;
        self.repository
            .audit(team, item, actor, Action::TotpCode, Uuid::now_v7())
            .await?;
        let code = self.provider.totp(team, key_id).await?;
        self.recheck_disclosure(actor, team, item, Some(key_id))
            .await?;
        Ok(code)
    }
    /// Erase retired or uncommitted generations after the provider's bounded in-flight request window.
    /// Retired identities remain journaled for periodic erasure; cancellation and failures remain retryable.
    #[tracing::instrument(skip_all, err, name = "passwords.totp.cleanup",fields(completed=tracing::field::Empty,failed=tracing::field::Empty))]
    pub async fn cleanup_expired_totp_enrollments(&self) -> Result<usize, Error> {
        self.availability.require_service_enabled().await?;
        let mut completed = 0;
        let mut failed = 0;
        for cleanup in self.repository.totp_cleanup_due().await? {
            let result = match tokio::time::timeout(
                CLEANUP_ATTEMPT_TIMEOUT,
                self.erase_retired_totp(cleanup),
            )
            .await
            {
                Ok(result) => result,
                Err(_) => Err(Error::Unavailable),
            };
            match result {
                Ok(true) => completed += 1,
                Ok(false) => {}
                Err(error) => {
                    failed += 1;
                    tracing::warn!(team_id=%cleanup.team_id.0,key_id=%cleanup.key_id.0,error=%error,"passwords retired enrollment cleanup failed; retained for retry");
                }
            }
        }
        tracing::Span::current().record("completed", completed);
        tracing::Span::current().record("failed", failed);
        Ok(completed)
    }
}
#[cfg(test)]
pub(crate) mod test;

#[cfg(test)]
mod review_test;

mod lifecycle;
