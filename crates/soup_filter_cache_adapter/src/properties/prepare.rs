use super::*;
use cache_core::{
    document::{Document, OperationKind, resolve_args},
    normalize::normalize,
    predicate::PredicateIndexStorage,
    value::{CacheValue, EntityKey, Record},
};
use predicate_index::{
    ExactAttributePatch, ExactValue, IndexQuery, PartitionPredicate, PredicateExpr, SortDirection,
    ValidatedIndexQuery,
};
use std::collections::BTreeSet;
use uuid::Uuid;

#[derive(Default)]
pub(super) struct Changes {
    snapshot: Option<Result<Vec<ExactFact>, ()>>,
    values: BTreeMap<Uuid, Result<Vec<ExactFact>, ()>>,
}
impl Changes {
    pub(super) fn apply(&self, base: Option<Vec<ExactFact>>) -> Option<Vec<ExactFact>> {
        let mut result = match &self.snapshot {
            Some(snapshot) => snapshot.clone().ok()?,
            None => base?,
        };
        for (definition, value) in &self.values {
            let value = value.as_ref().ok()?;
            let attributes = attributes(*definition);
            result.retain(|fact| !attributes.contains(&fact.attribute));
            result.extend(value.iter().cloned());
        }
        Some(result)
    }
    pub(super) fn patches(&self, base: &[ExactFact]) -> Option<Vec<ExactAttributePatch>> {
        let mut selected = BTreeSet::new();
        let mut values = Vec::new();
        if let Some(snapshot) = &self.snapshot {
            values = snapshot.as_ref().ok()?.clone();
            selected.extend(base.iter().map(|fact| fact.attribute.clone()));
            selected.extend(values.iter().map(|fact| fact.attribute.clone()));
        }
        for (definition, value) in &self.values {
            let value = value.as_ref().ok()?;
            let attributes = attributes(*definition);
            values.retain(|fact| !attributes.contains(&fact.attribute));
            selected.extend(attributes);
            values.extend(value.iter().cloned());
        }
        Some(
            selected
                .into_iter()
                .map(|attribute| ExactAttributePatch {
                    values: values
                        .iter()
                        .filter(|fact| fact.attribute == attribute)
                        .map(|fact| fact.value.clone())
                        .collect(),
                    attribute,
                })
                .collect(),
        )
    }
}
fn attributes(definition: Uuid) -> [Token; 3] {
    [
        facts::select_attribute(definition),
        facts::entity_attribute(definition),
        facts::row_attribute(definition),
    ]
}
fn string(record: &Record, field: &str) -> Option<String> {
    match record.fields.get(field)? {
        CacheValue::String(value) => Some(value.clone()),
        _ => None,
    }
}
fn definition(record: &Record) -> Option<Uuid> {
    Uuid::parse_str(&string(record, "propertyDefinitionId")?).ok()
}
fn parent_key(kind: &str, id: &str) -> Option<RecordKey> {
    Uuid::parse_str(id).ok()?;
    let kind = match kind {
        "DOCUMENT" | "TASK" => "GraphqlSoupDocument",
        "PROJECT" => "GraphqlSoupProject",
        "CHAT" => "GraphqlSoupChat",
        "THREAD" => "GraphqlSoupEmailThread",
        _ => return None,
    };
    RecordKey::new(format!("{kind}:{id}")).ok()
}
fn is_parent(key: &EntityKey<'_>) -> bool {
    [
        "GraphqlSoupDocument:",
        "GraphqlSoupProject:",
        "GraphqlSoupChat:",
        "GraphqlSoupEmailThread:",
    ]
    .iter()
    .any(|prefix| key.as_ref().starts_with(prefix))
}
fn row_facts(key: &EntityKey<'_>, record: &Record) -> Result<(Uuid, Vec<ExactFact>), ()> {
    let definition = definition(record).ok_or(())?;
    let mut result = vec![ExactFact {
        attribute: facts::row_attribute(definition),
        value: ExactValue::utf8(key.as_ref()).map_err(|_| ())?,
    }];
    let value = record.fields.get("value").ok_or(())?;
    let CacheValue::Object(value) = value else {
        return if value == &CacheValue::Null {
            Ok((definition, result))
        } else {
            Err(())
        };
    };
    let Some(CacheValue::String(typename)) = value.get("__typename") else {
        return Err(());
    };
    match typename.as_str() {
        "GraphqlSelectOptionPropertyValue" => {
            let Some(CacheValue::List(options)) = value.get("optionIds") else {
                return Err(());
            };
            for option in options {
                let CacheValue::String(option) = option else {
                    return Err(());
                };
                let id = Uuid::parse_str(option).map_err(|_| ())?;
                result.push(ExactFact {
                    attribute: facts::select_attribute(definition),
                    value: ExactValue::new(id.as_bytes()).map_err(|_| ())?,
                });
            }
        }
        "GraphqlEntityReferencePropertyValue" => {
            let Some(CacheValue::List(references)) = value.get("references") else {
                return Err(());
            };
            for reference in references {
                let CacheValue::Object(reference) = reference else {
                    return Err(());
                };
                let Some(CacheValue::String(id)) = reference.get("entityId") else {
                    return Err(());
                };
                result.push(ExactFact {
                    attribute: facts::entity_attribute(definition),
                    value: ExactValue::utf8(id).map_err(|_| ())?,
                });
            }
        }
        "GraphqlBooleanPropertyValue"
        | "GraphqlNumberPropertyValue"
        | "GraphqlStringPropertyValue"
        | "GraphqlDatePropertyValue"
        | "GraphqlLinkPropertyValue" => {}
        _ => return Err(()),
    }
    Ok((definition, result))
}

