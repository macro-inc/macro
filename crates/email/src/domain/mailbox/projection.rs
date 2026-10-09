//! Durable downstream projection and live-mail notification policy.

use super::{MailboxError, MailboxKey};
use crate::domain::events::*;
use crate::domain::models::calendar_invitation::CalendarInvitation;
use email_api_client::domain::models::CalendarPart;
use macro_user_id::user_id::MacroUserIdStr;
use models_email::service::{link::Link, message::Message};
use serde::{Deserialize, Serialize};
use std::{collections::HashSet, future::Future};
use uuid::Uuid;

#[cfg(test)]
mod test;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ProjectionEvent {
    LinkChanged,
    AttachmentRecheck {
        message_id: Uuid,
    },
    ReauthorizationRequired,
    ContactsChanged {
        thread_ids: Vec<Uuid>,
        self_photo: bool,
    },
    Message {
        #[serde(default)]
        actor: Option<MacroUserIdStr<'static>>,
        message_id: Uuid,
        thread_id: Uuid,
        provider_id: String,
        is_import: bool,
        is_new: bool,
        #[serde(default)]
        is_new_thread: bool,
        was_draft: bool,
        is_draft: bool,
        is_sent: bool,
        #[serde(default)]
        version: Option<String>,
        calendar_parts: Vec<CalendarPart>,
    },
    Absent {
        message_id: Uuid,
        thread_id: Uuid,
    },
    Organization {
        thread_id: Uuid,
        #[serde(default)]
        actor: Option<MacroUserIdStr<'static>>,
        #[serde(default)]
        action: Option<crate::domain::models::mailbox_action::MailboxAction>,
    },
    LinkConnected {
        actor_id: String,
        is_new: bool,
    },
}

pub struct ProjectionLease {
    pub id: Uuid,
    pub lease_id: Uuid,
    pub mailbox: MailboxKey,
    pub event: ProjectionEvent,
    pub from_current_generation: bool,
}

pub struct ProjectedMessage {
    pub message: Message,
    pub in_inbox: bool,
    pub in_trash: bool,
    pub in_junk: bool,
    pub is_present: bool,
    pub thread_inbox_visible: bool,
    pub is_signal: bool,
    pub version: Option<String>,
}

pub struct ProjectionContext {
    pub link: Link,
    pub message: Option<ProjectedMessage>,
    pub viewers: HashSet<MacroUserIdStr<'static>>,
}

pub struct MailboxNotification {
    pub id: Uuid,
    pub recipients: HashSet<MacroUserIdStr<'static>>,
    pub sender: Option<String>,
    pub sender_id: Option<MacroUserIdStr<'static>>,
    pub to_email: String,
    pub subject: String,
    pub snippet: String,
    pub thread_id: Uuid,
    pub signal: bool,
    pub push: bool,
}

pub struct CorrespondenceContact {
    pub email: String,
    pub name: Option<String>,
    pub at: chrono::DateTime<chrono::Utc>,
}

pub struct CorrespondenceProjection {
    pub link_id: Uuid,
    pub owner: MacroUserIdStr<'static>,
    pub is_sent: bool,
    pub contacts: Vec<CorrespondenceContact>,
    pub connections: Vec<MacroUserIdStr<'static>>,
}

pub trait MailboxProjectionRepository: Send + Sync + 'static {
    fn renew_projection(
        &self,
        lease: &ProjectionLease,
    ) -> impl Future<Output = Result<(), MailboxError>> + Send;
    fn claim_projection(
        &self,
        lease_id: Uuid,
    ) -> impl Future<Output = Result<Option<ProjectionLease>, MailboxError>> + Send;
    fn projection_context(
        &self,
        lease: &ProjectionLease,
    ) -> impl Future<Output = Result<Option<ProjectionContext>, MailboxError>> + Send;
    fn finish_projection(
        &self,
        lease: &ProjectionLease,
        success: bool,
    ) -> impl Future<Output = Result<(), MailboxError>> + Send;
}

