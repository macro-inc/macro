//! Promotes an externally-shared mailbox to its own macro user. When a second macro
//! user connects a mailbox that is not itself a macro account, the connect flow would
//! otherwise create a duplicate `email_links` row and sync the same mailbox twice.
//! Instead we mint a dedicated macro user for the mailbox, re-home the single existing
//! link onto it, and grant both connectors access via `macro_user_links` edges.

use sqlx::types::Uuid;

#[cfg(test)]
mod test;

/// Outcome of promoting a duplicated external mailbox to a shared macro user.
pub struct PromotedSharedInbox {
    /// The macro_id minted for the mailbox. The re-homed link and both edges point at it.
    pub mailbox_macro_id: String,
    /// The uuid minted as the mailbox's `macro_user.id`. Grant relocation creates the
    /// mailbox's FusionAuth user with this same id, so the two stay aligned.
    pub mailbox_fusion_id: Uuid,
    /// The surviving (re-homed) `email_links` row — its id is unchanged, so the one
    /// synced copy and its history are preserved.
    pub link_id: Uuid,
}

/// Mints a dedicated macro user for `mailbox_email`, re-homes `existing_link_id` onto it,
/// and grants both the original owner and the new connector access via `macro_user_links`
/// edges. Because the minted macro_id embeds the mailbox email, the re-homed link's email
/// matches its macro_id — i.e. it is no longer an inbox-only secondary but a shared user.
///
/// Runs on a caller-provided connection so the mint, re-home, and edge inserts commit
/// atomically with the rest of the connect flow.
#[tracing::instrument(skip(conn), err)]
pub async fn promote_link_to_shared(
    conn: &mut sqlx::PgConnection,
    existing_link_id: Uuid,
    original_owner_macro_id: &str,
    new_connector_macro_id: &str,
    mailbox_email: &str,
    organization_id: Option<i32>,
) -> anyhow::Result<PromotedSharedInbox> {
    let mailbox_macro_id = format!("macro|{mailbox_email}");
    let fusionauth_user_id = macro_uuid::generate_uuid_v7();
    let stripe_customer_id = format!("cus_shared_{fusionauth_user_id}");

    sqlx::query!(
        r#"
        INSERT INTO macro_user (id, username, email, stripe_customer_id)
        VALUES ($1, $2, $3, $4)
        "#,
        &fusionauth_user_id,
        &mailbox_macro_id,
        mailbox_email,
        stripe_customer_id,
    )
    .execute(&mut *conn)
    .await?;

    sqlx::query!(
        r#"
        INSERT INTO macro_user_email_verification (macro_user_id, email, is_verified)
        VALUES ($1, $2, true)
        "#,
        &fusionauth_user_id,
        mailbox_email,
    )
    .execute(&mut *conn)
    .await?;

    sqlx::query!(
        r#"
        INSERT INTO "User" (id, email, macro_user_id, "organizationId")
        VALUES ($1, $2, $3, $4)
        "#,
        &mailbox_macro_id,
        mailbox_email,
        &fusionauth_user_id,
        organization_id,
    )
    .execute(&mut *conn)
    .await?;

    // Mark this macro_id as a promoted shared mailbox so teardown can distinguish it from a
    // real account: the last delegate removing access tears it down rather than orphaning it.
    sqlx::query!(
        r#"
        INSERT INTO promoted_shared_mailboxes (macro_id)
        VALUES ($1)
        ON CONFLICT (macro_id) DO NOTHING
        "#,
        &mailbox_macro_id,
    )
    .execute(&mut *conn)
    .await?;

    let rehomed = sqlx::query!(
        r#"
        UPDATE email_links
        SET macro_id = $1, updated_at = NOW()
        WHERE id = $2
        "#,
        &mailbox_macro_id,
        existing_link_id,
    )
    .execute(&mut *conn)
    .await?;

    // The link is read outside this transaction, so it may have been deleted before
    // re-homing. A zero-row update would otherwise commit a mailbox user and edges
    // with no inbox attached; abort so the caller's transaction rolls back instead.
    if rehomed.rows_affected() == 0 {
        anyhow::bail!("no email_links row {existing_link_id} to re-home; aborting promotion");
    }

    crate::macro_user_links::insert_edge(
        &mut *conn,
        original_owner_macro_id,
        &mailbox_macro_id,
        existing_link_id,
    )
    .await?;
    crate::macro_user_links::insert_edge(
        &mut *conn,
        new_connector_macro_id,
        &mailbox_macro_id,
        existing_link_id,
    )
    .await?;

    Ok(PromotedSharedInbox {
        mailbox_macro_id,
        mailbox_fusion_id: fusionauth_user_id,
        link_id: existing_link_id,
    })
}

/// Whether `macro_id` is a mailbox minted by shared-inbox promotion (no human owner),
/// as opposed to a real account someone was delegated to.
#[tracing::instrument(skip(conn), err)]
pub async fn is_promoted_shared_mailbox(
    conn: &mut sqlx::PgConnection,
    macro_id: &str,
) -> anyhow::Result<bool> {
    let exists = sqlx::query_scalar!(
        r#"
        SELECT EXISTS(
            SELECT 1 FROM promoted_shared_mailboxes WHERE macro_id = $1
        ) AS "exists!"
        "#,
        macro_id,
    )
    .fetch_one(&mut *conn)
    .await?;

    Ok(exists)
}

/// Deletes the macro user minted for a promoted shared mailbox once its single link has
/// been torn down. Removing the `User` row cascades its `macro_user_links` edges and the
/// `promoted_shared_mailboxes` marker; the backing `macro_user` row is removed explicitly.
/// No-op (returning `None`) when `macro_id` is not a promoted mailbox; otherwise returns
/// the deleted `macro_user.id`, which callers can match against a link's
/// `fusionauth_user_id` to recognize the mailbox's relocated FusionAuth stub.
#[tracing::instrument(skip(conn), err)]
pub async fn delete_promoted_mailbox_user(
    conn: &mut sqlx::PgConnection,
    macro_id: &str,
) -> anyhow::Result<Option<Uuid>> {
    let row = sqlx::query!(
        r#"
        DELETE FROM "User"
        WHERE id = $1
          AND EXISTS (SELECT 1 FROM promoted_shared_mailboxes WHERE macro_id = $1)
        RETURNING macro_user_id
        "#,
        macro_id,
    )
    .fetch_optional(&mut *conn)
    .await?;

    let Some(row) = row else {
        return Ok(None);
    };

    sqlx::query!(r#"DELETE FROM macro_user WHERE id = $1"#, row.macro_user_id)
        .execute(&mut *conn)
        .await?;

    Ok(Some(row.macro_user_id))
}
