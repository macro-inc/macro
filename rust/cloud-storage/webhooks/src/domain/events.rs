//! The catalog of events a webhook rule may subscribe to.
//!
//! Each supported event declares:
//! - the set of fields a rule is allowed to filter on (an allow-list, so rules
//!   cannot reference arbitrary payload paths — see `webhooks_plan.md`), and
//! - which of those fields reference an access-controlled **resource** and the
//!   [`EntityType`] that resource maps to.
//!
//! The resource mapping is what lets the service verify, via
//! [`entity_access`](crate::domain::ports), that the requesting user is allowed
//! to see every resource a rule filters on (for example the specific channels a
//! `channel.message.created` rule subscribes to).

use entity_access::domain::models::EntityType;

/// A field on an event that references an access-controlled resource.
#[derive(Debug, Clone, Copy)]
pub struct ResourceField {
    /// The dotted field path (e.g. `data.channel_id`).
    pub field: &'static str,
    /// The entity type the field's value(s) identify.
    pub entity_type: EntityType,
}

/// The schema for a single supported event.
#[derive(Debug, Clone, Copy)]
pub struct EventSchema {
    /// The stable event name (e.g. `channel.message.created`).
    pub name: &'static str,
    /// Fields a rule is permitted to filter on for this event.
    pub allowed_filter_fields: &'static [&'static str],
    /// The subset of `allowed_filter_fields` that reference resources whose
    /// access must be checked against the requesting user.
    pub resource_fields: &'static [ResourceField],
}

impl EventSchema {
    /// The resource entity type for `field`, if this event treats it as a
    /// resource reference.
    pub fn resource_entity_for(&self, field: &str) -> Option<EntityType> {
        self.resource_fields
            .iter()
            .find(|rf| rf.field == field)
            .map(|rf| rf.entity_type)
    }

    /// Whether `field` is allowed as a filter field for this event.
    pub fn allows_field(&self, field: &str) -> bool {
        self.allowed_filter_fields.contains(&field)
    }
}

/// Fields shared by every event envelope; always filterable. Referenced by
/// tests as the baseline allow-list every event is expected to include.
#[cfg(test)]
const ENVELOPE_FIELDS: &[&str] = &[
    "workspace_id",
    "actor.id",
    "actor.type",
    "entity_type",
    "entity_id",
    "ordering_key",
];

/// The V1 event catalog.
///
/// Intentionally small: more events and filter fields are added in a later
/// phase as the event producers come online (see `webhooks_plan.md` Phase 7).
const CATALOG: &[EventSchema] = &[
    EventSchema {
        name: "channel.message.created",
        allowed_filter_fields: &[
            "workspace_id",
            "actor.id",
            "actor.type",
            "entity_type",
            "entity_id",
            "ordering_key",
            "data.channel_id",
            "data.message_id",
        ],
        resource_fields: &[ResourceField {
            field: "data.channel_id",
            entity_type: EntityType::Channel,
        }],
    },
    EventSchema {
        name: "channel.message.updated",
        allowed_filter_fields: &[
            "workspace_id",
            "actor.id",
            "actor.type",
            "entity_type",
            "entity_id",
            "ordering_key",
            "data.channel_id",
            "data.message_id",
        ],
        resource_fields: &[ResourceField {
            field: "data.channel_id",
            entity_type: EntityType::Channel,
        }],
    },
    EventSchema {
        name: "channel.message.deleted",
        allowed_filter_fields: &[
            "workspace_id",
            "actor.id",
            "actor.type",
            "entity_type",
            "entity_id",
            "ordering_key",
            "data.channel_id",
            "data.message_id",
        ],
        resource_fields: &[ResourceField {
            field: "data.channel_id",
            entity_type: EntityType::Channel,
        }],
    },
    EventSchema {
        name: "document.processing.completed",
        allowed_filter_fields: &[
            "workspace_id",
            "actor.id",
            "actor.type",
            "entity_type",
            "entity_id",
            "ordering_key",
            "data.document_id",
        ],
        resource_fields: &[ResourceField {
            field: "data.document_id",
            entity_type: EntityType::Document,
        }],
    },
];

/// Look up the schema for an event name, if it is supported.
pub fn lookup(event_name: &str) -> Option<&'static EventSchema> {
    CATALOG.iter().find(|schema| schema.name == event_name)
}

/// Whether the given event name is in the V1 catalog.
pub fn is_known(event_name: &str) -> bool {
    lookup(event_name).is_some()
}

#[cfg(test)]
mod test;
