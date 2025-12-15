use crate::notification::send::push::PushNotificationData;
use macro_user_id::email::ReadEmailParts;
use macro_user_id::user_id::MacroUserIdStr;
use mention_utils::parse::{ParsedXmlText, XmlFormatter};
use model::document::{FileType, FileTypeExt};
use model_notifications::NotificationWithRecipient;
use model_notifications::{
    ChannelInviteMetadata, ChannelMentionMetadata, ChannelMessageSendMetadata,
    ChannelReplyMetadata, DocumentMentionMetadata,
};
use models_comms::ChannelType;
use sns_client::{APNSPushNotification, Aps};
use std::str::FromStr;
use thiserror::Error;

/// Given a notification, this generates a push notification object
/// Returns (message_json, message_attributes) if the notification is valid
/// Returns Err if the notification is invalid
/// NOTE: @synoet - I think push notifications should be generated using the new
/// [NotificationEvnet] type instead of the [NotificationWithRecipient] type
/// Simmilarly, each of these should implement some sort of PushDisplay trait
// pub fn generate_push_notification(notification: &NotificationWithRecipient) {
//     let (title, message, open_route): (String, String, String) = match notification
//         .inner
//         .notification_event
//         .event_type()
//     {
//         NotificationEventType::ChannelInvite => {
//             let metadata = if let Some(metadata) = notification
//                 .inner
//                 .notification_event
//                 .metadata_json()
//                 .as_ref()
//             {
//                 metadata.clone()
//             } else {
//                 return Err(anyhow::anyhow!("notification does not have metadata"));
//             };
//             let metadata: ChannelInviteMetadata = serde_json::from_value(metadata.clone())?;

//             let title = format!(
//                 "{} invited you to join {}",
//                 metadata.invited_by, metadata.common.channel_name
//             );

//             let open_route = format!(
//                 "/channel/{}",
//                 notification.inner.notification_entity.entity_id
//             );

//             (title, "".to_string(), open_route)
//         }
//         NotificationEventType::ChannelMessageSend => {
//             let metadata = if let Some(metadata) = notification
//                 .inner
//                 .notification_event
//                 .metadata_json()
//                 .as_ref()
//             {
//                 metadata.clone()
//             } else {
//                 return Err(anyhow::anyhow!("notification does not have metadata"));
//             };
//             let metadata: ChannelMessageSendMetadata = serde_json::from_value(metadata.clone())?;
//             let message: String = metadata.message_content;
//             let email = notification
//                 .inner
//                 .sender_id
//                 .clone()
//                 .context("expected sender id")?
//                 .replace("macro|", "");

//             let message_item = if message.is_empty() {
//                 "an attachment"
//             } else {
//                 "a message"
//             };

//             let channel_name = metadata.common.channel_name;

//             let title = match metadata.common.channel_type {
//                 ChannelType::DirectMessage => {
//                     format!("{} sent you {}", email, message_item)
//                 }
//                 _ => {
//                     format!("{} sent {} to #{}", email, message_item, channel_name)
//                 }
//             };

//             let message_id = format!("?message_id={}", metadata.message_id);

//             let open_route = format!(
//                 "/channel/{}{}",
//                 notification.inner.notification_entity.entity_id, message_id
//             );

//             (title, message, open_route)
//         }
//         NotificationEventType::ChannelMessageReply => {
//             let metadata = if let Some(metadata) = notification
//                 .inner
//                 .notification_event
//                 .metadata_json()
//                 .as_ref()
//             {
//                 metadata.clone()
//             } else {
//                 return Err(anyhow::anyhow!("notification does not have metadata"));
//             };
//             let metadata: ChannelReplyMetadata = serde_json::from_value(metadata.clone())?;
//             let message = metadata.message_content;

//             let email = notification
//                 .inner
//                 .sender_id
//                 .clone()
//                 .context("expected sender id")?
//                 .replace("macro|", "");

