use macro_user_id::user_id::MacroUserIdStr;
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

    let users: Vec<MacroUserIdStr<'static>> = std::iter::once(Ok(link.macro_id.clone()))
        .chain(
            contact_emails
                .iter()
                .map(|email| MacroUserIdStr::try_from_email(email)),
        )
        .collect::<Result<_, _>>()?;

    sqs_client.enqueue_contacts(users).await?;

    Ok(())
}
