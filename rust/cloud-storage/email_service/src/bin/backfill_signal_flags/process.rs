use sqlx::types::Uuid;

/// Flags every thread on one of the user's links that has at least one
/// non-TRASH message matching the importance heuristic. One statement per
/// link keeps transactions small and the progress output per-mailbox.
/// Returns the number of threads flagged.
pub async fn process_macro_id(pool: &sqlx::PgPool, macro_id: &str) -> anyhow::Result<u64> {
    let link_ids: Vec<Uuid> =
        sqlx::query_scalar!("SELECT id FROM email_links WHERE macro_id = $1", macro_id)
            .fetch_all(pool)
            .await?;

    if link_ids.is_empty() {
        println!("No email links found for {macro_id}.");
        return Ok(0);
    }

    let mut total_flagged = 0u64;
    for link_id in link_ids {
        // Mirrors sync_thread_signal_flag (email_db_client/threads/update.rs)
        // and the Importance(true) predicate in the dynamic query builder.
        let flagged = sqlx::query!(
            r#"
            UPDATE email_threads t
            SET is_signal = true
            FROM (
                SELECT DISTINCT m.thread_id
                FROM email_messages m
                WHERE m.link_id = $1
                  AND NOT EXISTS (
                      SELECT 1 FROM email_message_labels ml
                      JOIN email_labels l ON ml.label_id = l.id
                      WHERE ml.message_id = m.id AND l.name = 'TRASH'
                  )
                  AND (
                      (
                          EXISTS (
                              SELECT 1
                              FROM email_contacts sender_c
                              JOIN email_filters ef
                                ON ef.link_id = m.link_id
                               AND ef.email_address IS NOT NULL
                               AND LOWER(ef.email_address) = LOWER(sender_c.email_address)
                              WHERE sender_c.id = m.from_contact_id
                                AND ef.is_important = TRUE
                          )
                          OR EXISTS (
                              SELECT 1
                              FROM email_contacts sender_c
                              JOIN email_filters ef
                                ON ef.link_id = m.link_id
                               AND ef.email_domain IS NOT NULL
                               AND LOWER(ef.email_domain) = LOWER(SPLIT_PART(sender_c.email_address, '@', 2))
                              WHERE sender_c.id = m.from_contact_id
                                AND ef.is_important = TRUE
                                AND NOT EXISTS (
                                    SELECT 1 FROM email_filters ef_addr
                                    WHERE ef_addr.link_id = m.link_id
                                      AND ef_addr.email_address IS NOT NULL
                                      AND LOWER(ef_addr.email_address) = LOWER(sender_c.email_address)
                                      AND ef_addr.is_important = FALSE
                                )
                          )
                      )
                      OR (
                          NOT (
                              EXISTS (
                                  SELECT 1
                                  FROM email_contacts sender_c
                                  JOIN email_filters ef
                                    ON ef.link_id = m.link_id
                                   AND ef.email_address IS NOT NULL
                                   AND LOWER(ef.email_address) = LOWER(sender_c.email_address)
                                  WHERE sender_c.id = m.from_contact_id
                                    AND ef.is_important = FALSE
                              )
                              OR EXISTS (
                                  SELECT 1
                                  FROM email_contacts sender_c
                                  JOIN email_filters ef
                                    ON ef.link_id = m.link_id
                                   AND ef.email_domain IS NOT NULL
                                   AND LOWER(ef.email_domain) = LOWER(SPLIT_PART(sender_c.email_address, '@', 2))
                                  WHERE sender_c.id = m.from_contact_id
                                    AND ef.is_important = FALSE
                                    AND NOT EXISTS (
                                        SELECT 1 FROM email_filters ef_addr
                                        WHERE ef_addr.link_id = m.link_id
                                          AND ef_addr.email_address IS NOT NULL
                                          AND LOWER(ef_addr.email_address) = LOWER(sender_c.email_address)
                                          AND ef_addr.is_important = TRUE
                                    )
                              )
                          )
                          AND (
                              m.is_draft = TRUE
                              OR EXISTS (
                                  SELECT 1 FROM email_message_labels ml
                                  JOIN email_labels l ON ml.label_id = l.id
                                  WHERE ml.message_id = m.id
                                    AND l.name IN ('CATEGORY_PERSONAL', 'SENT', 'DRAFT')
                              )
                              OR NOT EXISTS (
                                  SELECT 1 FROM email_message_labels ml
                                  JOIN email_labels l ON ml.label_id = l.id
                                  WHERE ml.message_id = m.id
                                    AND l.name IN ('CATEGORY_UPDATES', 'CATEGORY_PROMOTIONS', 'CATEGORY_SOCIAL', 'CATEGORY_FORUMS')
                              )
                          )
                      )
                  )
            ) sig
            WHERE t.id = sig.thread_id
              AND NOT t.is_signal
            "#,
            link_id
        )
        .execute(pool)
        .await?
        .rows_affected();

        // Prefix with the user so interleaved concurrent output stays readable.
        println!("[{macro_id}] link {link_id}: flagged {flagged} threads");
        total_flagged += flagged;
    }

    Ok(total_flagged)
}

/// Every macro ID that owns at least one email link. Connected secondary
/// mailboxes carry their own macro_id row in email_links, so iterating these
/// covers every link exactly once.
pub async fn fetch_all_macro_ids(pool: &sqlx::PgPool) -> anyhow::Result<Vec<String>> {
    Ok(
        sqlx::query_scalar!("SELECT DISTINCT macro_id FROM email_links ORDER BY macro_id")
            .fetch_all(pool)
            .await?,
    )
}
