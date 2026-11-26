use super::{Actor, Error, ItemId, ItemKind, PasswordService, Record, SecretString, TeamId};

impl PasswordService {
    /// Read the current protected advisory after human Card view authorization.
    #[tracing::instrument(skip_all,err,name="passwords.use_when",fields(team_id=%team.0,item_id=%item.0))]
    pub async fn use_when(
        &self,
        actor: &Actor,
        team: TeamId,
        item: ItemId,
    ) -> Result<Option<SecretString>, Error> {
        let record = self.access(actor, team, item, false).await?;
        if !matches!(record.metadata.kind, ItemKind::Card) {
            return Err(Error::NotFound);
        }
        let text = self
            .provider
            .use_when(team, item, record.metadata.version)
            .await?;
        self.require_same_record(actor, &record, false).await?;
        Ok(text)
    }

    // A provider read can outlive the lease or overlap a revoke, delete or retype.
    pub(super) async fn require_same_record(
        &self,
        actor: &Actor,
        record: &Record,
        edit: bool,
    ) -> Result<(), Error> {
        let current = self
            .access(actor, record.metadata.team_id, record.metadata.id, edit)
            .await?;
        if current.revision != record.revision
            || current.metadata.version != record.metadata.version
        {
            return Err(Error::Conflict);
        }
        Ok(())
    }
}
