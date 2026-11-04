//! Account-fenced local facts and streamed before-limit person ranking.
use super::*;
use crate::people::{
    self, ContextAction, ContextState, ContextUpdate, MAX_PEOPLE_BATCH, PeopleError,
    PeopleReferenceRequest, PeopleReferenceResult, PeopleSearch, PeopleSearchResult, StoredFacts,
};
use crate::value::CacheValue;
use macro_user_id::user_id::MacroUserIdStr;

impl<S: Storage> Engine<S> {
    async fn people_scope(&mut self, scope: &HydrationScope) -> Result<(), EngineError<S::Error>> {
        if MacroUserIdStr::try_from(scope.identity.as_str()).is_err()
            || self.stored_storage_generation().await? != Some(scope.storage_generation)
            || self
                .current_identity()
                .await?
                .is_some_and(|identity| identity != scope.identity)
        {
            return Err(EngineError::StaleHydrationScope);
        }
        Ok(())
    }
    async fn people_context(&self) -> Result<ContextState, EngineError<S::Error>> {
        let rows = self
            .storage
            .get_batch(&[EntityKey(people::CONTEXT_META.into())])
            .await
            .map_err(EngineError::Storage)?;
        let Some(record) = rows.into_iter().next().flatten() else {
            return Ok(ContextState::Missing);
        };
        match record.fields.get("state") {
            Some(CacheValue::Opaque(value)) => {
                serde_json::from_str(value).map_err(|error| PeopleError::Encoding(error).into())
            }
            _ => Err(PeopleError::InvalidInput.into()),
        }
    }

    /// Execute a bounded read in the existing local database. This entry point
    /// never binds an account, scans records into Rust, or contacts a server.
    pub async fn read_people_sql(
        &mut self,
        request: &people::sql::PeopleSqlRequest,
    ) -> Result<people::sql::PeopleSqlResult, EngineError<S::Error>> {
        self.people_scope(&request.scope).await?;
        if self.current_identity().await?.as_deref() != Some(request.scope.identity.as_str()) {
            return Err(EngineError::StaleHydrationScope);
        }
        let plan = match &request.input {
            people::sql::PeopleSqlInput::Statement { sql } => {
                people::sql::PeopleSqlPlan::compile(sql)?
            }
            people::sql::PeopleSqlInput::Identities { ids } => {
                people::sql::PeopleSqlPlan::identities(ids)?
            }
        };
        if self
            .optimistic
            .iter()
            .filter(|layer| !layer.superseded)
            .any(|layer| {
                layer
                    .updates
                    .keys()
                    .any(|key| key.as_ref().starts_with("GraphqlContact:"))
            })
        {
            return Ok(people::sql::PeopleSqlResult::Incomplete);
        }
        self.storage
            .read_people_sql(&request.scope.identity, &plan)
            .await
            .map_err(EngineError::Storage)
    }

    /// Inspect context publication before a compare-and-set begin, without scanning people.
    pub async fn people_context_state(
        &mut self,
        scope: &HydrationScope,
    ) -> Result<ContextState, EngineError<S::Error>> {
        self.people_scope(scope).await?;
        self.people_context().await
    }

