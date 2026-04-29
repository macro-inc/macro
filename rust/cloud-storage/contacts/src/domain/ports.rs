use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;

/// Port trait for accessing the contacts data store.
pub trait ContactsRepository: Send + Sync + 'static {
    /// Gets the list of contact user IDs for a given user.
    fn get_contacts(
        &self,
        user_id: MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Vec<MacroUserIdStr<'static>>, Report>> + Send;

    /// Creates connection pairs between users within a transaction.
    fn create_connections(
        &self,
        connections: Vec<(MacroUserIdStr<'_>, MacroUserIdStr<'_>)>,
    ) -> impl Future<Output = Result<(), Report>> + Send;
}

/// Port trait for notifying users about contact changes.
pub trait ContactsNotifier: Send + Sync + 'static {
    /// Invalidates cached contacts for the given user IDs.
    fn invalidate_contacts_for_users(
        &self,
        user_ids: Vec<MacroUserIdStr<'_>>,
    ) -> impl Future<Output = Result<(), Report>> + Send;
}
