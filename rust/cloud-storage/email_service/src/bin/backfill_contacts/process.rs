use model::contacts::ConnectionsMessage;
use sqs_client::SQS;

/// Process contacts for a single macro ID
pub async fn process_macro_id(
    db_pool: &sqlx::PgPool,
    sqs_client: &SQS,
    macro_id: &str,
) -> anyhow::Result<()> {
    let link = email_db_client::links::get::fetch_link_by_macro_id(db_pool, macro_id)
        .await?
        .unwrap();
    let contact_emails =
        email_db_client::contacts::get::fetch_contacts_emails_by_link_id(db_pool, link.id).await?;
    println!(
        "Found {} contacts to process for {}.",
        contact_emails.len(),
        macro_id
    );

    if contact_emails.is_empty() {
        println!("No contacts found for {}.", macro_id);
        return Ok(());
    }

    let mut users = vec![link.macro_id.to_string()];
    users.extend(
        contact_emails
            .iter()
            .map(|email| format!("macro|{}", email)),
    );

    let connections = (1..users.len()).map(|i| (0, i)).collect::<Vec<_>>();

    let connections_message = ConnectionsMessage { users, connections };

    sqs_client
        .enqueue_contacts_add_connection(connections_message)
        .await?;

    Ok(())
}
