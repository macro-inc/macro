use crate::notification::send::push::PushNotificationData;
use macro_user_id::email::ReadEmailParts;
use macro_user_id::user_id::MacroUserIdStr;
use mention_utils::parse::{ParsedXmlText, XmlFormatter};
use model::document::{FileType, FileTypeExt};
use model_notifications::NotificationWithRecipient;
use model_notifications::{
    ChannelInviteMetadata, ChannelMentionMetadata, ChannelMessageSendMetadata,
    ChannelReplyMetadata, DocumentMentionMetadata, TaskAssignedMetadata,
};
use sns_client::{APNSPushNotification, Aps};
use std::str::FromStr;
use thiserror::Error;

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

    fn format_group(
        group: &mention_utils::parse::ParsedGroupMention<'_>,
        f: &mut std::fmt::Formatter<'_>,
    ) -> std::fmt::Result {
        write!(f, "@{}", group.group_alias)
    }
}

#[tracing::instrument(err)]
pub fn generate_apns_notification<T: XmlFormatter>(
    notif: &NotificationWithRecipient,
) -> Result<Option<APNSPushNotification<PushNotificationData>>, NotificationErr> {
    let create_push_data = |route: Route| PushNotificationData {
        notification_id: notif.inner.id,
        notification_entity: notif.inner.notification_entity.clone(),
        sender_id: notif.inner.sender_id.as_ref().map(|x| x.to_string()),
        open_route: route.0,
    };

    let parse_user = || -> Result<MacroUserIdStr<'_>, NotificationErr> {
        notif
            .inner
            .sender_id
            .clone()
            .ok_or(NotificationErr::SenderDoesntExist)
    };

    Ok(match &notif.inner.notification_event {
        model_notifications::NotificationEvent::ItemSharedUser(_) => None,
        model_notifications::NotificationEvent::ItemSharedOrganization(_) => None,
        model_notifications::NotificationEvent::ChannelMention(channel_mention_metadata) => Some(
            channel_mention_metadata
                .build_apns_notification::<T>(parse_user()?)?
                .map(|()| {
                    create_push_data(Route(format!(
                        "/channel/{}?channel_message_id={}{}",
                        notif.inner.notification_entity.entity_id,
                        channel_mention_metadata.message_id,
                        format_args!(
                            "{}{}",
                            if channel_mention_metadata.thread_id.is_some() {
                                "&channel_thread_id="
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
                        "/channel/{}?channel_message_id={}",
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
                            "/channel/{}?channel_message_id={}&channel_thread_id={}",
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
        model_notifications::NotificationEvent::TaskAssigned(task_assigned_metadata) => Some(
            task_assigned_metadata
                .build_apns_notification::<T>(parse_user()?)?
                .map(|()| {
                    create_push_data(Route(format!("/task/{}", task_assigned_metadata.task_id)))
                }),
        ),
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
                        model_notifications::ChannelType::DirectMessage => {
                            self.sender.email_part().local_part().to_string()
                        }
                        _ => format!(
                            "{} <{}>",
                            self.sender.email_part().local_part(),
                            self.common.channel_name
                        ),
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
        let title = match self.common.channel_type {
            model_notifications::ChannelType::DirectMessage => {
                format!("{} mentioned you", ctx.email_part().local_part())
            }
            _ => format!(
                "{} mentioned you in #{}",
                ctx.email_part().local_part(),
                &self.common.channel_name
            ),
        };
        Ok(APNSPushNotification {
            aps: Aps {
                alert: Some(sns_client::Alert::Dictionary(sns_client::AlertDictionary {
                    title: Some(title),
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

impl BuildNotification for TaskAssignedMetadata {
    type Ctx<'a> = MacroUserIdStr<'a>;

    fn build_apns_notification<T: XmlFormatter>(
        &self,
        ctx: Self::Ctx<'_>,
    ) -> Result<APNSPushNotification<()>, NotificationErr> {
        let assigner_email = ctx.email_part().email_str().to_string();
        let title = assigner_email;

        let body = if let Some(ref task_name) = self.task_name {
            format!("assigned you to {}", task_name)
        } else {
            "assigned you a task".to_string()
        };

        Ok(APNSPushNotification {
            aps: Aps {
                alert: Some(sns_client::Alert::Dictionary(sns_client::AlertDictionary {
                    title: Some(title),
                    body: Some(body.to_string()),
                    ..Default::default()
                })),
                ..Default::default()
            },
            push_notification_data: (),
        })
    }
}
