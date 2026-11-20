//! Which of a viewer's lists each contact is in.

use crate::domain::models::list::ContactList;
use macro_user_id::user_id::MacroUserIdStr;

#[cfg(test)]
mod test;

impl ContactList {
    /// The list a stored key names, or `None` for a key this build does not
    /// know (such as a list added later), which readers skip.
    pub fn from_key(key: &str) -> Option<Self> {
        let list = match key {
            "teammates" => Self::Teammates,
            "interacted" => Self::Interacted,
            "invited" => Self::Invited,
            "gmail" => Self::Gmail,
            "outlook" => Self::Outlook,
            _ => return None,
        };
        Some(list)
    }
}

/// A contact in the viewer's directory and the viewer's lists it is in.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ListedContact {
    /// The contact.
    pub user_id: MacroUserIdStr<'static>,
    /// The viewer's lists the contact is in, by key, each once. Never empty.
    pub lists: Vec<ContactList>,
}
