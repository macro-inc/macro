use anyhow::Result;
use sqlx::PgPool;
use sqlx::types::Uuid;

/// Returns the sender's importance override (`Some(true)` = signal, `Some(false)` = noise)
/// by checking `email_filters` for the sender contact, mirroring the SQL in
/// `build_sender_importance_override_filter`. Email-level matches take precedence over
/// domain-level matches; a domain-level match is suppressed by an email-level override of
/// the opposite importance.
#[tracing::instrument(err, skip(db))]
pub async fn get_sender_importance_override(
    db: &PgPool,
    from_contact_id: Uuid,
    link_id: Uuid,
) -> Result<Option<bool>> {
    // Email-level override takes full precedence.
    let email_level = sqlx::query!(
        r#"
        SELECT ef.is_important
        FROM email_contacts c
        JOIN email_filters ef
          ON ef.link_id = $2
         AND ef.email_address IS NOT NULL
         AND LOWER(ef.email_address) = LOWER(c.email_address)
        WHERE c.id = $1
        LIMIT 1
        "#,
        from_contact_id,
        link_id,
    )
    .fetch_optional(db)
    .await?;

    if let Some(row) = email_level {
        return Ok(Some(row.is_important));
    }

    // No email-level override; apply domain-level unless blocked by an email-level override
    // of the opposite importance for this specific sender address.
    let domain_level = sqlx::query!(
        r#"
        SELECT ef.is_important
        FROM email_contacts c
        JOIN email_filters ef
          ON ef.link_id = $2
         AND ef.email_domain IS NOT NULL
         AND LOWER(ef.email_domain) = LOWER(split_part(c.email_address, '@', 2))
        WHERE c.id = $1
        AND NOT EXISTS (
            SELECT 1
            FROM email_filters ef_addr
            WHERE ef_addr.link_id = $2
              AND ef_addr.email_address IS NOT NULL
              AND LOWER(ef_addr.email_address) = LOWER(c.email_address)
              AND ef_addr.is_important != ef.is_important
        )
        LIMIT 1
        "#,
        from_contact_id,
        link_id,
    )
    .fetch_optional(db)
    .await?;

    Ok(domain_level.map(|row| row.is_important))
}
