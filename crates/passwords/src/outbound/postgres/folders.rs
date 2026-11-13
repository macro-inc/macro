//! Folder invariants checked with the tree lock in the same metadata transaction.
use super::*;

const MAX_FOLDERS: usize = password_import::vault::MAX_TEAM_FOLDERS;
/// The recursive queries below spell this depth (8) and one past the folder cap
/// (501) as literals; keep them in step with the vault limits.
const MAX_DEPTH: i32 = 8;
const _: () = assert!(MAX_DEPTH as usize == password_import::vault::MAX_FOLDER_DEPTH);

/// `New` is a plain insert, so a reused id fails; only `Ensure` tolerates an
/// existing row (it already looked under the tree lock).
#[derive(Clone, Copy)]
enum Insert {
    New,
    Ensure,
}

impl PgRepository {
    async fn folder_transaction(
        &self,
        team: TeamId,
    ) -> Result<Transaction<'static, Postgres>, Error> {
        let mut transaction = self.bounded_transaction().await?;
        let key = format!("passwords/folders/{}", team.0);
        sqlx::query!("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", key)
            .execute(&mut *transaction)
            .await
            .map_err(database_error)?;
        Ok(transaction)
    }

    pub(super) async fn list_folders(&self, team: TeamId) -> Result<Vec<Folder>, Error> {
        let mut transaction = self.bounded_transaction().await?;
        let rows = sqlx::query!("SELECT id,name,parent_id FROM password_folders WHERE team_id=$1 ORDER BY name,id LIMIT 500", team.0)
            .fetch_all(&mut *transaction).await.map_err(database_error)?;
        transaction.commit().await.map_err(database_error)?;
        Ok(rows
            .into_iter()
            .map(|row| Folder {
                id: row.id,
                team_id: team,
                name: row.name,
                parent_id: row.parent_id,
            })
            .collect())
    }

    /// Count ancestor nodes, with a top-level parent at depth one.
    async fn parent_depth(
        transaction: &mut Transaction<'static, Postgres>,
        team: TeamId,
        parent: Option<Uuid>,
    ) -> Result<i32, Error> {
        let Some(parent) = parent else {
            return Ok(0);
        };
        let rows = sqlx::query!(r#"WITH RECURSIVE ancestors AS (
            SELECT id,parent_id,1 AS depth FROM password_folders WHERE team_id=$1 AND id=$2
            UNION ALL
            SELECT folder.id,folder.parent_id,ancestors.depth+1 FROM password_folders folder
            JOIN ancestors ON folder.id=ancestors.parent_id WHERE folder.team_id=$1 AND ancestors.depth<8
        ) SELECT parent_id,depth AS "depth!" FROM ancestors"#,team.0,parent)
            .fetch_all(&mut **transaction).await.map_err(database_error)?;
        let last = rows
            .iter()
            .max_by_key(|row| row.depth)
            .ok_or(Error::Invalid)?;
        if last.parent_id.is_some() || last.depth >= MAX_DEPTH {
            return Err(Error::Invalid);
        }
        Ok(last.depth)
    }

    #[tracing::instrument(skip_all,err,name="passwords.folder.create",fields(team_id=%folder.team_id.0,folder_id=%folder.id))]
    pub(super) async fn create_folder(&self, folder: &Folder) -> Result<(), Error> {
        let mut transaction = self.folder_transaction(folder.team_id).await?;
        Self::insert_folder(&mut transaction, folder, Insert::New).await?;
        transaction.commit().await.map_err(database_error)
    }

    pub(super) async fn ensure_stored_folder(
        &self,
        team: TeamId,
        id: Uuid,
        name: &str,
        parent_id: Option<Uuid>,
    ) -> Result<Folder, Error> {
        let mut transaction = self.folder_transaction(team).await?;
        let existing = sqlx::query!(
            "SELECT id,name,parent_id FROM password_folders WHERE team_id=$1 AND id=$2",
            team.0,
            id
        )
        .fetch_optional(&mut *transaction)
        .await
        .map_err(database_error)?;
        let folder = match existing {
            Some(row) => Folder {
                id: row.id,
                team_id: team,
                name: row.name,
                parent_id: row.parent_id,
            },
            None => {
                let folder = Folder {
                    id,
                    team_id: team,
                    name: name.to_owned(),
                    parent_id,
                };
                Self::insert_folder(&mut transaction, &folder, Insert::Ensure).await?;
                folder
            }
        };
        transaction.commit().await.map_err(database_error)?;
        Ok(folder)
    }

    async fn insert_folder(
        transaction: &mut Transaction<'static, Postgres>,
        folder: &Folder,
        insert: Insert,
    ) -> Result<(), Error> {
        let existing = sqlx::query!(
            "SELECT id FROM password_folders WHERE team_id=$1 LIMIT 501",
            folder.team_id.0
        )
        .fetch_all(&mut **transaction)
        .await
        .map_err(database_error)?;
        if existing.len() >= MAX_FOLDERS {
            return Err(Error::Invalid);
        }
        Self::parent_depth(transaction, folder.team_id, folder.parent_id).await?;
        match insert {
            Insert::New => sqlx::query!(
                "INSERT INTO password_folders(team_id,id,name,parent_id) VALUES($1,$2,$3,$4)",
                folder.team_id.0,
                folder.id,
                folder.name,
                folder.parent_id
            )
            .execute(&mut **transaction)
            .await
            .map_err(folder_error)?,
            Insert::Ensure => sqlx::query!(
                "INSERT INTO password_folders(team_id,id,name,parent_id) VALUES($1,$2,$3,$4) ON CONFLICT(team_id,id) DO NOTHING",
                folder.team_id.0,
                folder.id,
                folder.name,
                folder.parent_id
            )
            .execute(&mut **transaction)
            .await
            .map_err(folder_error)?,
        };
        Ok(())
    }

    #[tracing::instrument(skip_all,err,name="passwords.folder.rename",fields(team_id=%team.0,folder_id=%id))]
    pub(super) async fn rename_stored_folder(
        &self,
        team: TeamId,
        id: Uuid,
        name: &str,
    ) -> Result<Folder, Error> {
        let mut transaction = self.folder_transaction(team).await?;
        let row = sqlx::query!("UPDATE password_folders SET name=$3 WHERE team_id=$1 AND id=$2 RETURNING id,name,parent_id",team.0,id,name)
            .fetch_optional(&mut *transaction).await.map_err(database_error)?.ok_or(Error::NotFound)?;
        transaction.commit().await.map_err(database_error)?;
        Ok(Folder {
            id: row.id,
            team_id: team,
            name: row.name,
            parent_id: row.parent_id,
        })
    }

    /// Return descendant ids and the subtree height in edges (a leaf has height zero).
    async fn folder_subtree(
        transaction: &mut Transaction<'static, Postgres>,
        team: TeamId,
        id: Uuid,
    ) -> Result<(Vec<Uuid>, i32), Error> {
        let rows = sqlx::query!(
            r#"WITH RECURSIVE subtree AS (
            SELECT id,0 AS depth FROM password_folders WHERE team_id=$1 AND id=$2
            UNION ALL
            SELECT child.id,subtree.depth+1 FROM password_folders child
            JOIN subtree ON child.parent_id=subtree.id WHERE child.team_id=$1 AND subtree.depth<8
        ) SELECT id AS "id!",depth AS "depth!" FROM subtree LIMIT 501"#,
            team.0,
            id
        )
        .fetch_all(&mut **transaction)
        .await
        .map_err(database_error)?;
        if rows.len() > MAX_FOLDERS {
            return Err(Error::Invalid);
        }
        let height = rows.iter().map(|row| row.depth).max().unwrap_or(0);
        if height >= MAX_DEPTH {
            return Err(Error::Invalid);
        }
        Ok((rows.into_iter().map(|row| row.id).collect(), height))
    }

    #[tracing::instrument(skip_all,err,name="passwords.folder.move",fields(team_id=%team.0,folder_id=%id))]
    pub(super) async fn move_stored_folder(
        &self,
        team: TeamId,
        id: Uuid,
        parent: Option<Uuid>,
    ) -> Result<Folder, Error> {
        let mut transaction = self.folder_transaction(team).await?;
        let (subtree, height) = Self::folder_subtree(&mut transaction, team, id).await?;
        if parent.is_some_and(|parent| subtree.contains(&parent)) {
            return Err(Error::Invalid);
        }
        let parent_depth = Self::parent_depth(&mut transaction, team, parent).await?;
        if parent_depth + 1 + height > MAX_DEPTH {
            return Err(Error::Invalid);
        }
        let row = sqlx::query!("UPDATE password_folders SET parent_id=$3 WHERE team_id=$1 AND id=$2 RETURNING id,name,parent_id",team.0,id,parent)
            .fetch_optional(&mut *transaction).await.map_err(folder_error)?.ok_or(Error::NotFound)?;
        transaction.commit().await.map_err(database_error)?;
        Ok(Folder {
            id: row.id,
            team_id: team,
            name: row.name,
            parent_id: row.parent_id,
        })
    }

    #[tracing::instrument(skip_all,err,name="passwords.folder.delete",fields(team_id=%team.0,folder_id=%id))]
    pub(super) async fn delete_folder_tree(&self, team: TeamId, id: Uuid) -> Result<(), Error> {
        let mut transaction = self.folder_transaction(team).await?;
        let (subtree, _) = Self::folder_subtree(&mut transaction, team, id).await?;
        sqlx::query!("SELECT id FROM password_folders WHERE team_id=$1 AND id=ANY($2) ORDER BY id FOR UPDATE",team.0,&subtree)
            .fetch_all(&mut *transaction).await.map_err(database_error)?;
        let ids: Vec<_> = subtree.iter().map(Uuid::to_string).collect();
        sqlx::query!("UPDATE password_item_entities SET metadata=jsonb_set(metadata,'{folderId}','null'::jsonb),revision=revision+1 WHERE team_id=$1 AND metadata->>'folderId' IS NOT NULL AND metadata->>'folderId'=ANY($2)",team.0,&ids)
            .execute(&mut *transaction).await.map_err(database_error)?;
        let deleted = sqlx::query!(
            "DELETE FROM password_folders WHERE team_id=$1 AND id=ANY($2)",
            team.0,
            &subtree
        )
        .execute(&mut *transaction)
        .await
        .map_err(database_error)?;
        if deleted.rows_affected() == 0 {
            return Err(Error::NotFound);
        }
        transaction.commit().await.map_err(database_error)
    }
}

fn folder_error(error: sqlx::Error) -> Error {
    if error
        .as_database_error()
        .is_some_and(|error| error.code().as_deref() == Some("23503"))
    {
        Error::Invalid
    } else {
        database_error(error)
    }
}

#[cfg(test)]
mod test;
