//! Ownership evidence shared by base and optimistic snapshot retirement.
use super::*;
use cache_core::meta::Schema;
use cache_core::normalize::normalize;

pub(super) fn assignment_owners<E: std::error::Error + 'static>(
    schema: &Schema,
    query: &str,
    operation: Option<&str>,
    variables: &Map<String, Value>,
    data: &Value,
) -> Result<BTreeMap<EntityKey<'static>, Record>, EngineError<E>> {
    let document = crate::parsed_document::parsed_document(query)?;
    let op = document.operation(operation)?;
    if !selects_properties(&op.selection_set) {
        return Ok(BTreeMap::new());
    }
    let updates = normalize(schema, op, variables, data)?;
    Ok(response_property_owners(
        schema, op, variables, data, &updates,
    )?)
}

/// Derive ownership metadata from the response's existing normalization pass.
pub fn response_property_owners(
    schema: &Schema,
    op: &cache_core::document::Operation,
    variables: &Map<String, Value>,
    data: &Value,
    updates: &cache_core::normalize::RecordUpdates,
) -> Result<cache_core::normalize::RecordUpdates, cache_core::normalize::NormalizeError> {
    if !selects_properties(&op.selection_set) {
        return Ok(BTreeMap::new());
    }
    let mut owners = BTreeMap::new();
    for (parent, record) in updates {
        for (field, value) in &record.fields {
            if field_name(field) == "properties" {
                refs(value, &mut |property| {
                    if let Some(key) = property_owner_key(property) {
                        owners.insert(key, owner_record(parent.clone()));
                    }
                });
            }
        }
    }
    if op.kind == cache_core::document::OperationKind::Mutation {
        let mut fields = Vec::new();
        crate::collect_applicable_fields(
            schema,
            &op.selection_set,
            schema.mutation_root().unwrap_or(""),
            &mut fields,
        );
        for field in fields {
            if field.name != "setEntityProperty" {
                continue;
            }
            let arguments = cache_core::document::resolve_args(field, variables)
                .map_err(cache_core::normalize::NormalizeError::from)?;
            let input = arguments.get("input");
            let owner = input.and_then(|input| {
                owner_from_kind(
                    input.get("entityType")?.as_str()?,
                    input.get("entityId")?.as_str()?,
                )
            });
            let Some(owner) = owner else {
                continue;
            };
            let Some(value) = data.get(&field.response_key) else {
                continue;
            };
            let mut selections = Vec::new();
            crate::collect_applicable_fields(
                schema,
                &field.selection_set,
                "GraphqlProperty",
                &mut selections,
            );
            let Some(id) = selections
                .iter()
                .filter(|field| field.name == "id")
                .find_map(|field| value.get(&field.response_key).and_then(Value::as_str))
            else {
                continue;
            };
            owners.insert(EntityKey::entity(OWNER_TYPE, &[id]), owner_record(owner));
        }
    }
    Ok(owners)
}

pub(super) async fn read_records<S: PredicateIndexStorage>(
    engine: &Engine<S>,
    keys: &[EntityKey<'static>],
) -> Result<BTreeMap<EntityKey<'static>, Record>, EngineError<S::Error>> {
    let mut records = BTreeMap::new();
    for page in keys.chunks(PAGE) {
        let rows = engine
            .storage()
            .get_batch(page)
            .await
            .map_err(EngineError::Storage)?;
        records.extend(
            page.iter()
                .cloned()
                .zip(rows)
                .filter_map(|(key, row)| row.map(|row| (key, row))),
        );
    }
    Ok(records)
}

fn option_definition(
    key: &EntityKey<'_>,
    record: &Record,
    owners: &BTreeMap<EntityKey<'static>, Record>,
) -> Option<EntityKey<'static>> {
    if let Some(id) = string(record, "propertyDefinitionId") {
        return Some(EntityKey::entity("GraphqlPropertyDefinition", &[id]));
    }
    let metadata = EntityKey::entity("CachePropertyOptionOwner", &[key.id().unwrap_or_default()]);
    match owners.get(&metadata)?.fields.get("owner")? {
        CacheValue::Ref(owner) => Some(owner.clone()),
        _ => None,
    }
}

/// Read ownership evidence in bounded batches, never one query per assignment.
pub(super) async fn selected_keys<S: PredicateIndexStorage>(
    engine: &Engine<S>,
    entries: &[(EntityKey<'static>, Record)],
    overrides: BTreeMap<EntityKey<'static>, Record>,
) -> Result<std::collections::BTreeSet<EntityKey<'static>>, EngineError<S::Error>> {
    let metadata = entries
        .iter()
        .filter_map(|(key, _)| match key.typename() {
            Some("GraphqlProperty") => property_owner_key(key),
            Some("GraphqlPropertyOption") => Some(EntityKey::entity(
                "CachePropertyOptionOwner",
                &[key.id().unwrap_or_default()],
            )),
            _ => None,
        })
        .collect::<Vec<_>>();
    let mut owners = read_records(engine, &metadata).await?;
    owners.extend(overrides);
    let definition_keys = entries
        .iter()
        .filter(|(key, _)| key.typename() == Some("GraphqlPropertyOption"))
        .filter_map(|(key, record)| option_definition(key, record, &owners))
        .collect::<std::collections::BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    let mut definitions = read_records(engine, &definition_keys).await?;
    for (key, record) in entries {
        if key.typename() == Some("GraphqlPropertyDefinition") {
            definitions
                .entry(key.clone())
                .or_default()
                .merge(record.clone());
        }
    }
    Ok(entries.iter().filter(|(key, record)| match key.typename() {
        Some("GraphqlProperty") => !property_owner_key(key).and_then(|key| owners.get(&key))
            .and_then(|record| record.fields.get("owner"))
            .is_some_and(|owner| matches!(owner, CacheValue::Ref(owner) if owner.typename().is_some_and(|kind| OTHER_PROPERTY_OWNERS.contains(&kind)))),
        Some("GraphqlPropertyOption") => !option_definition(key, record, &owners)
            .and_then(|key| definitions.get(&key)).is_some_and(shared_definition),
        Some("GraphqlPropertyDefinition") => !shared_definition(record),
        _ => selected_record(key, record),
    }).map(|(key, _)| key.clone()).collect())
}

fn selects_properties(selections: &[cache_core::document::Selection]) -> bool {
    use cache_core::document::Selection;
    selections.iter().any(|selection| match selection {
        Selection::Field(field) => {
            matches!(field.name.as_str(), "properties" | "setEntityProperty")
                || selects_properties(&field.selection_set)
        }
        Selection::Fragment { selection_set, .. } => selects_properties(selection_set),
    })
}
