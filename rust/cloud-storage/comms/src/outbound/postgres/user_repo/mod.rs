//! Database-backed implementation of UserRepo that queries MacroDB directly.

use std::collections::HashSet;

use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use rootcause::Report;
use sqlx::PgPool;

use crate::domain::models::UserName;
use crate::domain::ports::UserRepo;

#[cfg(test)]
mod test;

/// Fetches user names from the database for the given user profile IDs.
///
/// This queries the `macro_user_info` table joined with the `User` table
/// to retrieve first and last names for users.
#[tracing::instrument(skip(db), err)]
async fn get_names_for_ids(
    db: &PgPool,
    ids: &[MacroUserIdStr<'_>],
) -> Result<Vec<UserName>, Report> {
    let rows = sqlx::query!(
        r#"
        SELECT
            u.id as user_profile_id,
            mui.first_name,
            mui.last_name
        FROM macro_user_info mui
        JOIN "User" u ON mui.macro_user_id = u.macro_user_id
        WHERE u.id = ANY($1)
        "#,
        &ids.iter().map(|s| s.to_string()).collect::<Vec<String>>()
    )
    .fetch_all(db)
    .await?;

    let names = rows
        .into_iter()
        .map(|row| UserName {
            id: MacroUserIdStr::parse_from_str(&row.user_profile_id)
                .expect("valid macro user id from db")
                .into_owned(),
            first_name: row.first_name,
            last_name: row.last_name,
        })
        .collect();

    Ok(names)
}

/// Database-backed implementation of UserRepo.
pub struct PgUserRepo {
    pool: PgPool,
}

impl PgUserRepo {
    /// Creates a new PgUserRepo with the given database connection pool.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

impl UserRepo for PgUserRepo {
    async fn get_names_for_ids(
        &self,
        ids: HashSet<MacroUserIdStr<'_>>,
    ) -> Result<Vec<UserName>, Report> {
        get_names_for_ids(&self.pool, &ids.into_iter().collect::<Vec<_>>()).await
    }
}
