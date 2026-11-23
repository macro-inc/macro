use super::*;
use models_email::service::backfill::PopulateCrmContactPayload;
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

    ctx.effects.connect(link, connections).await.map_err(|e| {
        ProcessingError::NonRetryable(DetailedError {
            reason: FailureReason::SqsEnqueueFailed,
            source: e.context("Failed to enqueue contacts message"),
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

pub(super) async fn request_crm_populations<L, R, G, Q, E>(
    ctx: &InboxSyncService<L, R, G, Q, E>,
    link_id: Uuid,
    self_email: &str,
    contacts: impl IntoIterator<Item = CrmContactRecipient>,
    is_sent: bool,
) -> Result<(), ProcessingError>
where
    L: GmailOpsLinks,
    R: InboxSyncImportRepository,
    G: InboxSyncImportGmail,
    Q: InboxSyncQueue,
    E: MacroEventBroker + InboxSyncRefresher + InboxSyncImportEffects,
{
    let requests = crm_contact_requests(self_email, contacts, is_sent, true);
    if requests.is_empty() {
        return Ok(());
    }
    ctx.queue
        .request_crm_population(link_id, requests)
        .await
        .map_err(|e| {
            ProcessingError::Retryable(DetailedError {
                reason: FailureReason::SqsEnqueueFailed,
                source: e
                    .into_original()
                    .context("Failed to request CRM contact populations"),
            })
        })
}

/// Normalized, distinct, non-self CRM population requests, in input order.
/// `live_mail` is false only for the legacy history seed, which must not adopt
/// consent initialized after it was queued.
pub fn crm_contact_requests(
    self_email: &str,
    contacts: impl IntoIterator<Item = CrmContactRecipient>,
    is_sent: bool,
    live_mail: bool,
) -> Vec<PopulateCrmContactPayload> {
    let mut seen: HashSet<String> = HashSet::new();
    let mut requests = Vec::new();
    for (raw_email, contact_name, first_at, last_at) in contacts {
        let contact_email = raw_email.trim().to_ascii_lowercase();
        let Some((local, domain)) = contact_email.split_once('@') else {
            continue;
        };
        if local.is_empty() || domain.is_empty() || domain.contains('@') {
            continue;
        }
        if contact_email == self_email || !seen.insert(contact_email.clone()) {
            continue;
        }

        requests.push(PopulateCrmContactPayload {
            live_mail,
            contact_email,
            contact_name,
            first_at,
            last_at,
            is_sent,
        });
    }
    requests
}
