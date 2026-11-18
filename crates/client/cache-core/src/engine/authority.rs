//! Durable permission generations shared by all clients of one cache owner.
//!
//! Hosts hold their existing engine lock across admission and execution. Policy
//! values are opaque here; the application obtains them from its server.

use super::*;
use crate::value::CacheValue;

const AUTHORITY_KEY: &str = "__meta:authority";
const AUTHORITY_FIELD: &str = "state";
#[cfg(test)]
const RETIREMENT_PAGE_SIZE: usize = 500;

#[cfg(test)]
mod test;

/// The permission scope attached to cached response content, independently of
/// storage lifetime and the durable mutation queue.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[cfg_attr(any(test, feature = "schema"), derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CacheAuthority {
    /// Anonymous physical cache profile, independent of the signed-in account.
    pub identity: String,
    /// Account witness bound inside that profile when this generation began.
    pub account: Option<String>,
    /// Capture before acquiring source data; never relabel an older response.
    pub generation: Uuid,
    /// Server-defined policy value; absent before the first permission proof.
    pub policy: Option<String>,
    /// False until all protected snapshots have been retired durably.
    pub ready: bool,
}

/// Captured permission scope for one cache operation.
#[derive(Clone, Debug, serde::Deserialize, serde::Serialize)]
#[cfg_attr(any(test, feature = "schema"), derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuthorityAdmission {
    /// Missing generations never authorize content from an older client.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub generation: Option<Uuid>,
    /// Unrelated offline work can proceed before the first server proof.
    pub require_proof: bool,
}

/// Shared browser/native transport for a completed permission transition.
#[derive(Debug, serde::Serialize)]
#[cfg_attr(any(test, feature = "schema"), derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuthorityTransitionWire {
    /// Current durable permission scope.
    pub authority: CacheAuthority,
    /// Effective cache revision after retirement.
    pub revision: String,
    /// Host operation names whose previous results must be discarded.
    pub affected_ops: Vec<String>,
    /// Whether the authority changed or incomplete retirement resumed.
    pub changed: bool,
}

/// Source-of-truth schemas for browser/native permission transport.
#[cfg(any(test, feature = "schema"))]
pub fn transport_schemas() -> serde_json::Value {
    serde_json::json!({"schemas": {
        "CacheAuthority": schemars::schema_for!(CacheAuthority),
        "AuthorityAdmission": schemars::schema_for!(AuthorityAdmission),
        "AuthorityTransition": schemars::schema_for!(AuthorityTransitionWire),
    }})
}

impl AuthorityAdmission {
    /// A protected operation always requires completed permission retirement.
    pub fn protected(generation: Option<Uuid>) -> Self {
        Self {
            generation,
            require_proof: true,
        }
    }
}

/// A completed transition also invalidates every retained incremental view.
#[derive(Debug)]
pub struct AuthorityTransition {
    /// The new scope, or the unchanged scope for an equivalent current proof.
    pub authority: CacheAuthority,
    /// Effective cache revision after retirement.
    pub revision: CacheRevision,
    /// Active reads that must discard their previously delivered snapshots.
    pub affected_ops: BTreeSet<OpId>,
    /// Whether this proof changed policy or resumed incomplete retirement.
    pub changed: bool,
}

/// Derived optimistic state that must share the response's permission scope.
#[derive(Default)]
pub struct OptimisticEffects {
    /// Predicate/projection shadows derived from the optimistic response.
    pub projections: Vec<OptimisticProjectionMutation>,
    /// Calendar occurrences invalidated by that response's optimistic changes.
    pub uncertain_calendar_event_keys: Vec<EntityKey<'static>>,
}

impl<S: Storage> Engine<S> {
    async fn stored_authority(&self) -> Result<Option<CacheAuthority>, EngineError<S::Error>> {
        if let Some(authority) = self.authority.get() {
            return Ok(authority.clone());
        }
        let rows = self
            .storage
            .get_batch(&[EntityKey(AUTHORITY_KEY.into())])
            .await
            .map_err(EngineError::Storage)?;
        let authority = rows.into_iter().next().flatten().and_then(|record| {
            match record.fields.get(AUTHORITY_FIELD) {
                Some(CacheValue::Opaque(value)) => serde_json::from_str(value).ok(),
                _ => None,
            }
        });
        let _ = self.authority.set(authority.clone());
        Ok(authority)
    }

    async fn store_authority(
        &mut self,
        authority: &CacheAuthority,
    ) -> Result<(), EngineError<S::Error>> {
        let value = serde_json::json!({
            "identity": authority.identity,
            "account": authority.account,
            "generation": authority.generation,
            "policy": authority.policy,
            "ready": authority.ready,
        });
        let record = Record {
            fields: [(AUTHORITY_FIELD.into(), CacheValue::opaque(&value))].into(),
        };
        self.storage
            .put_batch(vec![(EntityKey(AUTHORITY_KEY.into()), record)])
            .await
            .map_err(EngineError::Storage)?;
        self.authority = std::sync::OnceLock::from(Some(authority.clone()));
        Ok(())
    }

