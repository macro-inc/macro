//! Blanket response-generation fencing under the shared native owner lock.

use super::{EngineHandle, EngineState, access::AccessGuard};
pub use cache_core::engine::authority::AuthorityTransitionWire;
use cache_core::engine::authority::CacheAuthority;
use uuid::Uuid;

pub(super) type AuthorityListener = dyn Fn(&CacheAuthority) + Send + Sync;

impl EngineHandle {
    /// Notify every attached window when an ordinary command finishes cleanup.
    pub fn with_authority_listener(
        mut self,
        listener: impl Fn(&CacheAuthority) + Send + Sync + 'static,
    ) -> Self {
        self.authority_listener = Some(std::sync::Arc::new(listener));
        self
    }

    pub(super) async fn resume_retirement(&self, state: &mut EngineState) -> Result<(), String> {
        let resumed =
            soup_filter_cache_adapter::permissions::resume_crm_retirement(&mut state.engine)
                .await
                .map_err(|error| error.to_string())?;
        if let Some(result) = resumed
            && let Some(listener) = &self.authority_listener
        {
            listener(&result.authority);
        }
        Ok(())
    }

    /// The source generation is checked only when response content is written.
    /// Omitted generations retain the deployed bundle's legacy IPC contract.
    pub fn with_generation(mut self, generation: Option<Uuid>) -> Self {
        self.generation = generation;
        self
    }

    async fn check_generation(&self, state: &mut EngineState) -> Result<(), String> {
        if state
            .engine
            .snapshot_is_current(self.generation)
            .await
            .map_err(|error| error.to_string())?
        {
            Ok(())
        } else {
            Err("cache response belongs to an older session generation".into())
        }
    }

    pub(super) async fn ready_read(&self) -> Result<AccessGuard<'_, EngineState>, String> {
        let mut state = self.inner.lock().await;
        self.resume_retirement(&mut state).await?;
        Ok(state)
    }

    pub(super) async fn snapshot_write(&self) -> Result<AccessGuard<'_, EngineState>, String> {
        let mut state = self.inner.write().await;
        self.resume_retirement(&mut state).await?;
        self.check_generation(&mut state).await?;
        Ok(state)
    }

    pub(super) async fn snapshot_hydration(&self) -> Result<AccessGuard<'_, EngineState>, String> {
        let mut state = self.inner.hydrate().await?;
        self.resume_retirement(&mut state).await?;
        self.check_generation(&mut state).await?;
        Ok(state)
    }

    /// Capture the owner generation before a request. This is also the native
    /// capability floor; older binaries do not implement this command.
    pub async fn current_authority(&self, identity: &str) -> Result<CacheAuthority, String> {
        self.ready_read()
            .await?
            .engine
            .current_authority(identity)
            .await
            .map_err(|error| error.to_string())
    }

    /// Compare a fresh proof and retire its old snapshots under one owner lock.
    #[tracing::instrument(name = "crm.access.owner.execute", skip_all, err)]
    pub async fn transition_authority(
        &self,
        identity: &str,
        expected: Uuid,
        policy: String,
    ) -> Result<AuthorityTransitionWire, String> {
        let mut state = self.inner.write().await;
        let result = soup_filter_cache_adapter::permissions::transition_crm_authority(
            &mut state.engine,
            identity,
            expected,
            policy,
        )
        .await
        .map_err(|error| error.to_string())?;
        Ok(AuthorityTransitionWire {
            authority: result.authority,
            revision: result.revision.to_string(),
            affected_ops: state.ops.names(result.affected_ops),
            changed: result.changed,
        })
    }
}
