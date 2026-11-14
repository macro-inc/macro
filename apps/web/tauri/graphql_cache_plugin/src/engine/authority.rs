//! Permission-generation admission under the native owner's existing lock.

use super::{EngineHandle, EngineState, access::AccessGuard};
pub use cache_core::engine::authority::AuthorityAdmission;
pub use cache_core::engine::authority::AuthorityTransitionWire;
use cache_core::engine::authority::CacheAuthority;
use uuid::Uuid;

impl EngineHandle {
    /// Bind admission to this command's cloned handle. Missing fields from an
    /// older frontend never turn into a bypass of permission checks.
    pub fn with_authority(mut self, admission: Option<AuthorityAdmission>) -> Self {
        self.admission = Some(admission.unwrap_or(AuthorityAdmission {
            generation: None,
            require_proof: true,
        }));
        self
    }

    async fn admit(&self, state: &EngineState) -> Result<(), String> {
        if let Some(admission) = &self.admission {
            state
                .engine
                .check_authority_generation(admission.generation, admission.require_proof)
                .await
                .map_err(|error| error.to_string())?;
        }
        Ok(())
    }

    pub(super) async fn admitted_read(&self) -> Result<AccessGuard<'_, EngineState>, String> {
        let state = self.inner.lock().await;
        self.admit(&state).await?;
        Ok(state)
    }

    pub(super) async fn admitted_write(&self) -> Result<AccessGuard<'_, EngineState>, String> {
        let state = self.inner.write().await;
        self.admit(&state).await?;
        Ok(state)
    }

    pub(super) async fn admitted_hydration(&self) -> Result<AccessGuard<'_, EngineState>, String> {
        let state = self.inner.hydrate().await?;
        self.admit(&state).await?;
        Ok(state)
    }

    /// Capture the owner generation before a request. This is also the native
    /// capability floor; older binaries do not implement this command.
    pub async fn current_authority(&self, identity: &str) -> Result<CacheAuthority, String> {
        self.inner
            .lock()
            .await
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
