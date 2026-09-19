use super::*;
use std::sync::atomic::{AtomicUsize, Ordering};

#[derive(Default)]
pub(crate) struct MemoryRepository {
    pub data: Arc<Mutex<BTreeMap<String, ConnectionState>>>,
    /// A positive value fails that numbered future commit once.
    pub fail_commit: Arc<AtomicUsize>,
}
struct Transaction {
    data: tokio::sync::OwnedMutexGuard<BTreeMap<String, ConnectionState>>,
    owner: String,
    state: ConnectionState,
    fail: Arc<AtomicUsize>,
}
#[async_trait::async_trait]
impl GrantRepository for MemoryRepository {
    async fn lock(&self, owner: &str) -> Result<Box<dyn GrantTransaction>> {
        let data = self.data.clone().lock_owned().await;
        let state = data.get(owner).cloned().unwrap_or_default();
        Ok(Box::new(Transaction {
            data,
            owner: owner.to_owned(),
            state,
            fail: self.fail_commit.clone(),
        }))
    }
}
#[async_trait::async_trait]
impl GrantTransaction for Transaction {
    fn state(&mut self) -> &mut ConnectionState {
        &mut self.state
    }
    async fn commit(mut self: Box<Self>) -> Result<()> {
        if self
            .fail
            .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |n| n.checked_sub(1))
            == Ok(1)
        {
            return Err(Error::Credentials);
        }
        let owner = self.owner.clone();
        let state = self.state.clone();
        self.data.insert(owner, state);
        Ok(())
    }
}
