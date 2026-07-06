use sqlx::types::Uuid;

/// Flags every thread on one of the user's links that has at least one
/// calendar attachment. One statement per link keeps transactions small and
/// the progress output per-mailbox. Returns the number of threads flagged.
pub async fn process_macro_id(pool: &sqlx::PgPool, macro_id: &str) -> anyhow::Result<u64> {
    let link_ids: Vec<Uuid> = sqlx::query_scalar("SELECT id FROM email_links WHERE macro_id = $1")
        .bind(macro_id)
        .fetch_all(pool)
        .await?;

    if link_ids.is_empty() {
        println!("No email links found for {macro_id}.");
        return Ok(0);
    }

    let mut total_flagged = 0u64;
    for link_id in link_ids {
        // Mirrors the CalendarOnly predicate in the email crate's dynamic
        // query builder and email_db_client::threads::update::sync_thread_calendar_flag.
        let flagged = sqlx::query(
            r#"
            UPDATE email_threads t
            SET has_calendar_attachment = true
            FROM (
                SELECT DISTINCT m.thread_id
                FROM email_messages m
                JOIN email_attachments a ON a.message_id = m.id
                WHERE m.link_id = $1
                  AND (a.filename ILIKE '%.ics'
                       OR a.mime_type = 'text/calendar'
                       OR a.mime_type = 'application/ics')
            ) cal
            WHERE t.id = cal.thread_id
              AND NOT t.has_calendar_attachment
            "#,
        )
        .bind(link_id)
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
        sqlx::query_scalar("SELECT DISTINCT macro_id FROM email_links ORDER BY macro_id")
            .fetch_all(pool)
            .await?,
    )
}