/// Effects are idempotent or carry a stable identity. Imports hydrate content
/// without generating new-message notifications for historical correspondence.
pub trait MailboxProjectionEffects: Send + Sync + 'static {
    fn reauthorization(
        &self,
        _id: Uuid,
        _context: &ProjectionContext,
    ) -> impl Future<Output = Result<(), MailboxError>> + Send {
        async { Ok(()) }
    }
    fn photo_refresh(
        &self,
        link_id: Uuid,
        viewers: &HashSet<MacroUserIdStr<'static>>,
    ) -> impl Future<Output = Result<(), MailboxError>> + Send {
        self.refresh(link_id, viewers)
    }
    fn publish(
        &self,
        event: EmailMacroEvent,
    ) -> impl Future<Output = Result<(), MailboxError>> + Send;
    fn refresh(
        &self,
        link_id: Uuid,
        viewers: &HashSet<MacroUserIdStr<'static>>,
    ) -> impl Future<Output = Result<(), MailboxError>> + Send;
    fn notify(
        &self,
        notification: MailboxNotification,
    ) -> impl Future<Output = Result<(), MailboxError>> + Send;
    fn contacts(
        &self,
        correspondence: CorrespondenceProjection,
    ) -> impl Future<Output = Result<(), MailboxError>> + Send;
    fn attachments(
        &self,
        mailbox: MailboxKey,
        context: &ProjectionContext,
        is_import: bool,
    ) -> impl Future<Output = Result<(), MailboxError>> + Send;
    fn invitations(
        &self,
        message_id: Uuid,
        invitations: &[CalendarInvitation],
    ) -> impl Future<Output = Result<(), MailboxError>> + Send;
}

/// Download under an already resolved worker or authorized request binding.
pub trait MailboxAttachmentAccess: Send + Sync + 'static {
    fn download(
        &self,
        mailbox: MailboxKey,
        message_id: &str,
        attachment_id: &str,
    ) -> impl Future<Output = Result<Vec<u8>, MailboxError>> + Send;
}

pub struct MailboxProjectionService<R, E> {
    repo: R,
    effects: E,
}
impl<R, E> MailboxProjectionService<R, E> {
    pub fn new(repo: R, effects: E) -> Self {
        Self { repo, effects }
    }
}
impl<R: MailboxProjectionRepository, E: MailboxProjectionEffects> MailboxProjectionService<R, E> {
    pub async fn project_once(&self) -> Result<bool, MailboxError> {
        let Some(lease) = self
            .repo
            .claim_projection(macro_uuid::generate_uuid_v7())
            .await?
        else {
            return Ok(false);
        };
        let result =
            super::maintain_lease(self.project(&lease), || self.repo.renew_projection(&lease))
                .await;
        self.repo.finish_projection(&lease, result.is_ok()).await?;
        result.map(|()| true)
    }

