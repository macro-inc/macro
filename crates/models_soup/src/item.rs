use crate::calendar_event::SoupCalendarEvent;
use crate::call_record::SoupCallRecord;
use crate::crm_company::SoupCrmCompany;
use crate::document::SoupDocument;
use crate::email_thread::SoupEnrichedEmailThreadPreview;
use crate::foreign_entity::SoupForeignEntity;
use crate::project::SoupProject;
use crate::reminder::SoupReminder;
use crate::{
    chat::SoupChat,
    comms::{SoupChannel, SoupChannelThread},
};
use chrono::{DateTime, Utc};
use model_entity::{Entity, EntityType};
use models_pagination::{Identify, SimpleSortMethod, SortOn};
use models_properties::{EntityReference, EntityType as PropertiesEntityType};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[cfg(test)]
mod test;

/// A single item in the Soup feed.
#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase", tag = "tag", content = "data")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub enum SoupItem<T = ()> {
    /// Document item.
    Document(SoupDocument<T>),
    /// Chat item.
    Chat(SoupChat<T>),
    /// Project item.
    Project(SoupProject<T>),
    /// Email thread item.
    EmailThread(SoupEnrichedEmailThreadPreview<T>),
    /// Channel item.
    Channel(SoupChannel),
    /// Channel thread item.
    ChannelThread(SoupChannelThread),
    /// Call record item.
    Call(SoupCallRecord<T>),
    /// Calendar event item.
    CalendarEvent(SoupCalendarEvent<T>),
    /// CRM company item.
    CrmCompany(SoupCrmCompany<T>),
    /// Foreign entity item.
    ForeignEntity(SoupForeignEntity),
    /// Reminder item.
    Reminder(SoupReminder<T>),
}