    /// Capture the shared generation before requesting permission or content.
    /// An unknown scope does not authorize protected reads. This does not bind
    /// another account or clear any records, drafts, or queued commands.
    pub async fn current_authority(
        &mut self,
        identity: &str,
    ) -> Result<CacheAuthority, EngineError<S::Error>> {
        if identity.is_empty() {
            return Err(EngineError::StaleAuthority);
        }
        let account = self.current_identity().await?;
        if let Some(authority) = self.stored_authority().await? {
            if authority.identity != identity {
                return Err(EngineError::StaleAuthority);
            }
            if authority.account == account {
                return Ok(authority);
            }
        }
        let authority = CacheAuthority {
            identity: identity.to_owned(),
            account,
            generation: Uuid::now_v7(),
            policy: None,
            ready: false,
        };
        self.store_authority(&authority).await?;
        Ok(authority)
    }

    /// Check immediately before reading or installing protected content, under
    /// the same owner lock as the operation. A missing token never admits data.
    #[cfg(test)]
    async fn check_authority(&self, generation: Option<Uuid>) -> Result<(), EngineError<S::Error>> {
        self.check_authority_generation(generation, true).await
    }

    /// Admit an operation in the captured generation. Unrelated offline reads
    /// may use an unknown policy; protected reads require a completed proof.
    pub async fn check_authority_generation(
        &self,
        generation: Option<Uuid>,
        require_proof: bool,
    ) -> Result<(), EngineError<S::Error>> {
        match self.stored_authority().await? {
            Some(authority)
                if (!require_proof || authority.ready)
                    && self.authority_matches_account(&authority)
                    && Some(authority.generation) == generation =>
            {
                Ok(())
            }
            _ => Err(EngineError::StaleAuthority),
        }
    }

    fn authority_matches_account(&self, authority: &CacheAuthority) -> bool {
        match &self.identity {
            IdentityState::NotHydrated => false,
            IdentityState::Missing => authority.account.is_none(),
            IdentityState::Bound(account) => authority.account.as_ref() == Some(account),
        }
    }

    async fn can_publish_authority(
        &self,
        admission: &AuthorityAdmission,
    ) -> Result<bool, EngineError<S::Error>> {
        match self
            .check_authority_generation(admission.generation, admission.require_proof)
            .await
        {
            Ok(()) => Ok(true),
            Err(EngineError::StaleAuthority) => Ok(false),
            Err(error) => Err(error),
        }
    }

    /// Keep an authored command from an older window without letting its copied
    /// response, link recipes, or projection shadows restore retired content.
    pub async fn enqueue_optimistic_mutation_in_authority(
        &mut self,
        origin_op: Option<OpId>,
        input: BeginOptimisticWrite<'_>,
        claim: MutationClaimRequest,
        mut effects: OptimisticEffects,
        admission: AuthorityAdmission,
    ) -> Result<EnqueueOptimisticMutationResult<EngineError<S::Error>>, EngineError<S::Error>> {
        let accepted = self.can_publish_authority(&admission).await?;
        let empty = Json::Object(Default::default());
        let input = BeginOptimisticWrite {
            data: if accepted { input.data } else { &empty },
            link_patches: if accepted { input.link_patches } else { &[] },
            revalidations: if accepted { input.revalidations } else { &[] },
            ..input
        };
        if !accepted {
            effects.projections.clear();
            effects.uncertain_calendar_event_keys.clear();
        }
        self.enqueue_optimistic_mutation_with_calendar(
            origin_op,
            input,
            claim,
            effects.projections,
            effects.uncertain_calendar_event_keys,
        )
        .await
    }

    /// Settle a successful server command even if permission changed while its
    /// response was pending. Stale content is discarded; canonical identities
    /// and queue settlement remain atomic and durable.
    pub async fn commit_optimistic_write_in_authority(
        &mut self,
        transaction: OptimisticTransactionId,
        claim: MutationClaimToken,
        response: NetworkWrite<'_>,
        projections: Vec<ProjectionMutation>,
        admission: AuthorityAdmission,
    ) -> Result<CommitOptimisticWriteResult, EngineError<S::Error>> {
        let publish_snapshot = self.can_publish_authority(&admission).await?;
        self.settle_optimistic_response(transaction, claim, response, projections, publish_snapshot)
            .await
    }

