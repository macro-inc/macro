//! Durable permission generations shared by all clients of one cache owner.
//!
//! Hosts hold their existing engine lock across snapshot writes and retirement. Policy
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

impl CacheAuthority {
    pub(super) fn for_account(mut self, account: Option<String>) -> Self {
        if self.account == account {
            return self;
        }
        if !(self.account.is_none() && account.is_some() && self.policy.is_none()) {
            self.generation = Uuid::now_v7();
            if self.ready {
                self.policy = None;
            }
            self.ready = false;
        }
        self.account = account;
        self
    }

    pub(super) fn record(&self) -> (EntityKey<'static>, Record) {
        let value = serde_json::json!({
            "identity": self.identity, "account": self.account,
            "generation": self.generation, "policy": self.policy, "ready": self.ready,
        });
        (
            EntityKey(AUTHORITY_KEY.into()),
            Record {
                fields: [(AUTHORITY_FIELD.into(), CacheValue::opaque(&value))].into(),
            },
        )
    }
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
        "TaskDependencyRecipe": schemars::schema_for!(crate::task_dependency::TaskDependencyRecipe),
        "CacheAuthority": schemars::schema_for!(CacheAuthority),
        "AuthorityTransition": schemars::schema_for!(AuthorityTransitionWire),
    }})
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
    /// Last durably committed authority, for infallible notifications under the owner lock.
    pub fn authority_snapshot(&self) -> Option<&CacheAuthority> {
        self.authority.get().and_then(Option::as_ref)
    }
    pub(super) async fn stored_authority(
        &self,
    ) -> Result<Option<CacheAuthority>, EngineError<S::Error>> {
        if let Some(authority) = self.authority.get() {
            return Ok(authority.clone());
        }
        let rows = self
            .storage
            .get_batch(&[EntityKey(AUTHORITY_KEY.into())])
            .await
            .map_err(EngineError::Storage)?;
        let authority = match rows.into_iter().next().flatten() {
            None => None,
            Some(record) => match record.fields.get(AUTHORITY_FIELD) {
                Some(CacheValue::Opaque(value)) => {
                    Some(serde_json::from_str(value).map_err(|_| EngineError::InvalidAuthority)?)
                }
                _ => return Err(EngineError::InvalidAuthority),
            },
        };
        let _ = self.authority.set(authority.clone());
        Ok(authority)
    }

    /// A durable cleanup interrupted by storage or process failure.
    /// Owners finish it before returning cached content after reopening.
    pub async fn unfinished_retirement(
        &self,
    ) -> Result<Option<CacheAuthority>, EngineError<S::Error>> {
        Ok(self
            .stored_authority()
            .await?
            .filter(|state| !state.ready && state.policy.is_some()))
    }

    async fn store_authority(
        &mut self,
        authority: &CacheAuthority,
    ) -> Result<(), EngineError<S::Error>> {
        self.storage
            .put_batch(vec![authority.record()])
            .await
            .map_err(EngineError::Storage)?;
        self.authority = std::sync::OnceLock::from(Some(authority.clone()));
        Ok(())
    }

    /// Capture the shared generation before requesting permission or content.
    /// This does not gate reads or start a server proof, bind
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
            let authority = authority.for_account(account);
            self.store_authority(&authority).await?;
            return Ok(authority);
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

    /// Compare a response generation under the same owner lock as its write.
    /// Reads and network requests never wait for permission proof or readiness.
    pub async fn snapshot_is_current(
        &mut self,
        generation: Option<Uuid>,
    ) -> Result<bool, EngineError<S::Error>> {
        let Some(generation) = generation else {
            // Deployed native bundles may omit this IPC argument. Protocol 18
            // browser requests must supply a stamp before reaching the core.
            return Ok(true);
        };
        let account = self.current_identity().await?;
        Ok(self
            .stored_authority()
            .await?
            .is_some_and(|state| state.generation == generation && state.account == account))
    }

    /// Keep an authored command from an older window without letting its copied
    /// response, link recipes, or projection shadows restore retired content.
    pub async fn enqueue_optimistic_mutation_in_generation(
        &mut self,
        origin_op: Option<OpId>,
        input: BeginOptimisticWrite<'_>,
        claim: MutationClaimRequest,
        mut effects: OptimisticEffects,
        generation: Option<Uuid>,
    ) -> Result<EnqueueOptimisticMutationResult<EngineError<S::Error>>, EngineError<S::Error>> {
        let accepted = self.snapshot_is_current(generation).await?;
        let empty = Json::Object(Default::default());
        // Query-rooted recipes normally derive these fresh reads during
        // enqueue. Preserve them before dropping the stale copied recipe.
        let revalidations = (!accepted).then(|| {
            deduplicate_revalidations(
                input.revalidations.iter().cloned().chain(
                    input
                        .link_patches
                        .iter()
                        .filter_map(OptimisticLinkPatch::revalidation),
                ),
            )
        });
        let input = BeginOptimisticWrite {
            task_dependency_recipe: if accepted {
                input.task_dependency_recipe
            } else {
                None
            },
            data: if accepted { input.data } else { &empty },
            link_patches: if accepted { input.link_patches } else { &[] },
            revalidations: revalidations.as_deref().unwrap_or(input.revalidations),
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
    pub async fn commit_optimistic_write_in_generation(
        &mut self,
        transaction: OptimisticTransactionId,
        claim: MutationClaimToken,
        response: NetworkWrite<'_>,
        projections: Vec<ProjectionMutation>,
        generation: Option<Uuid>,
    ) -> Result<CommitOptimisticWriteResult, EngineError<S::Error>> {
        let publish_snapshot = self.snapshot_is_current(generation).await?;
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
            generation: if current.policy.is_none() && !retire_snapshots {
                current.generation
            } else {
                Uuid::now_v7()
            },
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
}
