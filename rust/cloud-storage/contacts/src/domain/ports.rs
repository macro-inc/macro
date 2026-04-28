use macro_user_id::user_id::MacroUserIdStr;

/// Port trait for accessing the contacts data store.
pub trait ContactsRepository: Send + Sync + 'static {
    /// Gets the list of contact user IDs for a given user.
    fn get_contacts(
        &self,
        user_id: &str,
    ) -> impl Future<Output = Result<Vec<String>, anyhow::Error>> + Send;

    /// Creates connection pairs between users within a transaction.
    fn create_connections(
        &self,
        connections: Vec<(MacroUserIdStr<'static>, MacroUserIdStr<'static>)>,
    ) -> impl Future<Output = Result<(), anyhow::Error>> + Send;
}

/// Port trait for notifying users about contact changes.
pub trait ContactsNotifier: Send + Sync + 'static {
    /// Invalidates cached contacts for the given user IDs.
    fn invalidate_contacts_for_users(
        &self,
        user_ids: &[MacroUserIdStr<'static>],
    ) -> impl Future<Output = anyhow::Result<()>> + Send;
}