    /// Retire copied optimistic responses without deleting authored commands,
    /// UUIDs, identity bindings, leases, retry state, or the local draft journal.
    #[cfg(test)]
    async fn retire_optimistic_snapshots(
        &mut self,
        typenames: &[String],
    ) -> Result<WriteResult, EngineError<S::Error>> {
        self.retire_optimistic_snapshots_where(|entry, source| {
            let requested = |key: &EntityKey<'_>| {
                key.typename()
                    .is_some_and(|name| typenames.iter().any(|kind| kind == name))
            };
            entry.optimistic.normalized_updates.keys().any(requested)
                || source
                    .projection_mutations
                    .iter()
                    .any(|mutation| requested(&EntityKey(mutation.record_key().as_str().into())))
        })
        .await
    }

    /// Application-owned selection of copied optimistic content. The selector
    /// may preserve authored recovery metadata before the response is retired.
    /// It must not copy protected response content into that metadata.
    pub async fn retire_optimistic_snapshots_where(
        &mut self,
        mut selected: impl FnMut(&QueuedMutation, &mut OptimisticSource) -> bool + maybe_send::MaybeSend,
    ) -> Result<WriteResult, EngineError<S::Error>> {
        self.ensure_revision_can_advance()?;
        self.hydrate_optimistic().await?;
        let mut queued = self
            .storage
            .load_mutation_queue()
            .await
            .map_err(EngineError::Storage)?;
        let mut retired_projection_owners = BTreeSet::new();
        for entry in &mut queued {
            let mut source = decode_optimistic_source(&entry.optimistic.optimistic_data_json)
                .map_err(|detail| EngineError::InvalidQueuedMutation {
                    id: entry.id,
                    detail,
                })?;
            if !selected(entry, &mut source) {
                continue;
            }
            source.mutation_data = Json::Object(Default::default());
            source.link_patches.clear();
            source.revalidations.clear();
            source.projection_mutations.clear();
            source.uncertain_calendar_event_keys.clear();
            entry.optimistic = PersistedOptimisticLayer {
                optimistic_data_json: encode_optimistic_source(&source),
                normalized_updates: RecordUpdates::new(),
            };
            retired_projection_owners.insert(entry.id);
        }
        // Even a preserved command's materialized link update can contain a
        // retired record copied from its old base. Persist the rebuilt updates,
        // while retaining projection shadows owned by preserved commands.
        let persisted = queued
            .iter()
            .map(|entry| (entry.id, entry.optimistic.clone()))
            .collect::<Vec<_>>();
        let rebuilt = self.rebuild_queued_layers(queued).await?;
        let replacements = persisted
            .into_iter()
            .zip(rebuilt)
            .filter_map(|((id, mut layer), rebuilt)| {
                if !retired_projection_owners.contains(&id)
                    && layer.normalized_updates == rebuilt.updates
                {
                    return None;
                }
                layer.normalized_updates = rebuilt.updates;
                Some((id, layer))
            })
            .collect::<Vec<_>>();
        self.storage
            .replace_optimistic_layers(
                &replacements,
                &retired_projection_owners.into_iter().collect::<Vec<_>>(),
            )
            .await
            .map_err(EngineError::Storage)?;
        self.refresh_optimistic_queue().await
    }
}

impl<S: PredicateIndexStorage> Engine<S> {
    /// Persist an incomplete permission transition before application-specific
    /// retirement. Hold the owner lock until `complete_authority_transition`.
    /// The application decides which policy changes require retirement. Initial
    /// non-denials can become ready without evicting legacy offline snapshots.
    pub async fn begin_authority_transition(
        &mut self,
        identity: &str,
        expected: Uuid,
        policy: String,
        retire_snapshots: bool,
    ) -> Result<CacheAuthority, EngineError<S::Error>> {
        let current = self.current_authority(identity).await?;
        if current.generation != expected || policy.is_empty() {
            return Err(EngineError::StaleAuthority);
        }
        if current.ready && current.policy.as_ref() == Some(&policy) {
            return Ok(current);
        }
        // A persisted transition still owns its unfinished cleanup, even when
        // the next proof repeats the policy written before the interruption.
        let retire_snapshots = retire_snapshots || (current.policy.is_some() && !current.ready);
        if retire_snapshots {
            self.ensure_revision_can_advance()?;
        }
        let authority = CacheAuthority {
            identity: identity.to_owned(),
            account: current.account,
            generation: Uuid::now_v7(),
            policy: Some(policy),
            ready: !retire_snapshots,
        };
        self.store_authority(&authority).await?;
        Ok(authority)
    }