impl<T> SoupItem<T> {
    /// return the [Entity] for this soup item
    pub fn entity(&self) -> Entity<'static> {
        match self {
            SoupItem::Document(soup_document) => {
                EntityType::Document.with_entity_string(soup_document.id.to_string())
            }
            SoupItem::Chat(soup_chat) => {
                EntityType::Chat.with_entity_string(soup_chat.id.to_string())
            }
            SoupItem::Project(soup_project) => {
                EntityType::Project.with_entity_string(soup_project.id.to_string())
            }
            SoupItem::EmailThread(email_thread) => {
                EntityType::EmailThread.with_entity_string(email_thread.thread.id.to_string())
            }
            SoupItem::Channel(channel) => {
                EntityType::Channel.with_entity_string(channel.channel.channel.id.0.to_string())
            }
            SoupItem::ChannelThread(thread) => {
                EntityType::ChannelMessage.with_entity_string(thread.id.to_string())
            }
            SoupItem::Call(record) => {
                EntityType::Call.with_entity_string(record.call_id.to_string())
            }
            SoupItem::CalendarEvent(event) => {
                EntityType::CalendarEvent.with_entity_string(event.id.to_string())
            }
            SoupItem::CrmCompany(company) => {
                EntityType::CrmCompany.with_entity_string(company.id.to_string())
            }
            SoupItem::ForeignEntity(foreign_entity) => {
                EntityType::ForeignEntity.with_entity_string(foreign_entity.id.to_string())
            }
            SoupItem::Reminder(reminder) => {
                EntityType::Reminder.with_entity_string(reminder.id.to_string())
            }
        }
    }

    /// Returns the timestamp used as this item's update time.
    pub fn updated_at(&self) -> DateTime<Utc> {
        match self {
            SoupItem::Document(soup_document) => soup_document.updated_at,
            SoupItem::Chat(soup_chat) => soup_chat.updated_at,
            SoupItem::Project(soup_project) => soup_project.updated_at,
            SoupItem::EmailThread(soup_thread) => soup_thread.thread.updated_at,
            SoupItem::Channel(soup_channel) => soup_channel.channel.channel.updated_at,
            SoupItem::ChannelThread(thread) => thread.effective_updated_at(),
            // Calls intentionally lack `updated_at`; recency follows their lifecycle timestamps.
            SoupItem::Call(record) => record.ended_at.unwrap_or(record.started_at),
            SoupItem::CalendarEvent(event) => event.updated_at,
            SoupItem::CrmCompany(company) => company.updated_at,
            SoupItem::ForeignEntity(foreign_entity) => foreign_entity.updated_at,
            SoupItem::Reminder(reminder) => reminder.updated_at,
        }
    }

    fn cursor_timestamp(&self, sort: SimpleSortMethod) -> DateTime<Utc> {
        match (self, sort) {
            (SoupItem::Document(soup_document), SimpleSortMethod::ViewedAt) => {
                soup_document.viewed_at.unwrap_or_default()
            }
            (SoupItem::Document(soup_document), SimpleSortMethod::UpdatedAt) => {
                soup_document.updated_at
            }
            (SoupItem::Document(soup_document), SimpleSortMethod::CreatedAt) => {
                soup_document.created_at
            }
            (SoupItem::Document(soup_document), SimpleSortMethod::ViewedUpdated) => {
                soup_document.viewed_at.unwrap_or(soup_document.updated_at)
            }
            (SoupItem::Chat(soup_chat), SimpleSortMethod::ViewedAt) => {
                soup_chat.viewed_at.unwrap_or_default()
            }
            (SoupItem::Chat(soup_chat), SimpleSortMethod::UpdatedAt) => soup_chat.updated_at,
            (SoupItem::Chat(soup_chat), SimpleSortMethod::CreatedAt) => soup_chat.created_at,
            (SoupItem::Chat(soup_chat), SimpleSortMethod::ViewedUpdated) => {
                soup_chat.viewed_at.unwrap_or(soup_chat.updated_at)
            }
            (SoupItem::Project(soup_project), SimpleSortMethod::ViewedAt) => {
                soup_project.viewed_at.unwrap_or_default()
            }
            (SoupItem::Project(soup_project), SimpleSortMethod::UpdatedAt) => {
                soup_project.updated_at
            }
            (SoupItem::Project(soup_project), SimpleSortMethod::CreatedAt) => {
                soup_project.created_at
            }
            (SoupItem::Project(soup_project), SimpleSortMethod::ViewedUpdated) => {
                soup_project.viewed_at.unwrap_or(soup_project.updated_at)
            }
            (SoupItem::EmailThread(thread), _) => {
                // Always use sort_ts for emails — this is the pre-computed effective_ts
                // from the email SQL query, which is also what the cursor offset logic
                // uses: (effective_ts, id) < (cursor_ts, cursor_id).
                thread.thread.sort_ts
            }
            (SoupItem::Channel(soup_channel), SimpleSortMethod::ViewedAt) => {
                soup_channel.viewed_at.unwrap_or_default()
            }
            (SoupItem::Channel(soup_channel), SimpleSortMethod::UpdatedAt) => {
                soup_channel.channel.channel.updated_at
            }
            (SoupItem::Channel(soup_channel), SimpleSortMethod::CreatedAt) => {
                soup_channel.channel.channel.created_at
            }
            (SoupItem::Channel(soup_channel), SimpleSortMethod::ViewedUpdated) => soup_channel
                .viewed_at
                .unwrap_or(soup_channel.channel.channel.updated_at),
            (SoupItem::ChannelThread(thread), SimpleSortMethod::CreatedAt) => thread.created_at,
            (SoupItem::ChannelThread(thread), _) => thread.effective_updated_at(),
            // Calls intentionally lack `updated_at`; recency follows their lifecycle timestamps.
            (SoupItem::Call(record), SimpleSortMethod::CreatedAt) => record.started_at,
            (SoupItem::Call(record), _) => record.ended_at.unwrap_or(record.started_at),
            (SoupItem::CalendarEvent(event), SimpleSortMethod::CreatedAt) => event.created_at,
            (SoupItem::CalendarEvent(_), SimpleSortMethod::ViewedAt) => DateTime::<Utc>::default(),
            (SoupItem::CalendarEvent(event), _) => event.updated_at,
            (SoupItem::CrmCompany(company), SimpleSortMethod::CreatedAt) => company.created_at,
            (SoupItem::CrmCompany(company), SimpleSortMethod::ViewedAt) => {
                company.viewed_at.unwrap_or_default()
            }
            (SoupItem::CrmCompany(company), SimpleSortMethod::ViewedUpdated) => {
                company.viewed_at.unwrap_or(company.updated_at)
            }
            (SoupItem::CrmCompany(company), _) => company.updated_at,
            (SoupItem::ForeignEntity(foreign_entity), SimpleSortMethod::CreatedAt) => {
                foreign_entity.created_at
            }
            (SoupItem::ForeignEntity(foreign_entity), _) => foreign_entity.updated_at,
            // Reminders always order by when they fire, whatever sort was asked
            // for — the same way emails always use their precomputed sort_ts.
            // No other ordering means anything for a reminder.
            (SoupItem::Reminder(reminder), _) => reminder.next_run_at,
        }
    }

    /// Converts this item to an [`EntityReference`] for property lookups.
    ///
    /// Returns `None` for item types that don't support properties
    /// (e.g., channels, channel threads, foreign entities).
    pub fn to_entity_reference(&self) -> Option<EntityReference> {
        match self {
            SoupItem::Document(doc) => {
                Some(EntityReference::new(doc.id.to_string(), doc.entity_type()))
            }
            SoupItem::Project(p) => Some(EntityReference::new(
                p.id.to_string(),
                PropertiesEntityType::Project,
            )),
            SoupItem::EmailThread(e) => Some(EntityReference::new(
                e.thread.id.to_string(),
                PropertiesEntityType::Thread,
            )),
            SoupItem::Chat(c) => Some(EntityReference::new(
                c.id.to_string(),
                PropertiesEntityType::Chat,
            )),
            SoupItem::Channel(_) => None,
            SoupItem::ChannelThread(_) => None,
            SoupItem::Call(c) => Some(EntityReference::new(
                c.call_id.to_string(),
                PropertiesEntityType::CallRecord,
            )),
            SoupItem::CalendarEvent(event) => Some(EntityReference::new(
                event.id.to_string(),
                PropertiesEntityType::CalendarEvent,
            )),
            SoupItem::CrmCompany(c) => Some(EntityReference::new(
                c.id.to_string(),
                PropertiesEntityType::Company,
            )),
            SoupItem::ForeignEntity(_) => None,
            SoupItem::Reminder(_) => None,
        }
    }

    /// Maps the extra fields attached to property-bearing Soup variants.
    pub fn map_extra<U, F>(self, f: F) -> SoupItem<U>
    where
        F: FnOnce(T) -> U,
    {
        match self {
            SoupItem::Document(SoupDocument {
                id,
                document_version_id,
                owner_id,
                name,
                file_type,
                sha,
                project_id,
                branched_from_id,
                branched_from_version_id,
                document_family_id,
                created_at,
                updated_at,
                viewed_at,
                sub_type,
                deleted_at,
                extra,
            }) => SoupItem::Document(SoupDocument {
                id,
                document_version_id,
                owner_id,
                name,
                file_type,
                sha,
                project_id,
                branched_from_id,
                branched_from_version_id,
                document_family_id,
                created_at,
                updated_at,
                viewed_at,
                sub_type,
                deleted_at,
                extra: f(extra),
            }),
            SoupItem::Chat(SoupChat {
                id,
                name,
                owner_id,
                project_id,
                is_persistent,
                created_at,
                updated_at,
                viewed_at,
                deleted_at,
                extra,
            }) => SoupItem::Chat(SoupChat {
                id,
                name,
                owner_id,
                project_id,
                is_persistent,
                created_at,
                updated_at,
                viewed_at,
                deleted_at,
                extra: f(extra),
            }),
            SoupItem::Project(SoupProject {
                id,
                name,
                owner_id,
                parent_id,
                created_at,
                updated_at,
                viewed_at,
                deleted_at,
                extra,
            }) => SoupItem::Project(SoupProject {
                id,
                name,
                owner_id,
                parent_id,
                created_at,
                updated_at,
                viewed_at,
                deleted_at,
                extra: f(extra),
            }),
            SoupItem::EmailThread(SoupEnrichedEmailThreadPreview {
                thread,
                attachments,
                participants,
                labels,
                extra,
            }) => SoupItem::EmailThread(SoupEnrichedEmailThreadPreview {
                thread,
                attachments,
                participants,
                labels,
                extra: f(extra),
            }),
            SoupItem::Channel(channel) => SoupItem::Channel(channel),
            SoupItem::ChannelThread(soup_channel_thread) => {
                SoupItem::ChannelThread(soup_channel_thread)
            }
            SoupItem::Call(SoupCallRecord {
                call_id,
                channel_id,
                created_by,
                started_at,
                ended_at,
                duration_ms,
                channel_name,
                custom_name,
                summary,
                is_active,
                status,
                attended,
                participants,
                extra,
            }) => SoupItem::Call(SoupCallRecord {
                call_id,
                channel_id,
                created_by,
                started_at,
                ended_at,
                duration_ms,
                channel_name,
                custom_name,
                summary,
                is_active,
                status,
                attended,
                participants,
                extra: f(extra),
            }),
            SoupItem::CalendarEvent(SoupCalendarEvent {
                id,
                owner_id,
                ical_uid,
                title,
                description,
                location,
                status,
                visibility,
                transparency,
                time,
                organizer_email,
                organizer_name,
                conference_url,
                is_read_only,
                created_at,
                updated_at,
                extra,
            }) => SoupItem::CalendarEvent(SoupCalendarEvent {
                id,
                owner_id,
                ical_uid,
                title,
                description,
                location,
                status,
                visibility,
                transparency,
                time,
                organizer_email,
                organizer_name,
                conference_url,
                is_read_only,
                created_at,
                updated_at,
                extra: f(extra),
            }),
            SoupItem::CrmCompany(SoupCrmCompany {
                id,
                team_id,
                name,
                description,
                email_sync,
                hidden,
                created_at,
                updated_at,
                viewed_at,
                domains,
                extra,
            }) => SoupItem::CrmCompany(SoupCrmCompany {
                id,
                team_id,
                name,
                description,
                email_sync,
                hidden,
                created_at,
                updated_at,
                viewed_at,
                domains,
                extra: f(extra),
            }),
            SoupItem::ForeignEntity(soup_foreign_entity) => {
                SoupItem::ForeignEntity(soup_foreign_entity)
            }
            SoupItem::Reminder(SoupReminder {
                id,
                description,
                referenced_entity,
                schedule,
                next_run_at,
                enabled,
                completed_at,
                created_at,
                updated_at,
                extra,
            }) => SoupItem::Reminder(SoupReminder {
                id,
                description,
                referenced_entity,
                schedule,
                next_run_at,
                enabled,
                completed_at,
                created_at,
                updated_at,
                extra: f(extra),
            }),
        }
    }
}

impl<T> Identify for SoupItem<T> {
    type Id = Uuid;

    fn id(&self) -> Self::Id {
        match self {
            SoupItem::Document(soup_document) => soup_document.id,
            SoupItem::Chat(soup_chat) => soup_chat.id,
            SoupItem::Project(soup_project) => soup_project.id,
            SoupItem::EmailThread(thread) => thread.thread.id,
            SoupItem::Channel(soup_channel) => soup_channel.channel.channel.id.0,
            SoupItem::ChannelThread(thread) => thread.id,
            SoupItem::Call(record) => record.call_id,
            SoupItem::CalendarEvent(event) => event.id,
            SoupItem::CrmCompany(company) => company.id,
            SoupItem::ForeignEntity(foreign_entity) => foreign_entity.id,
            SoupItem::Reminder(reminder) => reminder.id,
        }
    }
}

impl<T> SortOn<SimpleSortMethod> for SoupItem<T> {
    fn sort_on(
        sort: SimpleSortMethod,
    ) -> impl FnMut(&Self) -> models_pagination::CursorVal<SimpleSortMethod> {
        move |v| {
            let last_val = v.cursor_timestamp(sort);
            models_pagination::CursorVal {
                sort_type: sort,
                last_val,
            }
        }
    }
}