    async fn project(&self, lease: &ProjectionLease) -> Result<(), MailboxError> {
        let Some(context) = self.repo.projection_context(lease).await? else {
            return Ok(());
        };
        match &lease.event {
            ProjectionEvent::LinkChanged => {}
            ProjectionEvent::ReauthorizationRequired => {
                // A reconnect can obsolete a queued warning before delivery.
                if lease.from_current_generation && context.link.needs_reauth {
                    self.effects.reauthorization(lease.id, &context).await?;
                    self.effects
                        .publish(
                            EmailMacroEvent::link_reauth_required(LinkReauthRequiredMetadata {
                                link_id: context.link.id,
                                owner: context.link.macro_id.clone(),
                                email_address: context.link.email_address.0.as_ref().into(),
                                observed_at: context
                                    .link
                                    .last_sync_error_at
                                    .unwrap_or_else(chrono::Utc::now),
                            })
                            .with_event_id(lease.id),
                        )
                        .await?;
                }
            }
            ProjectionEvent::ContactsChanged {
                thread_ids,
                self_photo,
            } => {
                if !thread_ids.is_empty() {
                    self.effects
                        .publish(
                            EmailMacroEvent::threads_reindex_requested(
                                ThreadsReindexRequestedMetadata {
                                    link_id: context.link.id,
                                    owner: context.link.macro_id.clone(),
                                    thread_ids: thread_ids.clone(),
                                    reason: ThreadsReindexReason::ContactsChanged,
                                },
                            )
                            .with_event_id(lease.id),
                        )
                        .await?;
                }
                if *self_photo {
                    self.effects
                        .photo_refresh(context.link.id, &context.viewers)
                        .await?;
                }
            }
            ProjectionEvent::LinkConnected { is_new, .. } => {
                if *is_new {
                    self.effects
                        .publish(
                            EmailMacroEvent::link_connected(LinkConnectedMetadata {
                                link_id: context.link.id,
                                owner: context.link.macro_id.clone(),
                                email_address: context.link.email_address.0.as_ref().to_owned(),
                                provider: context.link.provider.as_str().into(),
                                is_primary: context.link.is_primary,
                                connected_at: context.link.created_at,
                            })
                            .with_event_id(lease.id),
                        )
                        .await?;
                }
            }
            ProjectionEvent::AttachmentRecheck { .. } => {
                if lease.from_current_generation
                    && context
                        .message
                        .as_ref()
                        .is_some_and(|message| message.is_present)
                {
                    self.effects
                        .attachments(lease.mailbox, &context, true)
                        .await?;
                }
                return Ok(());
            }
            ProjectionEvent::Absent { thread_id, .. } => {
                self.reindex(&context.link, *thread_id).await?;
            }
            ProjectionEvent::Organization {
                thread_id,
                actor,
                action,
            } => {
                if let (Some(actor), Some(action)) = (actor, action) {
                    self.effects
                        .publish(
                            organization_event(&context.link, *thread_id, actor.clone(), action)
                                .with_event_id(lease.id),
                        )
                        .await?;
                }
                self.reindex(&context.link, *thread_id).await?;
            }
            ProjectionEvent::Message {
                actor,
                message_id,
                thread_id,
                is_import,
                is_new,
                is_new_thread,
                was_draft,
                version,
                calendar_parts,
                ..
            } => {
                let Some(current) = &context.message else {
                    return Ok(());
                };
                let message = &current.message;
                let import = *is_import || !lease.from_current_generation;
                if current.is_present {
                    if !message.is_draft {
                        if version == &current.version {
                            self.effects
                                .invitations(*message_id, &invitation_snapshots(calendar_parts))
                                .await?;
                        }
                        self.effects.contacts(correspondence(&context)).await?;
                    }
                    if !import
                        && let Some(event) =
                            live_event(&context, *is_new, *is_new_thread, *was_draft, actor.clone())
                    {
                        self.effects.publish(event.with_event_id(lease.id)).await?;
                    }
                    if should_notify(import, *is_new, current) {
                        for notification in notifications(lease, &context) {
                            self.effects.notify(notification).await?;
                        }
                    }
                }
                self.reindex(&context.link, *thread_id).await?;
                self.effects
                    .refresh(context.link.id, &context.viewers)
                    .await?;
                if current.is_present {
                    self.effects
                        .attachments(lease.mailbox, &context, import)
                        .await?;
                }
                return Ok(());
            }
        }
        self.effects
            .refresh(context.link.id, &context.viewers)
            .await
    }

    async fn reindex(&self, link: &Link, thread: Uuid) -> Result<(), MailboxError> {
        self.effects
            .publish(EmailMacroEvent::threads_reindex_requested(
                ThreadsReindexRequestedMetadata {
                    link_id: link.id,
                    owner: link.macro_id.clone(),
                    thread_ids: vec![thread],
                    reason: ThreadsReindexReason::ProviderChanged,
                },
            ))
            .await
    }
}

