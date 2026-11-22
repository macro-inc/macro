//! Replay task assignments against authoritative records and surviving earlier layers.

use super::*;
use crate::document::Selection;
use crate::task_dependency::{
    BLOCKING, COMPLETED, DEPENDS_ON, STATUS, TaskDependencyChange, TaskDependencyRecipe,
};
use serde_json::json;
use std::collections::BTreeMap;

fn field<'a>(selections: &'a [Selection], name: &str) -> Option<&'a crate::document::FieldNode> {
    selections.iter().find_map(|selection| match selection {
        Selection::Field(node) if node.name == name => Some(node),
        Selection::Fragment { selection_set, .. } => field(selection_set, name),
        _ => None,
    })
}

fn property<'a>(state: &'a Json, definition: &str) -> Option<&'a Json> {
    state
        .get("properties")?
        .as_array()?
        .iter()
        .find(|property| {
            property.get("propertyDefinitionId").and_then(Json::as_str) == Some(definition)
        })
}

fn references(state: &Json, definition: &str) -> Vec<String> {
    property(state, definition)
        .and_then(|property| property["value"]["references"].as_array())
        .into_iter()
        .flatten()
        .filter_map(|reference| reference["entityId"].as_str().map(str::to_owned))
        .collect()
}

fn replace_property(state: &mut Json, new: Json) {
    if let Some(properties) = state["properties"].as_array_mut() {
        properties
            .retain(|property| property["propertyDefinitionId"] != new["propertyDefinitionId"]);
        properties.push(new);
    }
}

fn relationship(state: &Json, definition: &str, ids: &[String]) -> Json {
    let id = property(state, definition)
        .and_then(|property| property["id"].as_str())
        .map(str::to_owned)
        .unwrap_or_else(|| {
            format!(
                "optimistic-property:DOCUMENT:{}:{definition}",
                state["id"].as_str().unwrap_or_default()
            )
        });
    let value = if ids.is_empty() {
        Json::Null
    } else {
        json!({"__typename":"GraphqlEntityReferencePropertyValue", "references":ids.iter().map(|id| json!({
            "entityId":id,"entityType":"TASK","specificMessageId":null
        })).collect::<Vec<_>>()})
    };
    json!({"id":id,"propertyDefinitionId":definition,
        "displayName":if definition == DEPENDS_ON { "Depends On" } else { "Blocking" },
        "dataType":"ENTITY","isMultiSelect":true,"isSystem":true,"isMetadata":false,
        "specificEntityType":"TASK","value":value})
}

fn completed(state: &Json) -> bool {
    property(state, STATUS)
        .and_then(|property| property["value"]["optionIds"].as_array())
        .is_some_and(|ids| ids.iter().any(|id| id.as_str() == Some(COMPLETED)))
}

impl<S: Storage> Engine<S> {
    async fn load_task_recipe_state(
        &mut self,
        id: &str,
        selections: &[Selection],
        layers: &[OptimisticLayer],
        staged: &RecordUpdates,
    ) -> Result<Option<Json>, EngineError<S::Error>> {
        let key = EntityKey::entity("GraphqlTaskDependencyState", &[id]);
        let mut keys = BTreeSet::from([key.clone()]);
        loop {
            let mut bases = self.load_bases(&keys).await?;
            for key in &keys {
                if let Some(record) = staged.get(key) {
                    bases.insert(key.clone(), record.clone());
                }
            }
            let effective = present_records(effective_records(&bases, layers, &keys));
            let mut deps = BTreeSet::new();
            match crate::denormalize::denormalize_record(
                &self.schema,
                &key,
                "GraphqlTaskDependencyState",
                selections,
                &serde_json::Map::new(),
                &effective,
                &mut deps,
            )? {
                ReadOutcome::Complete(state) => return Ok(Some(state)),
                ReadOutcome::NeedRecords(missing) => {
                    let before = keys.len();
                    keys.extend(missing);
                    if before == keys.len() {
                        return Ok(None);
                    }
                }
                ReadOutcome::Miss { .. } => return Ok(None),
            }
        }
    }

