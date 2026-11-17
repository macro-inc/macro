use super::*;
use models_email::service::backfill::PopulateCrmContactPayload;
/// A correspondent's address, display name, and first and last interaction.
pub type CrmContactRecipient = (
    String,
    Option<String>,
    chrono::DateTime<chrono::Utc>,
    chrono::DateTime<chrono::Utc>,
);
#[tracing::instrument(skip(ctx, link, recipient_emails, sender_email))]
pub(super) async fn handle_contacts_sync<L, R, G, Q, E>(
    ctx: &InboxSyncService<L, R, G, Q, E>,
    link: &link::Link,
    recipient_emails: &[String],
    sender_email: Option<&str>,
    is_sent: bool,
) -> result::Result<(), ProcessingError>
where
    L: GmailOpsLinks,
    R: InboxSyncImportRepository,
    G: InboxSyncImportGmail,
    Q: InboxSyncQueue,
    E: MacroEventBroker + InboxSyncRefresher + InboxSyncImportEffects,
{
    if !ctx.features.contacts_sync {
        return Ok(());
    }

    // Determine which emails to create connections to based on message direction
    let connection_emails: Vec<&str> = if is_sent {
        recipient_emails.iter().map(String::as_str).collect()
    } else {
        sender_email.into_iter().collect()
    };

    let connections = build_contact_connections(&link.macro_id, link.id, connection_emails);

    if connections.is_empty() {
        return Ok(());
    }

    ctx.effects
        .connect(&link.macro_id, connections)
        .await
        .map_err(|e| {
            ProcessingError::NonRetryable(DetailedError {
                reason: FailureReason::SqsEnqueueFailed,
                source: e.context(format!(
                    "Failed to enqueue contacts message for {}",
                    link.macro_id
                )),
            })
        })?;

    Ok(())
}

/// Parse contact identities, skipping malformed addresses without logging their values.
pub fn build_contact_connections<'a>(
    _owner: &MacroUserIdStr<'static>,
    link_id: Uuid,
    emails: impl IntoIterator<Item = &'a str>,
) -> Vec<MacroUserIdStr<'static>> {
    emails
        .into_iter()
        .filter_map(|email| match MacroUserIdStr::try_from_email(email) {
            Ok(contact) => Some(contact),
            // The parse error echoes the address, so it stays out of the log.
            Err(_) => {
                tracing::warn!(
                    %link_id,
                    "skipping contact address that failed to parse as a macro user id"
                );
                None
            }
        })
        .collect()
}

/// Records the CRM population requests a stored message implies.
pub(super) async fn request_crm_population<L, R, G, Q, E>(
    ctx: &InboxSyncService<L, R, G, Q, E>,
    link_id: Uuid,
    requests: &[PopulateCrmContactPayload],
) -> Result<(), ProcessingError>
where
    L: GmailOpsLinks,
    R: InboxSyncImportRepository,
    G: InboxSyncImportGmail,
    Q: InboxSyncQueue,
    E: MacroEventBroker + InboxSyncRefresher + InboxSyncImportEffects,
{
    if requests.is_empty() {
        return Ok(());
    }
    ctx.repository
        .request_crm_population(link_id, requests)
        .await
        .map_err(|e| {
            ProcessingError::Retryable(DetailedError {
                reason: FailureReason::DatabaseQueryFailed,
                source: e
                    .into_original()
                    .context("Failed to record CRM population requests"),
            })
        })
}
