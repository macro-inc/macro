use contacts::domain::models::messages::ContactConnection;
use contacts::domain::ports::{ContactListIngress, ContactsIngress};
use email_service::composition::ContactsProducer;
use email_service::outbound::inbox_source::inbox_source;
use macro_user_id::user_id::MacroUserIdStr;

/// Process contacts for a single macro ID
pub async fn process_macro_id(
    db_pool: &sqlx::PgPool,
    contacts_ingress: &ContactsProducer,
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

    let contacts = contact_emails
        .iter()
        .map(|email| MacroUserIdStr::try_from_email(email))
        .collect::<Result<Vec<_>, _>>()?;

    let connections = contacts
        .iter()
        .map(|contact| ContactConnection::new(link.macro_id.clone(), contact.clone()))
        .collect();
    contacts_ingress
        .enqueue_contact_connections(connections)
        .await
        .map_err(|e| anyhow::anyhow!("{e:?}"))?;
    contacts_ingress
        .record_inbox_contacts(inbox_source(&link), contacts)
        .await
        .map_err(|e| anyhow::anyhow!("{e:?}"))?;

    Ok(())
}
