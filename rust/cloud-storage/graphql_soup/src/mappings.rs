use std::str::FromStr;

use model_entity::EntityType;
use models_soup::comms::ChannelType;
use notification::domain::models::request::NotificationItemType;

pub(crate) fn property_entity_type_from_key(
    key: &str,
) -> Result<Option<models_properties::EntityType>, rootcause::Report> {
    match key {
        "email" | "email_thread" => Ok(Some(models_properties::EntityType::Thread)),
        "crm_company" => Ok(Some(models_properties::EntityType::Company)),
        "call" | "channel_message" | "channel_thread" | "foreign_entity" | "github" => Ok(None),
        other => models_properties::EntityType::from_str(other)
            .map(Some)
            .map_err(|err| {
                rootcause::report!("invalid entity type {other} for property edge: {err}")
            }),
    }
}

pub(crate) fn notification_item_type_from_key(
    key: &str,
) -> Result<NotificationItemType, rootcause::Report> {
    match key {
        "email" | "email_thread" => Ok(NotificationItemType::Email),
        "message" | "channel_message" => Ok(NotificationItemType::Message),
        "channel" => Ok(NotificationItemType::Channel),
        "document" => Ok(NotificationItemType::Document),
        "project" => Ok(NotificationItemType::Project),
        "chat" => Ok(NotificationItemType::Chat),
        "call" => Ok(NotificationItemType::Call),
        "task" => Ok(NotificationItemType::Task),
        "github" | "foreign_entity" => Ok(NotificationItemType::Github),
        other => Err(rootcause::report!(
            "unsupported notification entity type {other}"
        )),
    }
}

pub(crate) fn notification_item_type_key(item_type: NotificationItemType) -> &'static str {
    match item_type {
        NotificationItemType::Email => "email",
        NotificationItemType::Message => "message",
        NotificationItemType::Channel => "channel",
        NotificationItemType::Document => "document",
        NotificationItemType::Project => "project",
        NotificationItemType::Chat => "chat",
        NotificationItemType::Call => "call",
        NotificationItemType::Task => "task",
        NotificationItemType::Github => "github",
    }
}

pub(crate) fn channel_type_name(channel_type: ChannelType) -> &'static str {
    match channel_type {
        ChannelType::Public => "public",
        ChannelType::Private => "private",
        ChannelType::DirectMessage => "direct_message",
        ChannelType::Team => "team",
    }
}

pub(crate) fn entity_type_name(entity_type: EntityType) -> &'static str {
    match entity_type {
        EntityType::Document => "document",
        EntityType::Chat => "chat",
        EntityType::Project => "project",
        EntityType::EmailThread => "email_thread",
        EntityType::Channel => "channel",
        EntityType::ChannelMessage => "channel_message",
        EntityType::Call => "call",
        EntityType::CrmCompany => "crm_company",
        EntityType::ForeignEntity => "foreign_entity",
        _ => "unknown",
    }
}
