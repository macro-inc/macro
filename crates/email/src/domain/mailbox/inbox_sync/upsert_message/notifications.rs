use super::*;
use crate::domain::models::{PreviewCursorQuery, PreviewView, PreviewViewStandardLabel};
use email_utils::is_macro_notification_sender;
use filter_ast::Expr;
use item_filters::{SharedEmailFilter, ast::email::EmailLiteral};
use std::sync::Arc;
/// Notify downstream services about new message in a user's inbox
#[tracing::instrument(skip(ctx, link, new_message_provider_id))]
pub(super) async fn notify_for_new_message<L, R, G, Q, E>(
    ctx: &InboxSyncService<L, R, G, Q, E>,
    link: &link::Link,
    new_message_provider_id: &str,
    message_db_id: Uuid,
    thread_id: Uuid,
) -> result::Result<(), ProcessingError>
where
    L: GmailOpsLinks,
    R: InboxSyncImportRepository,
    G: InboxSyncImportGmail,
    Q: InboxSyncQueue,
    E: MacroEventBroker + InboxSyncRefresher + InboxSyncImportEffects,
{
    // notify user of new messages
    send_notifications(ctx, link, new_message_provider_id).await?;

    Ok(())
}

/// Send notifications for new inbound email messages

#[tracing::instrument(skip(ctx, link))]
async fn send_notifications<L, R, G, Q, E>(
    ctx: &InboxSyncService<L, R, G, Q, E>,
    link: &link::Link,
    new_message_provider_id: &str,
) -> result::Result<(), ProcessingError>
where
    L: GmailOpsLinks,
    R: InboxSyncImportRepository,
    G: InboxSyncImportGmail,
    Q: InboxSyncQueue,
    E: MacroEventBroker + InboxSyncRefresher + InboxSyncImportEffects,
{
    if !ctx.features.notifications_enabled {
        return Ok(());
    }

    let Some(message) = filter_notifiable_message(ctx, link, new_message_provider_id).await? else {
        return Ok(());
    };

    let message_ids: Vec<Uuid> = vec![message.db_id];

    let sender_contacts = ctx
        .repository
        .sender_contacts(&message_ids)
        .await
        .map_err(|e| {
            ProcessingError::Retryable(DetailedError {
                reason: FailureReason::DatabaseQueryFailed,
                source: e
                    .into_original()
                    .context("Failed to fetch contact info".to_string()),
            })
        })?;

    let sender_contact = message
        .from_contact_id
        .and_then(|from_id| sender_contacts.get(&from_id));

    // Macro's own digest / system emails describe activity the user already
    // has in-app notifications for; never raise a new-email notification
    // (in-app row or push) on top of them.
    if sender_contact.is_some_and(|contact| is_macro_notification_sender(&contact.email)) {
        tracing::debug!(
            thread_id = %message.thread_db_id,
            "skipping new-email notification for Macro's own notification sender"
        );
        return Ok(());
    }

    let Some(tier) = new_email_tier(ctx, link, message.thread_db_id).await? else {
        return Ok(());
    };

    let sender = sender_contact.map(|contact| {
        contact
            .name
            .clone()
            .unwrap_or_else(|| contact.email.clone())
    });

    let sender_id =
        sender_contact.and_then(|contact| MacroUserIdStr::try_from_email(&contact.email).ok());

    let notification = InboxSyncNotification {
        sender,
        to_email: link.email_address.0.as_ref().to_string(),
        thread_id: message.thread_db_id,
        subject: message.subject.unwrap_or_default(),
        snippet: message.snippet.unwrap_or_default(),
        sender_id,
        recipients: HashSet::new(),
        realtime: matches!(tier, NewEmailTier::Signal),
        apns: false,
    };

    let primaries = ctx
        .repository
        .primaries(link.macro_id.as_ref(), link.id)
        .await
        .map_err(|e| {
            ProcessingError::Retryable(DetailedError {
                reason: FailureReason::DatabaseQueryFailed,
                source: e
                    .into_original()
                    .context("Failed to fetch delegated primaries".to_string()),
            })
        })?;

    let recipient_ids = build_notification_recipients(&link.macro_id, primaries);
    let (staff_recipients, customer_recipients) = partition_email_push_recipients(recipient_ids);

    if !staff_recipients.is_empty() {
        let mut request = notification.clone();
        request.recipients = staff_recipients;
        request.apns = matches!(tier, NewEmailTier::Signal);
        ctx.effects.notify(request).await;
    }
    if !customer_recipients.is_empty() {
        let mut request = notification;
        request.recipients = customer_recipients;
        ctx.effects.notify(request).await;
    }

    Ok(())
}