    /// Write only client-owned facts, never names, email, userId, or public
    /// identity fields. A context-only stub cannot satisfy a contact fragment.
    /// Callers serialize patches and restart with a new epoch after uncertain IO.
    pub async fn update_people_context(
        &mut self,
        update: &ContextUpdate,
    ) -> Result<WriteResult, EngineError<S::Error>> {
        self.people_scope(&update.scope).await?;
        let current = self.people_context().await?;
        let mut updates = RecordUpdates::new();
        let state = match &update.action {
            ContextAction::Begin { previous_epoch } => {
                if current.epoch() == Some(update.epoch) {
                    current
                } else if current.epoch() == *previous_epoch {
                    ContextState::Building {
                        epoch: update.epoch,
                    }
                } else {
                    return Err(PeopleError::StaleContext.into());
                }
            }
            ContextAction::Patch { updates: patches } => {
                if current.epoch() != Some(update.epoch) {
                    return Err(PeopleError::StaleContext.into());
                }
                let state = current;
                if patches.len() > MAX_PEOPLE_BATCH
                    || patches.iter().any(|patch| {
                        patch.user_id.as_ref().len() > 1024
                            || patch
                                .facts
                                .direct_message
                                .as_ref()
                                .is_some_and(|dm| dm.name.len() > 4096)
                    })
                {
                    return Err(PeopleError::InvalidInput.into());
                }
                for patch in patches {
                    let key = people::contact_key(&update.scope.identity, patch.user_id.as_ref());
                    let value = serde_json::to_value(StoredFacts {
                        epoch: update.epoch,
                        facts: patch.facts.clone(),
                    })
                    .map_err(PeopleError::Encoding)?;
                    updates.insert(
                        key,
                        Record {
                            fields: [(people::CONTEXT_FIELD.into(), CacheValue::opaque(&value))]
                                .into(),
                        },
                    );
                }
                state
            }
            ContextAction::Commit => {
                if current.epoch() != Some(update.epoch) {
                    return Err(PeopleError::StaleContext.into());
                }
                ContextState::Ready {
                    epoch: update.epoch,
                }
            }
        };
        let value = serde_json::to_value(state).map_err(PeopleError::Encoding)?;
        updates.insert(
            EntityKey(people::CONTEXT_META.into()),
            Record {
                fields: [("state".into(), CacheValue::opaque(&value))].into(),
            },
        );
        self.ensure_revision_can_advance()?;
        if self.current_identity().await?.is_none() {
            self.bind_identity(&update.scope.identity).await?;
        }
        let changed = self.persist_updates(updates, vec![]).await?;
        Ok(WriteResult {
            field_changes: Some(changed.field_changes),
            identity_errors: vec![],
            revision: changed.revision,
            revision_advanced: changed.revision_advanced,
            search_changed_buckets: Some(BTreeSet::from(["person".into()])),
            changed: changed.changed,
            affected_ops: BTreeSet::new(),
            reset: false,
            revalidations: vec![],
            mutation_uuid: None,
        })
    }

    /// Resolve names over the complete cached contact projection, retaining at
    /// most two witnesses per requested label. This is not a suggestion page.
    /// Callers still check hydration completeness before assuming uniqueness.
    pub async fn resolve_people_references(
        &mut self,
        request: &PeopleReferenceRequest,
    ) -> Result<PeopleReferenceResult, EngineError<S::Error>> {
        let mut collector = people::references::ReferenceCollector::new(request, None)?;
        self.people_scope(&request.scope).await?;
        // Unlike menu search, this read may not require a published context.
        // It must still have an established viewer; it never binds one itself.
        if self.current_identity().await?.as_deref() != Some(request.scope.identity.as_str()) {
            return Err(EngineError::StaleHydrationScope);
        }
        if request.labels.is_empty() {
            return collector.finish().map_err(EngineError::from);
        }
        if request.exclude_secondary_inboxes {
            let ContextState::Ready { epoch } = self.people_context().await? else {
                return Ok(PeopleReferenceResult::ContextPending);
            };
            collector.set_epoch(epoch);
        }
        self.storage
            .visit_contact_records(&SearchQuery::new(""), |key, record| {
                collector.push(key, record)
            })
            .await
            .map_err(EngineError::Storage)?;
        collector.finish().map_err(EngineError::from)
    }

    /// Stream SQL-filtered records into one bounded heap. Secondary inboxes,
    /// explicit exclusions, DM substitution and surface scores apply before K.
    /// Contact records are server-owned/read-only; context stubs do not rank.
    pub async fn search_people(
        &mut self,
        request: &PeopleSearch,
    ) -> Result<PeopleSearchResult, EngineError<S::Error>> {
        if request.limit == 0
            || request.limit > MAX_PEOPLE_BATCH
            || request.query.len() > subsequence_match::MAX_QUERY_BYTES
            || request.excluded.len() > MAX_PEOPLE_BATCH
            || request
                .sender_domain
                .as_ref()
                .is_some_and(|domain| domain.len() > 255)
        {
            return Err(PeopleError::InvalidInput.into());
        }
        self.people_scope(&request.scope).await?;
        let ContextState::Ready { epoch } = self.people_context().await? else {
            return Ok(PeopleSearchResult::ContextPending);
        };
        let query = SearchQuery::new(&request.query);
        let mut ranker = people::ranking::PeopleRanker::new(request, epoch)?;
        self.storage
            .visit_contact_records(&query, |key, record| ranker.push(key, record))
            .await
            .map_err(EngineError::Storage)?;
        if ranker.scan_prior_conversations() {
            self.storage
                .visit_contact_records(&query, |key, record| ranker.push(key, record))
                .await
                .map_err(EngineError::Storage)?;
        }
        ranker.finish().map_err(EngineError::from)
    }
}
