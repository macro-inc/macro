//! Reference sharing policy, independent of persistence and transport.

use super::models::ReferencedShareItemType;
use entity_access::domain::models::AccessLevel;

/// Agent control may only be shared by its owner; other references retain
/// the established view-sharing behavior. Mentioning never amplifies a viewer.
pub(crate) fn grant_level(
    item_type: ReferencedShareItemType,
    access: Option<AccessLevel>,
) -> Option<AccessLevel> {
    match (item_type, access) {
        (ReferencedShareItemType::AgentSession, Some(AccessLevel::Owner)) => {
            Some(AccessLevel::Edit)
        }
        (ReferencedShareItemType::AgentSession, _) | (_, None) => None,
        (_, Some(_)) => Some(AccessLevel::View),
    }
}

#[cfg(test)]
mod test;