//             let title = format!("{} replied to thread", email);
//             let open_route = format!(
//                 "/channel/{}?message_id={}&thread_id={}",
//                 notification.inner.notification_entity.entity_id,
//                 metadata.message_id,
//                 metadata.thread_id
//             );

//             (title, message, open_route)
//         }
//         NotificationEventType::ChannelMention => {
//             let channel_metadata = if let Some(channel_metadata) =
//                 &notification.inner.notification_event.metadata_json()
//             {
//                 channel_metadata.clone()
//             } else {
//                 return Err(anyhow::anyhow!("no channel metadata was provided"));
//             };

//             let metadata: ChannelMentionMetadata = serde_json::from_value(channel_metadata)?;

//             let email = notification
//                 .inner
//                 .sender_id
//                 .clone()
//                 .context("expected sender id")?
//                 .replace("macro|", "");

//             let message = metadata.message_content;

//             let title = format!(
//                 "{} mentioned you in #{}",
//                 email, metadata.common.channel_name
//             );

//             let thread_id = if let Some(thread_id) = metadata.thread_id {
//                 format!("&thread_id={}", thread_id)
//             } else {
//                 "".to_string()
//             };

//             let open_route = format!(
//                 "/channel/{}?message_id={}{}",
//                 notification.inner.notification_entity.entity_id, metadata.message_id, thread_id
//             );

//             (title, message, open_route)
//         }
//         NotificationEventType::DocumentMention => {
//             let document_metadata = if let Some(document_metadata) =
//                 &notification.inner.notification_event.metadata_json()
//             {
//                 document_metadata.clone()
//             } else {
//                 return Err(anyhow::anyhow!("no document metadata was provided"));
//             };

//             let metadata: DocumentMentionMetadata = serde_json::from_value(document_metadata)?;

//             let sender_id = notification
//                 .inner
//                 .sender_id
//                 .as_ref()
//                 .context("expected sender id")?;

//             if let Some(file_type) = metadata.file_type {
//                 let email = sender_id.replace("macro|", "");
//                 let message = format!(
//                     "{} mentioned you in {}.{}",
//                     email, metadata.document_name, file_type
//                 );
//                 let file_type = FileType::from_str(file_type.as_str())?;

//                 let block_route = if file_type.is_image() {
//                     "image"
//                 } else {
//                     match file_type {
//                         FileType::Pdf => "pdf",
//                         FileType::Docx => "write",
//                         FileType::Md => "md",
//                         _ => "code", // Default to code block
//                     }
//                 };

//                 let open_route = format!(
//                     "/{}/{}",
//                     block_route, notification.inner.notification_entity.entity_id
//                 );

//                 ("New Mention".to_string(), message, open_route)
//             } else {
//                 return Err(anyhow::anyhow!("no file type was provided"));
//             }
//         }
//         // no push notifs for email yet

//         // NotificationEventType::NewEmail => {
//         //     let metadata = if let Some(metadata) = notification.inner.notification_event.metadata_as_json().as_ref() {
//         //         metadata.clone()
//         //     } else {
//         //         return Err(anyhow::anyhow!("notification does not have metadata"));
//         //     };
//         //     let metadata: NewEmailMetadata = serde_json::from_value(metadata)?;
//         //
//         //     let title = if let Some(from_email) = metadata.sender {
//         //         format!("New email from {}", from_email)
//         //     } else {
//         //         "New email".to_string()
//         //     };
//         //     let message = metadata.subject;
//         //     let open_route = format!(
//         //         "/email/{}?message_id={}",
//         //         metadata.thread_id, notification.inner.notification_entity.event_item_id
//         //     );
//         //
//         //     (title, message, open_route)
//         // }
//         _ => return Ok(None), // unsupported push notification
//     };

//     tracing::trace!(message=?message, "created message");

//     let collapse_key = format!(
//         "{}{}",
//         notification.inner.notification_entity.entity_id,
//         notification.inner.notification_event.event_type()
//     );