fn snapshot(
    value: &CacheValue,
    updates: &BTreeMap<EntityKey<'static>, Record>,
) -> Result<Vec<ExactFact>, ()> {
    let CacheValue::List(properties) = value else {
        return Err(());
    };
    let mut definitions = BTreeSet::new();
    let mut result = Vec::new();
    for property in properties {
        let CacheValue::Ref(key) = property else {
            return Err(());
        };
        // New completeness comes only from values selected in this response,
        // never a truncated fragment merged with older stored property values.
        let (definition, facts) = row_facts(key, updates.get(key).ok_or(())?)?;
        if !definitions.insert(definition) {
            return Err(());
        }
        result.extend(facts);
    }
    Ok(result)
}

fn mutation_owners(
    query: &str,
    operation: Option<&str>,
    variables: &Map<String, Value>,
    data: &Value,
) -> Result<BTreeMap<EntityKey<'static>, RecordKey>, SoupFilterCacheAdapterError> {
    let doc = Document::parse(query).map_err(error)?;
    let op = doc.operation(operation).map_err(error)?;
    let mut owners = BTreeMap::new();
    if op.kind != OperationKind::Mutation {
        return Ok(owners);
    }
    let mut fields = Vec::new();
    crate::collect_applicable_fields(
        &op.selection_set,
        cache_core::meta::MUTATION_ROOT_TYPE.unwrap_or(""),
        &mut fields,
    );
    for field in fields {
        if field.name != "setEntityProperty" {
            continue;
        }
        let args = resolve_args(field, variables).map_err(error)?;
        let Some(input) = args.get("input").and_then(Value::as_object) else {
            continue;
        };
        let Some((kind, id)) = input
            .get("entityType")
            .and_then(Value::as_str)
            .zip(input.get("entityId").and_then(Value::as_str))
        else {
            continue;
        };
        let Some(parent) = parent_key(kind, id) else {
            continue;
        };
        let Some(value) = data.get(&field.response_key) else {
            continue;
        };
        let mut selections = Vec::new();
        crate::collect_applicable_fields(&field.selection_set, "GraphqlProperty", &mut selections);
        let Some(id) = selections
            .iter()
            .find(|f| f.name == "id")
            .and_then(|f| value.get(&f.response_key))
            .and_then(Value::as_str)
        else {
            continue;
        };
        owners.insert(EntityKey(format!("GraphqlProperty:{id}").into()), parent);
    }
    Ok(owners)
}

async fn owners<S: PredicateIndexStorage>(
    storage: &S,
    property: &EntityKey<'_>,
    definition: Uuid,
) -> Result<Vec<RecordKey>, ProjectionError<S::Error>> {
    let mut result = Vec::new();
    for (profile, partitions, sort) in [
        (
            vocabulary::profile_v5(),
            vec![
                vocabulary::document_partition(),
                vocabulary::project_partition(),
                vocabulary::chat_partition(),
            ],
            vocabulary::updated_at(),
        ),
        (
            facts::mail_profile(),
            vec![item_filter_index::mail::partition()],
            item_filter_index::mail::token("mail-all-ts"),
        ),
    ] {
        let predicate = PredicateExpr::Exact {
            attribute: facts::row_attribute(definition),
            value: ExactValue::utf8(property.as_ref()).map_err(error)?,
        };
        let query = ValidatedIndexQuery::new(IndexQuery {
            profile,
            partitions: partitions
                .into_iter()
                .map(|partition| PartitionPredicate {
                    partition,
                    predicate: predicate.clone(),
                })
                .collect(),
            sort_attribute: sort,
            sort_direction: SortDirection::Asc,
            tie_break_direction: SortDirection::Asc,
            limit: 2,
        })
        .map_err(error)?;
        result.extend(
            storage
                .reconcile_predicate_index(&query, &[])
                .await
                .map_err(ProjectionError::Storage)?
                .keys,
        );
    }
    // A property row has one canonical owning entity. Refuse contradictory
    // ownership instead of scanning or updating a truncated owner set.
    if result.len() > 1 {
        return Err(error("property projection has multiple owners").into());
    }
    Ok(result)
}

