//! Authorization, retry recovery and product policy independent of either persistence adapter.
use super::{models::*, ports::*};
use chrono::Utc;
use std::sync::Arc;
use uuid::Uuid;

/// Provider-independent vault use cases with current membership and item grant enforcement.
pub struct PasswordService {
    /// Metadata, grants, durable write intents and distributed vault locks.
    pub repository: Arc<dyn Repository>,
    /// Replaceable confidential value and TOTP storage.
    pub provider: Arc<dyn SecretProvider>,
    /// Verifies a recent interactive sign-in for confidential disclosure.
    pub reauthentication: Arc<dyn Reauthentication>,
    /// Per-user remote rollout and explicit provider availability.
    pub availability: Arc<dyn Availability>,
}
impl PasswordService {
    fn metadata(mut record: Record) -> ItemMetadata {
        record.metadata.share_count = record
            .grants
            .iter()
            .map(|grant| (matches!(grant.kind, GranteeKind::Team), grant.id.as_str()))
            .collect::<std::collections::HashSet<_>>()
            .len();
        record.metadata.shared = record.metadata.share_count > 0;
        record.metadata
    }
    /// List currently enabled vault memberships.
    pub async fn teams(&self, actor: &Actor) -> Result<Vec<TeamId>, Error> {
        self.availability.require_enabled(actor).await?;
        self.repository.teams(actor).await
    }
    async fn membership(&self, actor: &Actor, team: TeamId) -> Result<(), Error> {
        self.availability.require_enabled(actor).await?;
        if !self.repository.teams(actor).await?.contains(&team) {
            return Err(Error::NotFound);
        }
        Ok(())
    }
    fn permission(actor: &Actor, team: TeamId, record: &Record, edit: bool) -> bool {
        record.user_id == actor.user_id
            || record.grants.iter().any(|grant| {
                let matches = match grant.kind {
                    GranteeKind::User => grant.id == actor.user_id.as_ref(),
                    GranteeKind::Team => grant.id == team.0.to_string(),
                };
                matches && (!edit || grant.permission == Permission::Edit)
            })
    }
    /// A lost provider response can be reconciled from its operation UUID and durable metadata intent.
    /// Every caller holds the same distributed item lock throughout this and the protected action.
    async fn reconcile(&self, team: TeamId, item: ItemId) -> Result<(), Error> {
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
        record.metadata.shared = !record.grants.is_empty();
        self.repository.save(&record, expected).await?;
        self.repository.finish(operation).await
    }
    async fn access(
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
            || !Self::permission(actor, team, &record, edit)
        {
            return Err(Error::NotFound);
        }
        Ok(record)
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
    ) -> Result<Vec<ItemMetadata>, Error> {
        self.membership(actor, team).await?;
        if search.len() > 200 {
            return Err(Error::Invalid);
        }
        Ok(self
            .repository
            .list(actor, team, search)
            .await?
            .into_iter()
            .filter(|record| Self::permission(actor, team, record, false))
            .map(Self::metadata)
            .collect())
    }
    /// Read an authorized metadata detail without consulting the secret provider.
    pub async fn get(
        &self,
        actor: &Actor,
        team: TeamId,
        item: ItemId,
    ) -> Result<ItemMetadata, Error> {
        Ok(Self::metadata(self.access(actor, team, item, false).await?))
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
        let _lock = self.repository.lock(team, item).await?;
        let record = self.access(actor, team, item, false).await?;
        let username = self
            .provider
            .username(team, item, record.metadata.version)
            .await?;
        let current = self.access(actor, team, item, false).await?;
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
    ) -> Result<ItemMetadata, Error> {
        self.membership(actor, team).await?;
        command.validate()?;
        if command.expected_version.is_some() || command.operation_id.get_version_num() != 7 {
            return Err(Error::Invalid);
        }
        self.validate_folder(team, command.folder_id).await?;
        let id = ItemId(command.operation_id);
        let _lock = self.repository.lock(team, id).await?;
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
                return Ok(Self::metadata(record));
            }
            Ok(_) => return Err(Error::Conflict),
            Err(Error::NotFound) => {}
            Err(error) => return Err(error),
        }
        let now = Utc::now();
        let record = Record {
            user_id: actor.user_id.clone(),
            grants: vec![],
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
        self.repository.stage(command.operation_id, &record).await?;
        self.provider
            .write(team, id, 0, command.operation_id, &command.values)
            .await?;
        self.reconcile(team, id).await?;
        self.repository
            .audit(team, id, actor, Action::Create, command.operation_id)
            .await?;
        Ok(Self::metadata(record))
    }
    #[tracing::instrument(skip_all,err,name="passwords.update",fields(team_id=%team.0,item_id=%item.0))]
    /// Update an editable credential with provider CAS and retry recovery.
    pub async fn update(
        &self,
        actor: &Actor,
        team: TeamId,
        item: ItemId,
        command: WriteItem,
    ) -> Result<ItemMetadata, Error> {
        let _lock = self.repository.lock(team, item).await?;
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
                return Ok(Self::metadata(record));
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
        self.repository.stage(command.operation_id, &record).await?;
        self.provider
            .write(team, item, expected, command.operation_id, &command.values)
            .await?;
        self.reconcile(team, item).await?;
        self.repository
            .audit(team, item, actor, Action::Update, command.operation_id)
            .await?;
        Ok(Self::metadata(record))
    }
    #[tracing::instrument(skip_all,err,name="passwords.metadata.update",fields(team_id=%team.0,item_id=%item.0))]
    /// Update display fields without resolving or replacing secret values.
    pub async fn patch(
        &self,
        actor: &Actor,
        team: TeamId,
        item: ItemId,
        command: PatchItem,
    ) -> Result<ItemMetadata, Error> {
        let _lock = self.repository.lock(team, item).await?;
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
        Ok(Self::metadata(record))
    }
    /// Deleted items retain internal tombstones for owner retries and durable provider cleanup.
    #[tracing::instrument(skip_all,err,name="passwords.delete",fields(team_id=%team.0,item_id=%item.0))]
    pub async fn delete(&self, actor: &Actor, team: TeamId, item: ItemId) -> Result<(), Error> {
        self.membership(actor, team).await?;
        let _lock = self.repository.lock(team, item).await?;
        let mut record = match self.repository.get(team, item).await {
            Ok(record) => record,
            Err(Error::NotFound) => match self.repository.staged(team, item, item.0).await {
                Ok(record) => {
                    if record.user_id != actor.user_id {
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
        if record.user_id != actor.user_id {
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
        self.repository.retire_totp(team, item, None).await?;
        for key_id in self.repository.totp_keys(team, item).await? {
            self.provider.delete_totp(team, key_id).await?;
        }
        self.provider.delete(team, item).await?;
        self.repository.delete(team, item).await
    }
    /// Copy an authorized version with a distinct action span and the disclosure reauthentication policy.
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
    /// Reveal or copy an authorized version after recent interactive authentication.
    pub async fn reveal(
        &self,
        actor: &Actor,
        team: TeamId,
        item: ItemId,
        version: Option<i32>,
        copy: bool,
    ) -> Result<Revealed, Error> {
        let _lock = self.repository.lock(team, item).await?;
        self.access(actor, team, item, false).await?;
        self.reauthentication.verify(actor).await?;
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
        Ok(Revealed {
            values: self.provider.read(team, item, version).await?,
            version,
        })
    }
    /// List provider version metadata for an authorized item.
    pub async fn history(
        &self,
        actor: &Actor,
        team: TeamId,
        item: ItemId,
    ) -> Result<Vec<Version>, Error> {
        self.access(actor, team, item, false).await?;
        self.provider.history(team, item).await
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
    /// Replace explicit grants; only the current item owner may share.
    pub async fn share(
        &self,
        actor: &Actor,
        team: TeamId,
        item: ItemId,
        grants: Vec<Grant>,
    ) -> Result<(), Error> {
        let _lock = self.repository.lock(team, item).await?;
        let mut record = self.access(actor, team, item, true).await?;
        if record.user_id != actor.user_id {
            return Err(Error::Forbidden);
        }
        if grants.len() > 100 {
            return Err(Error::Invalid);
        }
        for grant in &grants {
            match grant.kind {
                GranteeKind::Team if grant.id != team.0.to_string() => return Err(Error::Invalid),
                GranteeKind::User => {
                    let recipient = Actor {
                        user_id: macro_user_id::user_id::MacroUserIdStr::parse_from_str(&grant.id)
                            .map(macro_user_id::cowlike::CowLike::into_owned)
                            .map_err(|_| Error::Invalid)?,
                        session_token: None,
                    };
                    if !self.repository.teams(&recipient).await?.contains(&team) {
                        return Err(Error::NotFound);
                    }
                }
                GranteeKind::Team => {}
            }
        }
        record.metadata.shared = !grants.is_empty();
        record.grants = grants;
        self.repository
            .save(&record, Some(record.metadata.version))
            .await?;
        self.repository
            .audit(team, item, actor, Action::Share, Uuid::now_v7())
            .await
    }
    /// List grants for the current owner to manage sharing.
    pub async fn grants(
        &self,
        actor: &Actor,
        team: TeamId,
        item: ItemId,
    ) -> Result<Vec<Grant>, Error> {
        let record = self.access(actor, team, item, false).await?;
        if record.user_id != actor.user_id {
            return Err(Error::Forbidden);
        }
        Ok(record.grants)
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
        self.membership(actor, team).await?;
        let _lock = self.repository.lock(team, ItemId(Uuid::nil())).await?;
        if name.trim().is_empty() || name.len() > 200 {
            return Err(Error::Invalid);
        }
        if !self
            .repository
            .folders(team)
            .await?
            .iter()
            .any(|folder| folder.id == id)
        {
            return Err(Error::NotFound);
        }
        let folder = Folder {
            id,
            team_id: team,
            name,
        };
        self.repository.save_folder(&folder).await?;
        Ok(folder)
    }
    /// Create an inline folder in the current team vault.
    pub async fn create_folder(
        &self,
        actor: &Actor,
        team: TeamId,
        name: String,
    ) -> Result<Folder, Error> {
        self.membership(actor, team).await?;
        if name.trim().is_empty() || name.len() > 200 {
            return Err(Error::Invalid);
        }
        let _lock = self.repository.lock(team, ItemId(Uuid::nil())).await?;
        let folder = Folder {
            id: Uuid::now_v7(),
            team_id: team,
            name,
        };
        self.repository.save_folder(&folder).await?;
        Ok(folder)
    }
    /// Delete a folder and move its children to the unfiled view.
    pub async fn delete_folder(&self, actor: &Actor, team: TeamId, id: Uuid) -> Result<(), Error> {
        self.membership(actor, team).await?;
        let _lock = self.repository.lock(team, ItemId(Uuid::nil())).await?;
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
        let _lock = self.repository.lock(team, item).await?;
        let record = self.access(actor, team, item, true).await?;
        self.reauthentication.verify(actor).await?;
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
    /// Resolve only the active enrollment generation after current authorization and recent sign-in.
    #[tracing::instrument(skip_all,err,name="passwords.totp.code",fields(team_id=%team.0,item_id=%item.0))]
    pub async fn totp(&self, actor: &Actor, team: TeamId, item: ItemId) -> Result<TotpCode, Error> {
        let _lock = self.repository.lock(team, item).await?;
        let record = self.access(actor, team, item, false).await?;
        self.reauthentication.verify(actor).await?;
        let key_id = record.totp_key_id.ok_or(Error::NotFound)?;
        self.repository
            .audit(team, item, actor, Action::TotpCode, Uuid::now_v7())
            .await?;
        self.provider.totp(team, key_id).await
    }
    /// Erase retired or uncommitted generations after the provider's bounded in-flight request window.
    /// Retired identities remain journaled for periodic erasure; cancellation and failures remain retryable.
    #[tracing::instrument(skip_all, err, name = "passwords.totp.cleanup")]
    pub async fn cleanup_expired_totp_enrollments(&self) -> Result<usize, Error> {
        let mut completed = 0;
        for cleanup in self.repository.totp_cleanup_due().await? {
            let _lock = match self.repository.lock(cleanup.team_id, cleanup.item_id).await {
                Ok(lock) => lock,
                Err(Error::Conflict) => continue,
                Err(error) => {
                    tracing::warn!(error=%error,"passwords cleanup lease unavailable");
                    continue;
                }
            };
            match self.repository.totp_cleanup_ready(cleanup).await {
                Ok(true) => {}
                Ok(false) => continue,
                Err(error) => {
                    tracing::warn!(error=%error,"passwords cleanup state unavailable");
                    continue;
                }
            }
            if let Err(error) = self
                .provider
                .delete_totp(cleanup.team_id, cleanup.key_id)
                .await
            {
                tracing::warn!(error=%error,"passwords retired enrollment cleanup failed");
                continue;
            }
            if let Err(error) = self.repository.finish_totp_cleanup(cleanup).await {
                tracing::warn!(error=%error,"passwords cleanup completion failed");
                continue;
            }
            completed += 1;
        }
        Ok(completed)
    }
}
#[cfg(test)]
pub(crate) mod test;
