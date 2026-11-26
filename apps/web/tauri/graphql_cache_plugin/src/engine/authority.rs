//! Blanket response-generation fencing under the shared native owner lock.

use super::{EngineHandle, EngineState, access::AccessGuard};
pub use cache_core::engine::authority::AuthorityTransitionWire;
use cache_core::engine::authority::CacheAuthority;
use uuid::Uuid;

pub(super) type AuthorityListener = dyn Fn(&CacheAuthority) + Send + Sync;

impl EngineHandle {
    /// Notify every window while the same owner lock still orders state changes.
    pub fn with_authority_listener(
        mut self,
        identity: String,
        listener: impl Fn(&CacheAuthority) + Send + Sync + 'static,
    ) -> Self {
        self.authority_listener = Some((identity, std::sync::Arc::new(listener)));
        self
    }

    pub(super) fn publish_bound_generation(
        &self,
        engine: &cache_core::engine::Engine<cache_turso::TursoStorage>,
    ) {
        if let Some((_, listener)) = &self.authority_listener
            && let Some(current) = engine.authority_snapshot()
        {
            if self.generation != Some(current.generation) {
                listener(current);
            }
        }
    }

    pub(super) async fn resume_retirement(&self, state: &mut EngineState) -> Result<(), String> {
        let resumed =
            soup_filter_cache_adapter::permissions::resume_crm_retirement(&mut state.engine)
                .await
                .map_err(|error| error.to_string())?;
        if let Some(result) = resumed
            && let Some((_, listener)) = &self.authority_listener
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

    /// A read on this handle that [`Self::abandon`] names by `request_id`
    /// before it starts reading fails without reading. Without an id it
    /// always reads.
    pub fn abandonable(mut self, request_id: Option<String>) -> Self {
        self.abandon = request_id
            .and_then(|id| self.abandons.register(id))
            .map(std::sync::Arc::new);
        self
    }

    /// Gives up the read registered with `request_id`, and says whether one
    /// was running. Takes no lock the engine holds.
    pub fn abandon(&self, request_id: &str) -> bool {
        self.abandons.abandon(request_id)
    }

    async fn check_generation(&self, state: &mut EngineState) -> Result<(), String> {
        // Prepare legacy callers too, before any response is committed. Identity
        // binding updates this authority in the same durable batch as its witness.
        if let Some((identity, _)) = &self.authority_listener {
            state
                .engine
                .current_authority(identity)
                .await
                .map_err(|error| error.to_string())?;
        }
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
        self.ready_op_read(None).await
    }

    /// [`Self::ready_read`] for a read that registers operation `op_id`'s
    /// dependencies. An abandoned read still waits its turn and finishes an
    /// interrupted retirement, as every read does, so whatever was queued
    /// behind it finds the engine as before; then it gives the engine back
    /// without reading. In place of the dependencies it would have
    /// registered, it registers the operation against every change and drops
    /// its retained view: the next write reports the operation, and the
    /// caller's next watch reads it whole, as it would have had to after a
    /// read it never saw.
    pub(super) async fn ready_op_read(
        &self,
        op_id: Option<&str>,
    ) -> Result<AccessGuard<'_, EngineState>, String> {
        let mut state = self.inner.read().await;
        self.resume_retirement(&mut state).await?;
        if self
            .abandon
            .as_ref()
            .is_some_and(|abandon| abandon.is_abandoned())
        {
            if let Some(op_id) = op_id {
                register_broadly(&mut state, op_id);
            }
            return Err(super::abandon::ABANDONED.into());
        }
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

    /// The checks [`Self::snapshot_hydration`] makes, again, for a hydrate that
    /// gave the engine to reads and found it changed.
    pub(super) async fn recheck_hydration(&self, state: &mut EngineState) -> Result<(), String> {
        self.resume_retirement(state).await?;
        self.check_generation(state).await
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
        if result.changed
            && let Some((_, listener)) = &self.authority_listener
        {
            listener(&result.authority);
        }
        Ok(AuthorityTransitionWire {
            authority: result.authority,
            revision: result.revision.to_string(),
            affected_ops: state.ops.names(result.affected_ops),
            changed: result.changed,
        })
    }
}

/// Registers an operation whose read was abandoned against every change.
fn register_broadly(state: &mut EngineState, op_id: &str) {
    let op = state.ops.intern(op_id);
    state.engine.register_operation_broadly(op);
}