/// Split recipients so only `@macro.com` users are on the APNS path.
fn partition_email_push_recipients(
    recipient_ids: HashSet<MacroUserIdStr<'static>>,
) -> (
    HashSet<MacroUserIdStr<'static>>,
    HashSet<MacroUserIdStr<'static>>,
) {
    recipient_ids
        .into_iter()
        .partition(|id| id.is_macro_staff())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum NewEmailTier {
    /// Everyone gets the in-app row; staff also get APNS.
    Signal,
    /// Staff dogfood: in-app row only.
    StaffInbox,
}

fn signal_filter(thread_id: Uuid) -> Expr<EmailLiteral> {
    Expr::and(
        Expr::Literal(EmailLiteral::ThreadId(thread_id)),
        Expr::and(
            Expr::Literal(EmailLiteral::Importance(true)),
            Expr::Literal(EmailLiteral::Shared(SharedEmailFilter::Exclude)),
        ),
    )
}

async fn thread_in_inbox<L, R, G, Q, E>(
    ctx: &InboxSyncService<L, R, G, Q, E>,
    link: &link::Link,
    filter: Expr<EmailLiteral>,
) -> result::Result<bool, ProcessingError>
where
    L: GmailOpsLinks,
    R: InboxSyncImportRepository,
    G: InboxSyncImportGmail,
    Q: InboxSyncQueue,
    E: MacroEventBroker + InboxSyncRefresher + InboxSyncImportEffects,
{
    let query = PreviewCursorQuery {
        view: PreviewView::StandardLabel(PreviewViewStandardLabel::Inbox),
        link_ids: vec![link.id],
        limit: 1,
        query: models_pagination::Query::Sort(
            models_pagination::SimpleSortMethod::UpdatedAt,
            Some(Arc::new(filter)),
        ),
        team_id: None,
    };

    let previews = ctx
        .repository
        .previews(query, link.macro_id.clone())
        .await
        .map_err(|e| {
            ProcessingError::Retryable(DetailedError {
                reason: FailureReason::DatabaseQueryFailed,
                source: e
                    .into_original()
                    .context("Failed to evaluate inbox membership"),
            })
        })?;

    Ok(!previews.is_empty())
}

async fn new_email_tier<L, R, G, Q, E>(
    ctx: &InboxSyncService<L, R, G, Q, E>,
    link: &link::Link,
    thread_id: Uuid,
) -> result::Result<Option<NewEmailTier>, ProcessingError>
where
    L: GmailOpsLinks,
    R: InboxSyncImportRepository,
    G: InboxSyncImportGmail,
    Q: InboxSyncQueue,
    E: MacroEventBroker + InboxSyncRefresher + InboxSyncImportEffects,
{
    if thread_in_inbox(ctx, link, signal_filter(thread_id)).await? {
        return Ok(Some(NewEmailTier::Signal));
    }
    let staff_inbox = link.macro_id.is_macro_staff()
        && thread_in_inbox(ctx, link, Expr::Literal(EmailLiteral::ThreadId(thread_id))).await?;
    Ok(staff_inbox.then_some(NewEmailTier::StaffInbox))
}

/// Loads the newly upserted message, returning `None` for messages that never
/// notify (sent or draft). Sender- and tier-based gating happens in
/// `send_notifications`.
#[tracing::instrument(skip(ctx, link))]
async fn filter_notifiable_message<L, R, G, Q, E>(
    ctx: &InboxSyncService<L, R, G, Q, E>,
    link: &link::Link,
    new_message_provider_id: &str,
) -> result::Result<Option<SimpleMessage>, ProcessingError>
where
    L: GmailOpsLinks,
    R: InboxSyncImportRepository,
    G: InboxSyncImportGmail,
    Q: InboxSyncQueue,
    E: MacroEventBroker + InboxSyncRefresher + InboxSyncImportEffects,
{
    let new_message = ctx
        .repository
        .message(link.id, new_message_provider_id)
        .await
        .map_err(|e| {
            ProcessingError::Retryable(DetailedError {
                reason: FailureReason::DatabaseQueryFailed,
                source: e
                    .into_original()
                    .context("Failed to fetch simple message".to_string()),
            })
        })?;

    let Some(new_message) = new_message else {
        return Ok(None);
    };

    if new_message.is_sent || new_message.is_draft {
        return Ok(None);
    }

    Ok(Some(new_message))
}
fn build_notification_recipients(
    owner: &MacroUserIdStr<'static>,
    primaries: Vec<String>,
) -> HashSet<MacroUserIdStr<'static>> {
    let mut recipient_ids = HashSet::from([owner.clone()]);

    for primary in primaries {
        match MacroUserIdStr::try_from(primary) {
            Ok(id) => {
                recipient_ids.insert(id);
            }
            Err(e) => {
                tracing::warn!(
                    error=?e,
                    inbox_owner=%owner,
                    "skipping delegated primary that failed to parse as a macro user id"
                );
            }
        }
    }

    recipient_ids
}

#[cfg(test)]
mod test;
