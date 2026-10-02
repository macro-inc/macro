//! The per-user starter claim, taken in the transaction that creates the
//! starter, so a retry never finds half an example and a second request never
//! makes a second one.

#[cfg(all(test, feature = "gateway"))]
mod test;

use models_databases::DatabaseId;
use sqlx::{Postgres, Transaction};

/// What claiming a user's starter came to.
pub(crate) enum StarterClaim {
    /// This transaction claimed it; the starter may be created.
    Claimed,
    /// The user was given one before, whether or not it is still there.
    Given,
    /// The user owns a database already. The claim stands, so they are
    /// never given one later.
    OwnsDatabase,
}

/// Claim `user_id`'s one starter inside `transaction`. A concurrent claim
/// waits on this one's commit and then finds it [`StarterClaim::Given`].
pub(crate) async fn claim_starter(
    transaction: &mut Transaction<'static, Postgres>,
    user_id: &str,
) -> Result<StarterClaim, sqlx::Error> {
    let claimed = sqlx::query_scalar!(
        "INSERT INTO database_starter_seeds (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING RETURNING user_id",
        user_id,
    )
    .fetch_optional(&mut **transaction)
    .await?
    .is_some();
    if !claimed {
        return Ok(StarterClaim::Given);
    }
    // Existing and trashed databases both mean the user already started.
    let owns_database = sqlx::query_scalar!(
        "SELECT EXISTS(SELECT 1 FROM databases WHERE owner_id = $1) AS \"exists!\"",
        user_id
    )
    .fetch_one(&mut **transaction)
    .await?;
    Ok(if owns_database {
        StarterClaim::OwnsDatabase
    } else {
        StarterClaim::Claimed
    })
}

/// Record the database a claimed starter became.
pub(crate) async fn record_starter(
    transaction: &mut Transaction<'static, Postgres>,
    user_id: &str,
    database_id: DatabaseId,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        "UPDATE database_starter_seeds SET database_id = $2 WHERE user_id = $1",
        user_id,
        database_id.into_uuid()
    )
    .execute(&mut **transaction)
    .await?;
    Ok(())
}
