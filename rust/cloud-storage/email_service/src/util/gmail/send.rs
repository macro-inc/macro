use sqlx::PgPool;
use uuid::Uuid;

/// Generate email headers that are used for threading
pub async fn generate_email_threading_headers(
    db: &PgPool,
    replying_to_db_id: Option<Uuid>,
    link_id: Uuid,
) -> (Option<String>, Option<Vec<String>>) {
    if let Some(replying_to_db_id) = replying_to_db_id {
        // Fetch headers from the parent message
        let (parent_id_header, parent_references_header) =
            email_db_client::messages::get::get_message_threading_headers(
                db,
                replying_to_db_id,
                link_id,
            )
                .await
                .unwrap_or_else(|e| {
                    tracing::warn!(error=?e, replying_to_db_id=?replying_to_db_id, "Unable to fetch threading headers for parent message");
                    (None, None) // Default to None on error
                });

        // Clean references header
        let mut references_list: Vec<String> = parent_references_header
            .map(|refs_str| {
                refs_str
                    .replace(['<', '>'], "")
                    .split_whitespace()
                    .map(String::from)
                    .collect()
            })
            .unwrap_or_default();

        // The message we are replying to will always be the last id in the References header
        if let Some(id) = &parent_id_header {
            references_list.push(id.clone());
        }

        let final_references = if references_list.is_empty() {
            None
        } else {
            Some(references_list)
        };

        (parent_id_header, final_references)
    } else {
        // If there is no message to reply to
        (None, None)
    }
}