//     // hash the collapse key to shorten it
//     let mut hasher = DefaultHasher::new();
//     collapse_key.hash(&mut hasher);
//     let hash = hasher.finish();
//     let collapse_key = format!("{:x}", hash);

//     let push_notification_data = PushNotificationData {
//         notification_entity: notification.inner.notification_entity.clone(),
//         sender_id: notification.inner.sender_id.clone(),
//         open_route: open_route.clone(),
//     };

//     let notification_body = serde_json::json!({
//         "title": title,
//         "body": message,
//     });

//     let apns = APNSPushNotification {
//         aps: Aps {
//             alert: Some(sns_client::Alert::Dictionary(sns_client::AlertDictionary {
//                 title: Some(title),
//                 body: Some(message),
//                 ..Default::default()
//             })),
//             ..Default::default()
//         },
//         push_notification_data: push_notification_data.clone(),
//     };

//     let message_json = serde_json::json!({
//         "default": serde_json::json!({
//             "notification": notification_body
//         }).to_string(),
//         "APNS": serde_json::to_string(&apns).unwrap_or_else(|_| serde_json::json!({
//             "aps": apns.aps
//         }).to_string()),
//         "GCM": serde_json::json!({
//             "fcmV1Message": {
//                 "message": {
//                     "android": {
//                         "notification": notification_body,
//                         "priority": "normal", // options are normal and high
//                         "collapse_key": collapse_key.clone()
//                     },
//                     "data": push_notification_data,
//                 },
//             }
//         }).to_string()
//     });

//     Ok(Some((
//         SnsPayload {
//             default: todo!(),
//             apns: todo!(),
//             apns_sandbox: todo!(),
//             gcm: todo!(),
//         },
//         // build_message_attributes(&collapse_key),
//     )))
// }

