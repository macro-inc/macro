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

    sqlx::query!(
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

    crate::macro_user_links::insert_edge(&mut *conn, original_owner_macro_id, &mailbox_macro_id)
        .await?;
    crate::macro_user_links::insert_edge(&mut *conn, new_connector_macro_id, &mailbox_macro_id)
        .await?;

    Ok(PromotedSharedInbox {
        mailbox_macro_id,
        link_id: existing_link_id,
    })
}
