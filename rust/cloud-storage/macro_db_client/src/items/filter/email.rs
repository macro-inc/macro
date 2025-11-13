//! This module contains db queries to provide and filter out thread ids for email

use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};

/// Given a user_id, this will return a list of thread ids for that user
#[tracing::instrument(skip(db), err)]
pub async fn get_thread_ids_for_user(
    db: &sqlx::PgPool,
    macro_user_id: &MacroUserId<Lowercase<'_>>,
) -> anyhow::Result<Vec<uuid::Uuid>> {
    let thread_ids = sqlx::query!(
        r#"
        SELECT
            t.id
        FROM
            "email_threads" t
        JOIN
            "email_links" l ON t."link_id" = l.id
        WHERE
            l."macro_id" = $1
        "#,
        macro_user_id.as_ref(),
    )
    .map(|row| row.id)
    .fetch_all(db)
    .await?;

    Ok(thread_ids)
}

/// Given a list of thread ids, this will return a subset list of thread ids that have messages
/// from the provided senders
#[tracing::instrument(skip(db), err)]
pub async fn filter_thread_ids_by_senders(
    db: &sqlx::PgPool,
    thread_ids: &[uuid::Uuid],
    senders: &[String],
) -> anyhow::Result<Vec<uuid::Uuid>> {
    let thread_ids = sqlx::query!(
        r#"
        SELECT DISTINCT em.thread_id as id
            FROM email_messages em
        JOIN email_contacts ec ON em.from_contact_id = ec.id
        WHERE
            em.thread_id = ANY($1)
            AND ec.email_address = ANY($2)
        "#,
        thread_ids,
        senders,
    )
    .map(|row| row.id)
    .fetch_all(db)
    .await?;

    Ok(thread_ids)
}

/// Given a list of thread ids, this will return a subset list of thread ids that have messages
/// from the provided recipients
#[tracing::instrument(skip(db), err)]
pub async fn filter_thread_ids_by_recipients(
    db: &sqlx::PgPool,
    thread_ids: &[uuid::Uuid],
    recipients: &[String],
) -> anyhow::Result<Vec<uuid::Uuid>> {
    let thread_ids = sqlx::query!(
        r#"
        SELECT DISTINCT em.thread_id as id
        FROM email_messages em
        WHERE em.thread_id = ANY($1)
        AND EXISTS (
            SELECT 1
            FROM email_message_recipients emr
            JOIN email_contacts ec ON emr.contact_id = ec.id
            WHERE emr.message_id = em.id
            AND ec.email_address = ANY($2)
            AND emr.recipient_type = 'TO'
        )
        "#,
        thread_ids,
        recipients,
    )
    .map(|row| row.id)
    .fetch_all(db)
    .await?;

    Ok(thread_ids)
}

/// Given a list of thread ids, this will return a subset list of thread ids that have messages
/// from the provided cc
#[tracing::instrument(skip(db), err)]
pub async fn filter_thread_ids_by_cc(
    db: &sqlx::PgPool,
    thread_ids: &[uuid::Uuid],
    cc: &[String],
) -> anyhow::Result<Vec<uuid::Uuid>> {
    let thread_ids = sqlx::query!(
        r#"
        SELECT DISTINCT em.thread_id as id
        FROM email_messages em
        WHERE em.thread_id = ANY($1)
        AND EXISTS (
            SELECT 1
            FROM email_message_recipients emr
            JOIN email_contacts ec ON emr.contact_id = ec.id
            WHERE emr.message_id = em.id
            AND ec.email_address = ANY($2)
            AND emr.recipient_type = 'CC'
        )
        "#,
        thread_ids,
        cc,
    )
    .map(|row| row.id)
    .fetch_all(db)
    .await?;

    Ok(thread_ids)
}

/// Given a list of thread ids, this will return a subset list of thread ids that have messages
/// from the provided bcc
#[tracing::instrument(skip(db), err)]
pub async fn filter_thread_ids_by_bcc(
    db: &sqlx::PgPool,
    thread_ids: &[uuid::Uuid],
    bcc: &[String],
) -> anyhow::Result<Vec<uuid::Uuid>> {
    let thread_ids = sqlx::query!(
        r#"
        SELECT DISTINCT em.thread_id as id
        FROM email_messages em
        WHERE em.thread_id = ANY($1)
        AND EXISTS (
            SELECT 1
            FROM email_message_recipients emr
            JOIN email_contacts ec ON emr.contact_id = ec.id
            WHERE emr.message_id = em.id
            AND ec.email_address = ANY($2)
            AND emr.recipient_type = 'BCC'
        )
        "#,
        thread_ids,
        bcc,
    )
    .map(|row| row.id)
    .fetch_all(db)
    .await?;

    Ok(thread_ids)
}
