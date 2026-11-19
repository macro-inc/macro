//! Selective record and optimistic snapshot retirement, preserving authored intent.

use super::*;

impl<S: Storage> Engine<S> {
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
        let mut affected_projection_keys = BTreeSet::new();
        for entry in &mut queued {
            let mut source = decode_optimistic_source(&entry.optimistic.optimistic_data_json)
                .map_err(|detail| EngineError::InvalidQueuedMutation {
                    id: entry.id,
                    detail,
                })?;
            if !selected(entry, &mut source) {
                continue;
            }
            affected_projection_keys.extend(
                source
                    .projection_mutations
                    .iter()
                    .map(|mutation| mutation.record_key().clone()),
            );
            source.mutation_data = Json::Object(Default::default());
            source.link_patches.clear();
            // Revalidation descriptors perform fresh authorized reads. Retain
            // them so settlement repairs parent edges whose copied recipe retired.
            source.projection_mutations.clear();
            source.uncertain_calendar_event_keys.clear();
            entry.optimistic = PersistedOptimisticLayer {
                optimistic_data_json: encode_optimistic_source(&source),
                normalized_updates: RecordUpdates::new(),
            };
            retired_projection_owners.insert(entry.id);
        }
        // Durable sources retain local IDs, while hydrated layers may already
        // project their canonical aliases. Retire both identities' shadows.
        affected_projection_keys.extend(
            self.optimistic
                .iter()
                .filter(|layer| retired_projection_owners.contains(&layer.id))
                .flat_map(|layer| &layer.projection_mutations)
                .map(|mutation| mutation.record_key().clone()),
        );
        // Even a preserved command's materialized link update can contain a
        // retired record copied from its old base. Persist the rebuilt updates,
        // while retaining projection shadows owned by preserved commands.
        let persisted = queued
            .iter()
            .map(|entry| (entry.id, entry.optimistic.clone()))
            .collect::<Vec<_>>();
        let rebuilt = self.rebuild_queued_layers(queued).await?;
        // A shadow's owner is only its last contributor. Recompose every key
        // touched by a retired layer from its base and all surviving layers.
        let affected_projection_keys = affected_projection_keys.into_iter().collect::<Vec<_>>();
        let authoritative = self
            .storage
            .load_projection_states(&affected_projection_keys)
            .await
            .map_err(EngineError::Storage)?;
        if authoritative.len() != affected_projection_keys.len() {
            return Err(EngineError::InvalidOptimisticProjection(
                "storage returned misaligned authoritative projection states".into(),
            ));
        }
        let remaining = rebuilt
            .iter()
            .filter(|layer| !layer.superseded)
            .map(|layer| ProjectionMutationLayer {
                owner: layer.id,
                mutations: &layer.projection_mutations,
            })
            .collect::<Vec<_>>();
        let projections = affected_projection_keys
            .iter()
            .zip(&authoritative)
            .filter_map(|(key, base)| {
                compose_effective_optimistic_projection(key, base.as_ref(), &remaining).transpose()
            })
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| EngineError::InvalidOptimisticProjection(error.to_string()))?;
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
            .replace_optimistic_layers(&replacements, &affected_projection_keys, &projections)
            .await
            .map_err(EngineError::Storage)?;
        self.refresh_optimistic_queue().await
    }
}

impl<S: PredicateIndexStorage> Engine<S> {
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