fn invitation_snapshots(parts: &[CalendarPart]) -> Vec<CalendarInvitation> {
    #[cfg(feature = "calendar_invitations")]
    {
        let content = parts
            .iter()
            .filter_map(|part| part.inline_data.as_deref())
            .collect::<Vec<_>>();
        crate::domain::calendar_invitation_parser::parse_invitation_parts(&content)
    }
    #[cfg(not(feature = "calendar_invitations"))]
    {
        let _ = parts;
        Vec::new()
    }
}

fn live_event(
    context: &ProjectionContext,
    is_new: bool,
    is_new_thread: bool,
    was_draft: bool,
    actor: Option<MacroUserIdStr<'static>>,
) -> Option<EmailMacroEvent> {
    let current = context.message.as_ref()?;
    let message = &current.message;
    let provider_message_id = message.provider_id.clone()?;
    let provider_thread_id = message.provider_thread_id.clone()?;
    let link = &context.link;
    if message.is_draft {
        return Some(EmailMacroEvent::message_draft_synced(
            MessageDraftSyncedMetadata {
                link_id: link.id,
                owner: link.macro_id.clone(),
                message_id: message.db_id,
                provider_message_id,
                thread_id: message.thread_db_id,
                provider_thread_id,
                is_spam_or_trash: current.in_trash || current.in_junk,
            },
        ));
    }
    if !(is_new || was_draft && message.is_sent) {
        return None;
    }
    if message.is_sent {
        let origin = if actor.is_some() {
            EmailEventOrigin::UserAction
        } else {
            EmailEventOrigin::ProviderSync
        };
        Some(EmailMacroEvent::message_sent(MessageSentMetadata {
            link_id: link.id,
            owner: link.macro_id.clone(),
            actor,
            message_id: message.db_id,
            provider_message_id,
            thread_id: message.thread_db_id,
            provider_thread_id,
            subject: message.subject.clone(),
            to_emails: message.to.iter().map(|c| c.email.clone()).collect(),
            cc_emails: message.cc.iter().map(|c| c.email.clone()).collect(),
            origin,
            sent_at: message
                .sent_at
                .or(message.internal_date_ts)
                .unwrap_or(message.created_at),
        }))
    } else {
        Some(EmailMacroEvent::message_received(MessageReceivedMetadata {
            link_id: link.id,
            owner: link.macro_id.clone(),
            message_id: message.db_id,
            provider_message_id,
            thread_id: message.thread_db_id,
            provider_thread_id,
            is_new_thread,
            subject: message.subject.clone(),
            from_email: message.from.as_ref().map(|c| c.email.clone()),
            from_name: message.from.as_ref().and_then(|c| c.name.clone()),
            to_emails: message.to.iter().map(|c| c.email.clone()).collect(),
            attachment_count: message.attachments.len() as u32,
            is_spam_or_trash: current.in_trash || current.in_junk,
            received_at: message.internal_date_ts,
        }))
    }
}

fn should_notify(import: bool, is_new: bool, current: &ProjectedMessage) -> bool {
    let message = &current.message;
    !import
        && is_new
        && current.is_present
        && current.in_inbox
        && current.thread_inbox_visible
        && !current.in_trash
        && !current.in_junk
        && !message.is_draft
        && !message.is_sent
        && !message
            .from
            .as_ref()
            .is_some_and(|c| email_utils::is_macro_notification_sender(&c.email))
}

fn correspondence(context: &ProjectionContext) -> CorrespondenceProjection {
    let mut result = CorrespondenceProjection {
        link_id: context.link.id,
        owner: context.link.macro_id.clone(),
        is_sent: false,
        contacts: Vec::new(),
        connections: Vec::new(),
    };
    let Some(current) = &context.message else {
        return result;
    };
    let message = &current.message;
    result.is_sent = message.is_sent;
    if message.is_draft {
        return result;
    }
    let addresses: Vec<_> = if message.is_sent {
        message
            .to
            .iter()
            .chain(&message.cc)
            .chain(&message.bcc)
            .collect()
    } else {
        message.from.iter().collect()
    };
    let mut seen = HashSet::new();
    for contact in addresses {
        let address = contact.email.trim().to_ascii_lowercase();
        if address.eq_ignore_ascii_case(context.link.email_address.0.as_ref())
            || !seen.insert(address.clone())
        {
            continue;
        }
        let Ok(person) = MacroUserIdStr::try_from_email(&address) else {
            continue;
        };
        if !email_utils::is_generic_email(&address) {
            result.connections.push(person);
        }
        result.contacts.push(CorrespondenceContact {
            email: address,
            name: contact.name.clone(),
            at: message.internal_date_ts.unwrap_or(message.created_at),
        });
    }
    result
}

