use macro_user_id::handle::MailboxHandle;

#[cfg(test)]
mod test;

/// Why an authenticated handle claim could not be completed.
#[derive(Debug, thiserror::Error)]
pub enum ClaimHandleError {
    /// Another account already claimed this handle, ignoring ASCII case.
    #[error("mailbox handle is already taken")]
    Taken,
    /// This account already claimed a different handle.
    #[error("account already claimed a different mailbox handle")]
    AlreadyClaimed,
    /// The authenticated FusionAuth id was not a UUID.
    #[error("invalid account identity")]
    InvalidIdentity,
    /// The claim could not be persisted.
    #[error(transparent)]
    Database(#[from] sqlx::Error),
}

/// Claims `handle` for the FusionAuth user, or returns success when they
/// already own that exact handle. Existing usernames remain untouched until
/// this one-time transition.
pub async fn claim_handle(
    db: &sqlx::PgPool,
    fusionauth_user_id: &str,
    handle: &MailboxHandle,
) -> Result<(), ClaimHandleError> {
    let fusionauth_user_id = macro_uuid::string_to_uuid(fusionauth_user_id)
        .map_err(|_| ClaimHandleError::InvalidIdentity)?;
    let result = sqlx::query!(
        r#"
        UPDATE macro_user
        SET username = $2,
            mailbox_handle_claimed_at = COALESCE(mailbox_handle_claimed_at, now())
        WHERE id = $1
          AND (mailbox_handle_claimed_at IS NULL OR lower(username) = lower($2))
        "#,
        fusionauth_user_id,
        handle.as_str(),
    )
    .execute(db)
    .await;

    match result {
        Ok(result) if result.rows_affected() == 1 => Ok(()),
        Ok(_) => Err(ClaimHandleError::AlreadyClaimed),
        Err(sqlx::Error::Database(error)) if error.is_unique_violation() => {
            Err(ClaimHandleError::Taken)
        }
        Err(error) => Err(ClaimHandleError::Database(error)),
    }
}
