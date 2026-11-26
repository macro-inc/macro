//! The inbox a contact is known through, as the contacts crate records it.

use contacts::domain::models::list::{InboxProvider, InboxSource};
use models_email::service::link::{Link, UserProvider};

#[cfg(test)]
pub(crate) mod recording;
#[cfg(test)]
mod test;

/// The contacts list an inbox of this provider fills.
pub fn inbox_provider(provider: UserProvider) -> InboxProvider {
    match provider {
        UserProvider::Gmail => InboxProvider::Gmail,
        UserProvider::Outlook => InboxProvider::Outlook,
    }
}

/// The source of contacts read from `link`: its owner's directory, under this
/// inbox, so the rows go when the inbox is disconnected.
pub fn inbox_source(link: &Link) -> InboxSource {
    InboxSource {
        owner: link.macro_id.clone(),
        link_id: link.id,
        provider: inbox_provider(link.provider),
    }
}
