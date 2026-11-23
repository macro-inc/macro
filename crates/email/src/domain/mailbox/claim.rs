//! A claim can maintain a bounded window without acquiring provider work.

#[derive(Debug)]
pub enum SyncClaim<T> {
    Acquired(T),
    Progress,
    Idle,
}

impl<T> SyncClaim<T> {
    /// Extract the lease when inspecting a single claim; runners must distinguish
    /// Progress from Idle so maintenance never inserts an idle sleep.
    pub fn into_lease(self) -> Option<T> {
        match self {
            Self::Acquired(lease) => Some(lease),
            Self::Progress | Self::Idle => None,
        }
    }
}
