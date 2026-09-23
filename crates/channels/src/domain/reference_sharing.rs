//! Reference sharing policy, independent of persistence and transport.

use super::models::ReferencedShareItemType;
use entity_access::domain::models::AccessLevel;

/// Only owners may share session references, and automatic sharing grants view
/// access. Sending a reference never grants control of an agent session.
///
/// A calendar event is shareable only by someone holding it on their own
/// calendar: its owner or a linked account. A member who sees the event only
/// through an earlier channel share holds view access and cannot pass it on.
pub(crate) fn grant_level(
    item_type: ReferencedShareItemType,
    access: Option<AccessLevel>,
) -> Option<AccessLevel> {
    match (item_type, access) {
        (ReferencedShareItemType::AgentSession, Some(AccessLevel::Owner)) => {
            Some(AccessLevel::View)
        }
        (ReferencedShareItemType::CalendarEvent, Some(level)) if level >= AccessLevel::Edit => {
            Some(AccessLevel::View)
        }
        (ReferencedShareItemType::AgentSession | ReferencedShareItemType::CalendarEvent, _)
        | (_, None) => None,
        (_, Some(_)) => Some(AccessLevel::View),
    }
}

#[cfg(test)]
mod test;
