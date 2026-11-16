//! Private preferences, independent of credential leases and revisions.
use super::*;

impl PgRepository {
    pub(super) async fn list_favorites(
        &self,
        actor: &Actor,
        team: TeamId,
        items: &[ItemId],
    ) -> Result<Vec<ItemId>, Error> {
        if items.len() > password_import::vault::MAX_LIST_ITEMS {
            return Err(Error::Invalid);
        }
        if items.is_empty() {
            return Ok(Vec::new());
        }
        let ids: Vec<Uuid> = items.iter().map(|item| item.0).collect();
        let mut transaction = self.bounded_transaction().await?;
        let rows = sqlx::query_scalar!(
            "SELECT item_id FROM password_item_favorites WHERE team_id=$1 AND user_id=$2 AND item_id=ANY($3)",
            team.0,
            actor.user_id.as_ref(),
            &ids
        ).fetch_all(&mut *transaction).await.map_err(database_error)?;
        transaction.commit().await.map_err(database_error)?;
        Ok(rows.into_iter().map(ItemId).collect())
    }

    pub(super) async fn store_favorite(
        &self,
        actor: &Actor,
        team: TeamId,
        item: ItemId,
        favorite: bool,
    ) -> Result<(), Error> {
        // All resource failures are unavailable, never credential version conflicts.
        let mut transaction = self.bounded_transaction().await.map_err(preference_error)?;
        // Serialize with soft deletion so a late star cannot restore its preference.
        let active = sqlx::query!(
            "SELECT deleting,deleted_at FROM password_item_entities WHERE team_id=$1 AND id=$2 FOR SHARE",
            team.0, item.0
        ).fetch_optional(&mut *transaction).await.map_err(|_| Error::Unavailable)?;
        let member = sqlx::query_scalar!(
            "SELECT user_id FROM team_user WHERE team_id=$1 AND user_id=$2 FOR KEY SHARE",
            team.0,
            actor.user_id.as_ref()
        )
        .fetch_optional(&mut *transaction)
        .await
        .map_err(|_| Error::Unavailable)?;
        if active.is_none_or(|row| row.deleting || row.deleted_at.is_some()) || member.is_none() {
            return Err(Error::NotFound);
        }
        if favorite {
            sqlx::query!(
                "INSERT INTO password_item_favorites(team_id,item_id,user_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
                team.0, item.0, actor.user_id.as_ref()
            ).execute(&mut *transaction).await.map_err(|_| Error::Unavailable)?;
        } else {
            sqlx::query!(
                "DELETE FROM password_item_favorites WHERE team_id=$1 AND item_id=$2 AND user_id=$3",
                team.0, item.0, actor.user_id.as_ref()
            ).execute(&mut *transaction).await.map_err(|_| Error::Unavailable)?;
        }
        transaction.commit().await.map_err(|_| Error::Unavailable)
    }
}

fn preference_error(error: Error) -> Error {
    match error {
        Error::Busy | Error::Conflict => Error::Unavailable,
        other => other,
    }
}

#[cfg(test)]
mod test;
