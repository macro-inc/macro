//! PostgreSQL implementation of the [`UserHotkeyProfilesRepo`] port.

#[cfg(test)]
mod test;

use std::str::FromStr;

use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;

use crate::domain::models::{EmailHotkeyProfile, TasksHotkeyProfile, UserHotkeyProfiles};
use crate::domain::ports::UserHotkeyProfilesRepo;

/// PostgreSQL-backed user hotkey profiles repository, on the
/// `user_hotkey_profiles` table.
#[derive(Clone)]
pub struct PgUserHotkeyProfilesRepo {
    pool: PgPool,
}

impl PgUserHotkeyProfilesRepo {
    /// Create a repository backed by the given connection pool.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

/// Parse a stored profile name. A name this build doesn't know is a decode
/// error: the column is only written by this crate.
fn parse_column<T: FromStr<Err = strum::ParseError>>(
    column: &str,
    value: Option<String>,
) -> Result<Option<T>, sqlx::Error> {
    value
        .map(|value| {
            T::from_str(&value).map_err(|source| sqlx::Error::ColumnDecode {
                index: column.to_string(),
                source: Box::new(source),
            })
        })
        .transpose()
}

impl UserHotkeyProfilesRepo for PgUserHotkeyProfilesRepo {
    type Err = sqlx::Error;

    #[tracing::instrument(err, skip_all)]
    async fn get_profiles(
        &self,
        user_id: &MacroUserIdStr<'_>,
    ) -> Result<Option<UserHotkeyProfiles>, Self::Err> {
        let Some(row) = sqlx::query!(
            r#"
            SELECT email_profile, tasks_profile
            FROM user_hotkey_profiles
            WHERE user_id = $1
            "#,
            user_id.as_ref(),
        )
        .fetch_optional(&self.pool)
        .await?
        else {
            return Ok(None);
        };
        Ok(Some(UserHotkeyProfiles {
            email: parse_column::<EmailHotkeyProfile>("email_profile", row.email_profile)?,
            tasks: parse_column::<TasksHotkeyProfile>("tasks_profile", row.tasks_profile)?,
        }))
    }

    #[tracing::instrument(err, skip_all)]
    async fn set_profiles(
        &self,
        user_id: &MacroUserIdStr<'_>,
        profiles: UserHotkeyProfiles,
    ) -> Result<bool, Self::Err> {
        let result = sqlx::query!(
            r#"
            INSERT INTO user_hotkey_profiles (user_id, email_profile, tasks_profile)
            VALUES ($1, $2, $3)
            ON CONFLICT (user_id) DO UPDATE
            SET email_profile = EXCLUDED.email_profile,
                tasks_profile = EXCLUDED.tasks_profile,
                modified_at = now()
            "#,
            user_id.as_ref(),
            profiles.email.map(EmailHotkeyProfile::as_str),
            profiles.tasks.map(TasksHotkeyProfile::as_str),
        )
        .execute(&self.pool)
        .await;
        match result {
            Ok(_) => Ok(true),
            Err(sqlx::Error::Database(error)) if error.is_foreign_key_violation() => Ok(false),
            Err(error) => Err(error),
        }
    }
}
