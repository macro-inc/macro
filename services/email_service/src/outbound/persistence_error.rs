//! Preserves legacy operation errors across the email domain boundary.

#[cfg(test)]
mod test;

/// Keep the original error's formatting both for moved logs and inbound response mapping.
#[derive(thiserror::Error)]
#[error(transparent)]
pub struct InboxPersistenceError(#[from] anyhow::Error);

impl std::fmt::Debug for InboxPersistenceError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        std::fmt::Debug::fmt(&self.0, f)
    }
}

impl InboxPersistenceError {
    pub fn into_inner(self) -> anyhow::Error {
        self.0
    }
}
