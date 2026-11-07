//! Counts-only batch activity, independent of any successful item creation.
use super::*;

impl PgRepository {
    pub(super) async fn record_import(
        &self,
        team: TeamId,
        import_id: Uuid,
        actor: &Actor,
        format: ImportFormat,
        counts: ImportCounts,
    ) -> Result<(), Error> {
        let id = Uuid::now_v7();
        let format = serde_json::to_value(format).map_err(|_| Error::Invalid)?;
        let format = format.as_str().ok_or(Error::Invalid)?;
        let mut transaction = self.bounded_transaction().await?;
        sqlx::query!(
            "INSERT INTO password_import_activity(team_id,id,import_id,user_id,format,created,already_present,failed,folders) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
            team.0, id, import_id, actor.user_id.as_ref(), format,
            i16::from(counts.created), i16::from(counts.already_present),
            i16::from(counts.failed), i32::from(counts.folders),
        ).execute(&mut *transaction).await.map_err(database_error)?;
        transaction.commit().await.map_err(database_error)
    }
}

#[cfg(test)]
mod test;