fn notifications(lease: &ProjectionLease, context: &ProjectionContext) -> Vec<MailboxNotification> {
    let Some(current) = &context.message else {
        return Vec::new();
    };
    let message = &current.message;
    let mut notifications = Vec::new();
    for staff in [true, false] {
        let recipients: HashSet<_> = context
            .viewers
            .iter()
            .filter(|id| id.is_macro_staff() == staff)
            .filter(|_| current.is_signal || context.link.macro_id.is_macro_staff())
            .cloned()
            .collect();
        if recipients.is_empty() {
            continue;
        }
        notifications.push(MailboxNotification {
            id: if staff { lease.id } else { message.db_id },
            recipients,
            sender: message
                .from
                .as_ref()
                .map(|c| c.name.clone().unwrap_or_else(|| c.email.clone())),
            sender_id: message
                .from
                .as_ref()
                .and_then(|c| MacroUserIdStr::try_from_email(&c.email).ok()),
            to_email: context.link.email_address.0.as_ref().to_owned(),
            subject: message.subject.clone().unwrap_or_default(),
            snippet: message.snippet.clone().unwrap_or_default(),
            thread_id: message.thread_db_id,
            signal: current.is_signal,
            push: staff && current.is_signal,
        });
    }
    notifications
}

fn organization_event(
    link: &Link,
    thread_id: Uuid,
    actor: MacroUserIdStr<'static>,
    action: &crate::domain::models::mailbox_action::MailboxAction,
) -> EmailMacroEvent {
    use crate::domain::models::mailbox_action::MailboxAction;
    let link_id = link.id;
    let owner = link.macro_id.clone();
    let actor = Some(actor);
    let origin = EmailEventOrigin::UserAction;
    match action {
        MailboxAction::Read(value) => EmailMacroEvent::thread_read(ThreadReadMetadata {
            link_id,
            owner,
            actor,
            thread_id,
            is_read: *value,
            origin,
        }),
        MailboxAction::Flagged(value) => EmailMacroEvent::thread_starred(ThreadStarredMetadata {
            link_id,
            owner,
            actor,
            thread_id,
            starred: *value,
            origin,
        }),
        MailboxAction::Archived(value) => {
            EmailMacroEvent::thread_archived(ThreadArchivedMetadata {
                link_id,
                owner,
                actor,
                thread_id,
                archived: *value,
                origin,
            })
        }
        MailboxAction::Trashed(value) => EmailMacroEvent::thread_trashed(ThreadTrashedMetadata {
            link_id,
            owner,
            actor,
            thread_id,
            trashed: *value,
            origin,
        }),
        MailboxAction::Junk(value) => {
            EmailMacroEvent::thread_spam_changed(ThreadSpamChangedMetadata {
                link_id,
                owner,
                actor,
                thread_id,
                spam: *value,
                origin,
            })
        }
        MailboxAction::Category { name, present } => {
            let labels = vec![LabelRef {
                label_id: None,
                provider_label_id: name.clone(),
                name: Some(name.clone()),
            }];
            let (added, removed) = if *present {
                (labels, vec![])
            } else {
                (vec![], labels)
            };
            EmailMacroEvent::thread_labels_updated(ThreadLabelsUpdatedMetadata {
                link_id,
                owner,
                actor,
                thread_id,
                added,
                removed,
                origin,
            })
        }
    }
}
