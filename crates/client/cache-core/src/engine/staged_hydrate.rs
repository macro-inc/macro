//! A hydrate computed while it only reads, and written in a short step after.
//!
//! Most of a hydrate's write is reading what it merges into and computing the
//! merge. [`Engine::stage_hydrate`] does that part and writes nothing, so a
//! host can run reads between it and [`Engine::commit_staged_hydrate`], which
//! only writes. A staged hydrate holds while nothing was written: the host
//! checks its storage did not change, and [`Engine::staged_hydrate_current`]
//! checks the engine did not.

use super::*;

/// A hydrate's write, computed from storage as it stood when staged.
pub struct StagedHydrate {
    data: Option<Json>,
    plan: PersistPlan,
    fence: Option<Uuid>,
    identity: Option<String>,
    revision: CacheRevision,
    /// Installing a schema changes neither revision nor storage, so the
    /// staged write also holds only for the schema it was computed with.
    schema: std::sync::Arc<crate::meta::Schema>,
}

impl<S: Storage> Engine<S> {
    /// Reads and computes everything the hydrate would write, and writes
    /// nothing. `Ok(None)` means the hydrate runs whole at commit: it would
    /// bind or switch the account, optimistic layers compose with it, or
    /// admission fails. An error is a storage or document failure the whole
    /// hydrate would meet too; a host should run nothing before the commit,
    /// which then reports it, since a failed read may already have marked
    /// storage for reset. The engine calls of [`Self::hydrate_query_in_scope`] (with
    /// `scope`) or [`Self::hydrate_query_with_projections`] (without) are
    /// what a commit falls back to.
    pub async fn stage_hydrate(
        &mut self,
        write: NetworkWrite<'_>,
        scope: Option<&HydrationScope>,
        projections: &[ProjectionMutation],
    ) -> Result<Option<StagedHydrate>, EngineError<S::Error>> {
        if let Some(scope) = scope
            && (scope.identity.is_empty()
                || write.identity != Some(scope.identity.as_str())
                || self.stored_storage_generation().await? != Some(scope.storage_generation)
                || self
                    .current_identity()
                    .await?
                    .is_some_and(|identity| identity != scope.identity))
        {
            return Ok(None);
        }
        let fence = scope.and_then(|scope| scope.contact_fence);
        if fence.is_some_and(|fence| fence != self.contact_fence) {
            return Ok(None);
        }
        // Checked before any other storage read, as the whole hydrate does,
        // so a request it rejects never reads storage here.
        let data = {
            let doc = Self::document(&mut self.docs, write.query)?;
            let op = doc.operation(write.operation_name)?;
            if op.kind != OperationKind::Query {
                return Ok(None);
            }
            project_hydration_response(&self.schema, &op.prepare(write.variables)?, write.data)?
        };
        self.ensure_revision_can_advance()?;
        self.hydrate_optimistic().await?;
        if !self.optimistic.is_empty() {
            return Ok(None);
        }
        if let Some(observed) = write.identity
            && self.bound_identity().await? != IdentityState::Bound(observed.to_owned())
        {
            return Ok(None);
        }
        let entity_resolvers = EntityResolverLookup::compile(&self.schema, &[])?;
        let doc = Self::document(&mut self.docs, write.query)?;
        let op = doc.operation(write.operation_name)?;
        let normalized = Self::network_records(
            &self.schema,
            self.response_records,
            op,
            NetworkData {
                variables: write.variables,
                data: write.data,
                entity_resolvers: &entity_resolvers,
            },
            false,
            fence.is_some(),
        )?;
        let plan = self.plan_persist(normalized.updates, projections).await?;
        Ok(Some(StagedHydrate {
            data,
            plan,
            fence,
            identity: write.identity.map(str::to_owned),
            revision: self.revision,
            schema: std::sync::Arc::clone(&self.schema),
        }))
    }

    /// Whether nothing the engine holds changed since `staged` was staged.
    /// The host checks storage itself; together they let the staged write
    /// commit as the whole hydrate would have now.
    pub fn staged_hydrate_current(&self, staged: &StagedHydrate) -> bool {
        self.revision == staged.revision
            && std::sync::Arc::ptr_eq(&self.schema, &staged.schema)
            && self.optimistic_hydrated
            && self.optimistic.is_empty()
            && staged.fence.is_none_or(|fence| fence == self.contact_fence)
            && staged.identity.as_ref().is_none_or(|observed| {
                matches!(&self.identity, IdentityState::Bound(bound) if bound == observed)
            })
            && self.revision.checked_successor().is_some()
    }

    /// Writes a staged hydrate with the same `projections` it was staged
    /// with. Call it only while [`Self::staged_hydrate_current`] holds and
    /// storage is as it was when staged.
    pub async fn commit_staged_hydrate(
        &mut self,
        staged: StagedHydrate,
        projections: Vec<ProjectionMutation>,
    ) -> Result<HydrationWriteResult, EngineError<S::Error>> {
        debug_assert!(self.staged_hydrate_current(&staged));
        let StagedHydrate {
            data, plan, fence, ..
        } = staged;
        let PersistedChanges {
            field_changes,
            changed,
            revision,
            revision_advanced,
            search_changed_buckets,
            viewer_fields,
        } = self.apply_persist(plan, projections).await?;
        let affected_ops = self.deps.ops_for_changes(&changed, &viewer_fields);
        if fence.is_some() {
            self.contact_fence = Uuid::now_v7();
        }
        Ok(HydrationWriteResult {
            write_result: WriteResult {
                field_changes: Some(field_changes),
                identity_errors: Vec::new(),
                mutation_uuid: None,
                revision,
                revision_advanced,
                search_changed_buckets: Some(search_changed_buckets.clone()),
                changed,
                affected_ops,
                reset: false,
                revalidations: Vec::new(),
            },
            search_changed_buckets,
            data,
        })
    }
}
