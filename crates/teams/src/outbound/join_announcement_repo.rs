//! MacroDB-backed adapter for
//! [`crate::domain::join_announcement::JoinAnnouncementRepository`].
//!
//! Owns the `team_joined_macro_email` ledger.

#[cfg(test)]
mod test;

use std::collections::HashMap;

use macro_user_id::user_id::MacroUserIdStr;
use rootcause::prelude::*;
use sqlx::PgPool;
use uuid::Uuid;

use crate::domain::join_announcement::{
    ClaimedJoinEmail, JoinAnnouncementError, JoinAnnouncementRepository,
};

/// [`JoinAnnouncementRepository`] over MacroDB.
#[derive(Clone)]
pub struct JoinAnnouncementRepositoryImpl {
    /// The underlying sqlx::PgPool connected to macrodb.
    pool: PgPool,
}

impl JoinAnnouncementRepositoryImpl {
    /// Creates a new instance of JoinAnnouncementRepositoryImpl
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

impl JoinAnnouncementRepository for JoinAnnouncementRepositoryImpl {
    #[tracing::instrument(skip(self, candidates), err)]
    async fn claim(
        &self,
        team_id: Uuid,
        candidates: &[MacroUserIdStr<'static>],
    ) -> Result<Vec<ClaimedJoinEmail>, Report<JoinAnnouncementError>> {
        let by_email: HashMap<&str, &MacroUserIdStr<'static>> = candidates
            .iter()
            .map(|candidate| (candidate.email_str(), candidate))
            .collect();
        let emails: Vec<String> = candidates
            .iter()
            .map(|candidate| candidate.email_str().to_owned())
            .collect();
        let user_ids: Vec<String> = candidates
            .iter()
            .map(|candidate| candidate.to_string())
            .collect();
        let rows = sqlx::query!(
            r#"
            WITH claimed AS (
                INSERT INTO team_joined_macro_email (team_id, email)
                SELECT t.id, c.email
                FROM team t
                CROSS JOIN UNNEST($2::text[], $3::text[]) AS c(email, user_id)
                WHERE t.id = $1
                  AND t.auto_join_domain IS NOT NULL
                  AND split_part(c.email, '@', 2) = t.auto_join_domain
                  AND NOT EXISTS (
                      SELECT 1 FROM team_user tu
                      WHERE tu.team_id = t.id AND tu.user_id = c.user_id
                  )
                  AND NOT EXISTS (
                      SELECT 1 FROM team_invite ti
                      WHERE ti.team_id = t.id AND ti.email = c.email
                  )
                ON CONFLICT (team_id, email) DO NOTHING
                RETURNING email
            )
            SELECT claimed.email AS "email!", t.name AS "team_name!"
            FROM claimed
            JOIN team t ON t.id = $1
            "#,
            team_id,
            &emails[..],
            &user_ids[..],
        )
        .fetch_all(&self.pool)
        .await
        .context(JoinAnnouncementError::Storage)?;
        Ok(rows
            .into_iter()
            .filter_map(|row| {
                by_email
                    .get(row.email.as_str())
                    .map(|recipient| ClaimedJoinEmail {
                        recipient: (*recipient).clone(),
                        team_name: row.team_name,
                    })
            })
            .collect())
    }

    #[tracing::instrument(skip(self, recipient), err)]
    async fn release(
        &self,
        team_id: Uuid,
        recipient: &MacroUserIdStr<'_>,
    ) -> Result<(), Report<JoinAnnouncementError>> {
        sqlx::query!(
            "DELETE FROM team_joined_macro_email WHERE team_id = $1 AND email = $2",
            team_id,
            recipient.email_str(),
        )
        .execute(&self.pool)
        .await
        .context(JoinAnnouncementError::Storage)?;
        Ok(())
    }
}