    /// Open reads only after application retirement finishes durably. A failed
    /// retirement leaves the marker closed across engine/process restarts.
    pub async fn complete_authority_transition(
        &mut self,
        mut authority: CacheAuthority,
    ) -> Result<AuthorityTransition, EngineError<S::Error>> {
        if self.stored_authority().await?.as_ref() != Some(&authority) {
            return Err(EngineError::StaleAuthority);
        }
        if authority.ready {
            return Ok(AuthorityTransition {
                authority,
                revision: self.revision,
                affected_ops: BTreeSet::new(),
                changed: false,
            });
        }
        self.ensure_revision_can_advance()?;
        self.hot.clear();
        self.live_queries = live_query::LiveQueries::default();
        self.window_observations = window_observation::WindowObservations::default();
        self.query_watches = watch_query::QueryWatches::default();
        let affected_ops = self.deps.all_ops();
        self.advance_revision()?;
        authority.ready = true;
        self.store_authority(&authority).await?;
        Ok(AuthorityTransition {
            authority,
            revision: self.revision,
            affected_ops,
            changed: true,
        })
    }

    /// Replace already-read records during a closed permission transition.
    /// Unlike a network merge, omitted fields are removed. Hosts supply the
    /// matching application projection changes under the same owner lock.
    pub async fn retire_record_fields(
        &mut self,
        entries: Vec<(EntityKey<'static>, Record)>,
        projections: Vec<ProjectionMutation>,
    ) -> Result<(), EngineError<S::Error>> {
        if self
            .stored_authority()
            .await?
            .is_none_or(|state| state.ready)
        {
            return Err(EngineError::StaleAuthority);
        }
        self.ensure_revision_can_advance()?;
        for (key, _) in &entries {
            self.hot.pop(key);
        }
        self.storage
            .put_batch_with_projections(entries, projections)
            .await
            .map_err(EngineError::Storage)?;
        self.advance_revision()?;
        Ok(())
    }

    /// Apply a fresh server proof only to the generation captured before its
    /// request. A conflict requires another server request, never replaying the
    /// same proof with a newer generation.
    ///
    /// The durable incomplete marker precedes every destructive step. If a
    /// process or storage failure interrupts retirement, reopening remains
    /// closed and a later fresh proof retries the idempotent retirement.
    #[cfg(test)]
    async fn transition_authority(
        &mut self,
        identity: &str,
        expected: Uuid,
        policy: String,
        typenames: &[String],
    ) -> Result<AuthorityTransition, EngineError<S::Error>> {
        let authority = self
            .begin_authority_transition(identity, expected, policy, true)
            .await?;
        if authority.ready {
            return self.complete_authority_transition(authority).await;
        }
        self.retire_optimistic_snapshots(typenames).await?;

        for projection_only in [false, true] {
            for typename in typenames {
                let mut after_id = None;
                loop {
                    let keys = if projection_only {
                        self.storage
                            .projection_keys(typename, after_id.as_deref(), RETIREMENT_PAGE_SIZE)
                            .await
                    } else {
                        self.storage
                            .record_keys(typename, after_id.as_deref(), RETIREMENT_PAGE_SIZE)
                            .await
                    }
                    .map_err(EngineError::Storage)?;
                    let Some(last_id) = keys.last().and_then(|key| key.id()) else {
                        break;
                    };
                    after_id = Some(last_id.to_owned());
                    let projections = keys
                        .iter()
                        .filter_map(|key| PredicateRecordKey::new(key.to_string()).ok())
                        .collect::<Vec<_>>();
                    let removable = self.preserve_identity_metadata(keys).await?;
                    self.delete_keys_with_projections(&removable, &projections)
                        .await?;
                }
            }
        }

        self.complete_authority_transition(authority).await
    }

    /// Retire copied content while preserving aliases, coalescing UUIDs and
    /// deletion tombstones required by later authored command replay.
    pub async fn preserve_identity_metadata(
        &mut self,
        keys: Vec<EntityKey<'static>>,
    ) -> Result<Vec<EntityKey<'static>>, EngineError<S::Error>> {
        let records = self
            .storage
            .get_batch(&keys)
            .await
            .map_err(EngineError::Storage)?;
        let mut remove = Vec::new();
        let mut retain = Vec::new();
        for (key, record) in keys.into_iter().zip(records) {
            let Some(mut record) = record else {
                remove.push(key);
                continue;
            };
            if ![
                identity::ALIAS_FIELD,
                identity::MUTATION_UUID_FIELD,
                identity::DELETED_FIELD,
            ]
            .iter()
            .any(|field| record.fields.contains_key(*field))
            {
                remove.push(key);
                continue;
            }
            record.fields.retain(|field, _| {
                matches!(
                    field.as_str(),
                    identity::ALIAS_FIELD
                        | identity::MUTATION_UUID_FIELD
                        | identity::DELETED_FIELD
                        | "id"
                        | "__typename"
                )
            });
            retain.push((key, record));
        }
        if !retain.is_empty() {
            self.retire_record_fields(retain, vec![]).await?;
        }
        Ok(remove)
    }
}
