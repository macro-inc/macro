//! The lists a contact belongs to in a user's directory, and where inbox lists
//! come from.

use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// One list in a user's directory. A person is in the directory when they are
/// in at least one of the owner's lists. The key (`as_ref`, parsed back with
/// `FromStr`) is what storage and clients see.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, strum::AsRefStr, strum::EnumString)]
#[strum(serialize_all = "snake_case")]
pub enum ContactList {
    /// The owner's current team, computed from the roster at read time; never stored.
    Teammates,
    /// Shares a channel with the owner, or has a message in their DM. Mutual and insert-only.
    Interacted,
    /// Invited by the owner through a referral. Owner to contact only.
    Invited,
    /// Known through one of the owner's Gmail inboxes.
    Gmail,
    /// Known through one of the owner's Outlook inboxes.
    Outlook,
}

/// The provider of a connected inbox, which names the list its contacts join.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InboxProvider {
    /// A Gmail inbox.
    Gmail,
    /// An Outlook inbox.
    Outlook,
}

impl From<InboxProvider> for ContactList {
    fn from(provider: InboxProvider) -> Self {
        match provider {
            InboxProvider::Gmail => ContactList::Gmail,
            InboxProvider::Outlook => ContactList::Outlook,
        }
    }
}

/// The connected inbox a set of contacts was found in. Its rows are removed
/// with the inbox, and a contact known through another inbox keeps that one.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct InboxSource {
    /// The inbox owner when the contacts were read: the directory they join.
    pub owner: MacroUserIdStr<'static>,
    /// The inbox's `email_links` id.
    pub link_id: Uuid,
    /// The inbox's provider.
    pub provider: InboxProvider,
}