pub(super) async fn prepare<S: PredicateIndexStorage>(
    storage: &S,
    query: &str,
    operation: Option<&str>,
    variables: &Map<String, Value>,
    data: &Value,
    reuse: bool,
) -> Result<BTreeMap<RecordKey, Changes>, ProjectionError<S::Error>> {
    let document = Document::parse(query).map_err(error)?;
    let op = document.operation(operation).map_err(error)?;
    let updates: BTreeMap<_, _> = normalize(op, variables, data)
        .map_err(error)?
        .into_iter()
        .collect();
    let mut result: BTreeMap<RecordKey, Changes> = BTreeMap::new();
    let mut snapshot_children = BTreeSet::new();
    for (key, record) in &updates {
        if !is_parent(key) {
            continue;
        }
        if let Some(properties) = record.fields.get("properties") {
            if let CacheValue::List(properties) = properties {
                snapshot_children.extend(properties.iter().filter_map(|v| {
                    if let CacheValue::Ref(key) = v {
                        Some(key.clone())
                    } else {
                        None
                    }
                }));
            }
            result
                .entry(RecordKey::new(key.to_string()).map_err(error)?)
                .or_default()
                .snapshot = Some(snapshot(properties, &updates));
        }
    }
    let routed = mutation_owners(query, operation, variables, data)?;
    for (key, parent) in &routed {
        if updates
            .get(key)
            .is_none_or(|record| !record.fields.contains_key("value"))
        {
            // A successful explicit property mutation with an ID-only response
            // is not evidence that the old value survived unchanged.
            result.entry(parent.clone()).or_default().snapshot = Some(Err(()));
        }
    }
    for (key, update) in &updates {
        if !key.as_ref().starts_with("GraphqlProperty:")
            || !update.fields.contains_key("value")
            || snapshot_children.contains(key)
        {
            continue;
        }
        let mut record = if reuse {
            storage
                .get_batch(std::slice::from_ref(key))
                .await
                .map_err(ProjectionError::Storage)?
                .pop()
                .flatten()
                .unwrap_or_default()
        } else {
            Record::default()
        };
        record.merge(update.clone());
        let Some(definition) = definition(&record) else {
            if let Some(parent) = routed.get(key) {
                result.entry(parent.clone()).or_default().snapshot = Some(Err(()));
            }
            continue;
        };
        let parents = if let Some(parent) = routed.get(key) {
            vec![parent.clone()]
        } else if reuse {
            owners(storage, key, definition).await?
        } else {
            vec![]
        };
        for parent in parents {
            result
                .entry(parent)
                .or_default()
                .values
                .insert(definition, row_facts(key, &record).map(|(_, facts)| facts));
        }
    }
    Ok(result)
}

pub(super) async fn deletion_updates<S: PredicateIndexStorage>(
    storage: &S,
    keys: &[String],
) -> Result<Vec<ProjectionMutation>, ProjectionError<S::Error>> {
    let mut result = Vec::new();
    for key in keys
        .iter()
        .filter(|key| key.starts_with("GraphqlProperty:"))
    {
        let key = EntityKey(key.clone().into());
        let Some(record) = storage
            .get_batch(std::slice::from_ref(&key))
            .await
            .map_err(ProjectionError::Storage)?
            .pop()
            .flatten()
        else {
            continue;
        };
        let Some(definition) = definition(&record) else {
            continue;
        };
        for parent in owners(storage, &key, definition).await? {
            let Some(state) = storage
                .load_projection_states(std::slice::from_ref(&parent))
                .await
                .map_err(ProjectionError::Storage)?
                .pop()
                .flatten()
            else {
                continue;
            };
            result.push(incomplete(
                parent,
                state.profile().clone(),
                state.partition().clone(),
            ));
        }
    }
    Ok(result)
}
