//! Which of a viewer's lists each contact is in.

use crate::domain::models::list::ContactList;
use macro_user_id::user_id::MacroUserIdStr;

/// A contact in the viewer's directory and the viewer's lists it is in.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ListedContact {
    /// The contact.
    pub user_id: MacroUserIdStr<'static>,
    /// The viewer's lists the contact is in, by key, each once. Never empty.
    pub lists: Vec<ContactList>,
}
