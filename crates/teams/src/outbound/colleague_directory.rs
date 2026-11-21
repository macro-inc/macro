//! [`ColleagueDirectory`] adapter backed by the contacts directory.

use contacts::domain::ports::CorrespondentsService;
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;

use crate::domain::domain_notice::ColleagueDirectory;

/// Reads a user's email correspondents from the contacts crate.
pub struct ContactsColleagueDirectory<S> {
    contacts: S,
}

impl<S> ContactsColleagueDirectory<S> {
    /// Creates the directory over the contacts service.
    pub fn new(contacts: S) -> Self {
        Self { contacts }
    }
}

impl<S: CorrespondentsService> ColleagueDirectory for ContactsColleagueDirectory<S> {
    async fn contacts(
        &self,
        user_id: &MacroUserIdStr<'_>,
    ) -> Result<Vec<MacroUserIdStr<'static>>, Report> {
        self.contacts.correspondents(user_id.clone()).await
    }
}