    #[expect(
        clippy::too_many_arguments,
        reason = "replay uses the queued operation and its preceding staged view"
    )]
    pub(super) async fn replay_task_dependency(
        &mut self,
        recipe: &TaskDependencyRecipe,
        authored: &Json,
        query: &str,
        operation_name: Option<&str>,
        variables: &serde_json::Map<String, Json>,
        layers: &[OptimisticLayer],
        staged: &RecordUpdates,
    ) -> Result<Json, EngineError<S::Error>> {
        let operation = Self::document(&mut self.docs, query)?
            .operation(operation_name)?
            .prepare(variables)?;
        let selections = field(&operation.selection_set, "setTaskProperty")
            .and_then(|node| field(&node.selection_set, "tasks"))
            .map(|node| node.selection_set.clone())
            .ok_or_else(|| {
                EngineError::InvalidOptimisticProjection(
                    "task recipe requires setTaskProperty.tasks".into(),
                )
            })?;
        let Some(primary) = self
            .load_task_recipe_state(&recipe.task_id, &selections, layers, staged)
            .await?
        else {
            // The authored property remains an ordinary mutation response. Never
            // invent a missing task state or reciprocal records from that metadata.
            return Ok(
                json!({"setTaskProperty":{"property":authored["setTaskProperty"]["property"]}}),
            );
        };
        let mut authored_property = property(&primary, recipe.definition())
            .unwrap_or(&authored["setTaskProperty"]["property"])
            .clone();
        if authored_property["propertyDefinitionId"].as_str() != Some(recipe.definition()) {
            return Err(EngineError::InvalidOptimisticProjection(
                "task recipe property does not match authored response".into(),
            ));
        }
        authored_property["value"] = match &recipe.change {
            TaskDependencyChange::DependsOn { target_ids }
            | TaskDependencyChange::Blocking { target_ids } => {
                relationship(&primary, recipe.definition(), target_ids)["value"].clone()
            }
            TaskDependencyChange::Status { option_ids } => {
                json!({"__typename":"GraphqlSelectOptionPropertyValue","optionIds":option_ids})
            }
        };
        let mut ids = BTreeSet::from([recipe.task_id.clone()]);
        ids.extend(references(&primary, DEPENDS_ON));
        ids.extend(references(&primary, BLOCKING));
        ids.extend(recipe.targets().iter().cloned());
        let mut states = BTreeMap::from([(recipe.task_id.clone(), primary)]);
        for id in &ids {
            if states.contains_key(id) {
                continue;
            }
            if let Some(state) = self
                .load_task_recipe_state(id, &selections, layers, staged)
                .await?
            {
                states.insert(id.clone(), state);
            }
        }
        // Completion evidence is loaded only by explicit dependency IDs, not cached lists.
        let blocker_ids = states
            .values()
            .flat_map(|state| references(state, DEPENDS_ON))
            .collect::<BTreeSet<_>>();
        for id in blocker_ids {
            if states.contains_key(&id) {
                continue;
            }
            if let Some(state) = self
                .load_task_recipe_state(&id, &selections, layers, staged)
                .await?
            {
                states.insert(id, state);
            }
        }
        let before = states.clone();
        let old_targets = references(&states[&recipe.task_id], recipe.definition());
        if let Some(primary) = states.get_mut(&recipe.task_id) {
            replace_property(primary, authored_property.clone());
        }
        if recipe.definition() != STATUS {
            let inverse = if recipe.definition() == DEPENDS_ON {
                BLOCKING
            } else {
                DEPENDS_ON
            };
            for id in old_targets
                .iter()
                .chain(recipe.targets())
                .collect::<BTreeSet<_>>()
            {
                if let Some(target) = states.get_mut(id) {
                    let mut links = references(target, inverse);
                    links.retain(|id| id != &recipe.task_id);
                    if recipe.targets().contains(id) {
                        links.push(recipe.task_id.clone());
                    }
                    let property = relationship(target, inverse, &links);
                    replace_property(target, property);
                }
            }
        }
        let tasks = ids
            .into_iter()
            .filter_map(|id| {
                let mut state = states.get(&id)?.clone();
                let old = &before[&id];
                let old_blockers = references(old, DEPENDS_ON);
                let open = references(&state, DEPENDS_ON)
                    .into_iter()
                    .filter(|blocker| {
                        if let Some(state) = states.get(blocker) {
                            return !completed(state);
                        }
                        !old_blockers.contains(blocker)
                            || old["openBlockerIds"]
                                .as_array()
                                .is_none_or(|ids| ids.iter().any(|id| id.as_str() == Some(blocker)))
                    })
                    .collect::<Vec<_>>();
                state["isBlocked"] = json!(!open.is_empty());
                state["openBlockerIds"] = json!(open);
                Some(state)
            })
            .collect::<Vec<_>>();
        Ok(json!({"setTaskProperty":{"property":authored_property,"tasks":tasks}}))
    }
}
