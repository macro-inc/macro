//! Implementation of [UserExistenceChecker] that queries the database.

use crate::domain::models::email_notification_digest::ports::UserExistenceChecker;
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use sqlx::PgPool;

/// Database-backed implementation of [UserExistenceChecker].
///
/// Checks if a user exists by querying the User table.
pub struct DbUserExistenceChecker {
    db: PgPool,
}

impl DbUserExistenceChecker {
    /// Create a new [DbUserExistenceChecker] with the given database pool.
    pub fn new(db: PgPool) -> Self {
        Self { db }
    }
}

impl UserExistenceChecker for DbUserExistenceChecker {
    async fn user_exists<'a>(&self, id: MacroUserIdStr<'a>) -> Result<bool, Report> {
        let email = id.email_part();

        let result = sqlx::query!(
            r#"
            SELECT id
            FROM "User"
            WHERE email = $1
            "#,
            email.as_ref()
        )
        .fetch_optional(&self.db)
        .await?;

        Ok(result.is_some())
    }
}