#[derive(Debug, Error)]
pub enum NotificationErr {
    #[error("The sender_id field was None for a notification which must have a sender")]
    SenderDoesntExist,
    #[error("File type did not exist for a notification expecting a file type")]
    FileTypeDoesntExist,
    #[error(transparent)]
    InvalidFileType(#[from] model_file_type::ValueError<FileType>),
    #[error(transparent)]
    UserId(#[from] macro_user_id::error::ParseErr),
    #[error(transparent)]
    XmlErr(#[from] mention_utils::parse::ParseErr),
}

pub struct PlainTextFormatter;

impl XmlFormatter for PlainTextFormatter {
    fn format_plain_text(s: &str, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", s)
    }

    fn format_link(
        link: &mention_utils::parse::ParsedLink<'_>,
        f: &mut std::fmt::Formatter<'_>,
    ) -> std::fmt::Result {
        write!(f, "{}", link.text)
    }

    fn format_doc(
        doc: &mention_utils::parse::ParsedDocumentMention<'_>,
        f: &mut std::fmt::Formatter<'_>,
    ) -> std::fmt::Result {
        write!(f, "{}", doc.document_name)
    }

    fn format_user(
        user: &mention_utils::parse::ParsedUserMention<'_>,
        f: &mut std::fmt::Formatter<'_>,
    ) -> std::fmt::Result {
        write!(f, "{}", user.user_id.0.email_part().email_str())
    }

    fn format_contact(
        contact: &mention_utils::parse::ParsedContactMention<'_>,
        f: &mut std::fmt::Formatter<'_>,
    ) -> std::fmt::Result {
        write!(f, "{}", contact.name)
    }

    fn format_date(
        date: &mention_utils::parse::ParsedDateMention<'_>,
        f: &mut std::fmt::Formatter<'_>,
    ) -> std::fmt::Result {
        write!(f, "{}", date.display_format)
    }
}

pub fn generate_apns_notification<T: XmlFormatter>(
    notif: &NotificationWithRecipient,
) -> Result<Option<APNSPushNotification<PushNotificationData>>, NotificationErr> {
    let create_push_data = |route: Route| PushNotificationData {
        notification_entity: notif.inner.notification_entity.clone(),
        sender_id: notif.inner.sender_id.clone(),
        open_route: route.0,
    };

    let parse_user = || -> Result<MacroUserIdStr<'_>, NotificationErr> {
        Ok(MacroUserIdStr::parse_from_str(
            notif
                .inner
                .sender_id
                .as_ref()
                .ok_or(NotificationErr::SenderDoesntExist)?,
        )?)
    };

    Ok(match &notif.inner.notification_event {
        model_notifications::NotificationEvent::ItemSharedUser(_) => None,
        model_notifications::NotificationEvent::ItemSharedOrganization(_) => None,
        model_notifications::NotificationEvent::ChannelMention(channel_mention_metadata) => Some(
            channel_mention_metadata
                .build_apns_notification::<T>(parse_user()?)?
                .map(|()| {
                    create_push_data(Route(format!(
                        "/channel/{}?message_id={}{}",
                        notif.inner.notification_entity.entity_id,
                        channel_mention_metadata.message_id,
                        format_args!(
                            "{}{}",
                            if channel_mention_metadata.thread_id.is_some() {
                                "&thread_id="
                            } else {
                                ""
                            },
                            channel_mention_metadata.thread_id.as_deref().unwrap_or("")
                        )
                    )))
                }),
        ),
        model_notifications::NotificationEvent::DocumentMention(document_mention_metadata) => {
            let file_type_str = document_mention_metadata
                .file_type
                .as_ref()
                .ok_or(NotificationErr::FileTypeDoesntExist)?;
            let file_type = FileType::from_str(file_type_str)?;

            let block_route = match file_type {
                x if x.is_image() => "image",
                FileType::Pdf => "pdf",
                FileType::Docx => "write",
                FileType::Md => "md",
                _ => "code",
            };

            let open_route = format!(
                "/{}/{}",
                block_route, notif.inner.notification_entity.entity_id
            );

            Some(
                document_mention_metadata
                    .build_apns_notification::<T>(parse_user()?)?
                    .map(|()| create_push_data(Route(open_route))),
            )
        }
        model_notifications::NotificationEvent::ChannelInvite(channel_invite_metadata) => Some(
            channel_invite_metadata
                .build_apns_notification::<T>(())?
                .map(|()| {
                    create_push_data(Route(format!(
                        "/channel/{}",
                        notif.inner.notification_entity.entity_id
                    )))
                }),
        ),
        model_notifications::NotificationEvent::ChannelMessageSend(
            channel_message_send_metadata,
        ) => Some(
            channel_message_send_metadata
                .build_apns_notification::<T>(())?
                .map(|()| {
                    create_push_data(Route(format!(
                        "/channel/{}?message_id={}",
                        notif.inner.notification_entity.entity_id,
                        channel_message_send_metadata.message_id
                    )))
                }),
        ),
        model_notifications::NotificationEvent::ChannelMessageReply(channel_reply_metadata) => {
            Some(
                channel_reply_metadata
                    .build_apns_notification::<T>(parse_user()?)?
                    .map(|()| {
                        create_push_data(Route(format!(
                            "/channel/{}?message_id={}&thread_id={}",
                            notif.inner.notification_entity.entity_id,
                            channel_reply_metadata.message_id,
                            channel_reply_metadata.thread_id
                        )))
                    }),
            )
        }
        model_notifications::NotificationEvent::ChannelMessageDocument(
            _document_mention_metadata,
        ) => None,
        model_notifications::NotificationEvent::NewEmail(_new_email_metadata) => None,
        model_notifications::NotificationEvent::InviteToTeam(_invite_to_team_metadata) => None,
        model_notifications::NotificationEvent::RejectTeamInvite => None,
    })
}

trait BuildNotification {
    type Ctx<'a>;
    fn build_apns_notification<T: XmlFormatter>(
        &self,
        ctx: Self::Ctx<'_>,
    ) -> Result<APNSPushNotification<()>, NotificationErr>;
}

/// the route the notification should navigate to on click
struct Route(String);

impl BuildNotification for ChannelMessageSendMetadata {
    type Ctx<'a> = ();
    fn build_apns_notification<T: XmlFormatter>(
        &self,
        _ctx: Self::Ctx<'_>,
    ) -> Result<APNSPushNotification<()>, NotificationErr> {
        Ok(APNSPushNotification {
            aps: Aps {
                alert: Some(sns_client::Alert::Dictionary(sns_client::AlertDictionary {
                    title: Some(match self.common.channel_type {
                        ChannelType::DirectMessage => self.common.channel_name.to_string(),
                        _ => format!("{} <{}>", self.sender, self.common.channel_name),
                    }),
                    body: Some(T::format_xml_text(ParsedXmlText::parse(&self.message_content)?).0),
                    ..Default::default()
                })),
                ..Default::default()
            },
            push_notification_data: (),
        })
    }
}

impl BuildNotification for ChannelMentionMetadata {
    type Ctx<'a> = MacroUserIdStr<'a>;
    fn build_apns_notification<T: XmlFormatter>(
        &self,
        ctx: Self::Ctx<'_>,
    ) -> Result<APNSPushNotification<()>, NotificationErr> {
        Ok(APNSPushNotification {
            aps: Aps {
                alert: Some(sns_client::Alert::Dictionary(sns_client::AlertDictionary {
                    title: Some(format!(
                        "{} mentioned you in #{}",
                        ctx.email_part().as_ref(),
                        &self.common.channel_name
                    )),
                    body: Some(T::format_xml_text(ParsedXmlText::parse(&self.message_content)?).0),
                    ..Default::default()
                })),
                ..Default::default()
            },
            push_notification_data: (),
        })
    }
}

impl BuildNotification for DocumentMentionMetadata {
    type Ctx<'a> = MacroUserIdStr<'a>;
    fn build_apns_notification<T: XmlFormatter>(
        &self,
        ctx: Self::Ctx<'_>,
    ) -> Result<APNSPushNotification<()>, NotificationErr> {
        Ok(APNSPushNotification {
            aps: Aps {
                alert: Some(sns_client::Alert::Dictionary(sns_client::AlertDictionary {
                    title: Some(ctx.0.email_part().email_str().to_string()),
                    body: Some(format!(
                        "You were mentioned in {}.{}",
                        self.document_name,
                        self.file_type
                            .as_ref()
                            .ok_or(NotificationErr::FileTypeDoesntExist)?
                    )),
                    ..Default::default()
                })),
                ..Default::default()
            },
            push_notification_data: (),
        })
    }
}

impl BuildNotification for ChannelReplyMetadata {
    type Ctx<'a> = MacroUserIdStr<'a>;

    fn build_apns_notification<T: XmlFormatter>(
        &self,
        ctx: Self::Ctx<'_>,
    ) -> Result<APNSPushNotification<()>, NotificationErr> {
        Ok(APNSPushNotification {
            aps: Aps {
                alert: Some(sns_client::Alert::Dictionary(sns_client::AlertDictionary {
                    title: Some(format!("{} Replied", ctx.0.email_part().email_str())),
                    body: Some(T::format_xml_text(ParsedXmlText::parse(&self.message_content)?).0),
                    ..Default::default()
                })),
                ..Default::default()
            },
            push_notification_data: (),
        })
    }
}

impl BuildNotification for ChannelInviteMetadata {
    type Ctx<'a> = ();

    fn build_apns_notification<T: XmlFormatter>(
        &self,
        _ctx: Self::Ctx<'_>,
    ) -> Result<APNSPushNotification<()>, NotificationErr> {
        Ok(APNSPushNotification {
            aps: Aps {
                alert: Some(sns_client::Alert::Dictionary(sns_client::AlertDictionary {
                    title: Some(format!("{} Invite", self.common.channel_name)),
                    body: Some(format!(
                        "{} invited you to join the channel",
                        self.invited_by
                    )),
                    ..Default::default()
                })),
                ..Default::default()
            },
            push_notification_data: (),
        })
    }
}
