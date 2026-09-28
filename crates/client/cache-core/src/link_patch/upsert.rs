//! Response-derived identities for logical members of normalized link lists.

use super::*;

#[cfg(test)]
mod test;

pub(super) fn resolve_field(
    selections: &[Selection],
    type_name: &str,
    variables: &serde_json::Map<String, Json>,
    operation: &LinkOperation,
) -> Result<Option<FieldKey>, LinkPatchError> {
    let LinkOperation::UpsertByField { where_field, .. } = operation else {
        return Ok(None);
    };
    let selected = selected_field(selections, type_name, where_field)?;
    if !selected.selection_set.is_empty() {
        return Err(LinkPatchError::WrongShape);
    }
    Ok(Some(selected_storage_key(selected, variables)?))
}

pub(super) fn resolve(
    operation: &LinkOperation,
    target: &ResolvedTarget,
    response: &RecordUpdates,
) -> Result<Option<EntityKey<'static>>, LinkPatchError> {
    let LinkOperation::UpsertByField {
        entity_key, equals, ..
    } = operation
    else {
        return Ok(None);
    };
    let field = target
        .match_field
        .as_ref()
        .ok_or(LinkPatchError::WrongShape)?;
    let typename = entity_key.as_ref().split_once(':').map(|(name, _)| name);
    let matches: Vec<_> = response
        .iter()
        .filter(|(key, record)| {
            key.as_ref().split_once(':').map(|(name, _)| name) == typename
                && record
                    .fields
                    .get(field)
                    .is_some_and(|value| cache_scalar_equals(value, equals))
        })
        .collect();
    if matches.len() != 1 {
        return Err(LinkPatchError::ResponseMatchCount(matches.len()));
    }
    Ok(Some(matches[0].0.clone()))
}

pub(super) fn missing_records(
    effective: &HashMap<EntityKey<'static>, Record>,
    target: &ResolvedTarget,
) -> Vec<EntityKey<'static>> {
    let Some(mut value) = effective
        .get(&target.parent_entity_key)
        .and_then(|record| record.fields.get(&target.field_key))
        .cloned()
    else {
        return Vec::new();
    };
    let Ok(value) = traverse(&mut value, &target.path) else {
        return Vec::new();
    };
    let Ok(links) = normalized_links(value) else {
        return Vec::new();
    };
    links
        .iter()
        .filter_map(|link| match link {
            CacheValue::Ref(key) if !effective.contains_key(key) => Some(key.clone()),
            _ => None,
        })
        .collect()
}

pub(super) fn apply(
    links: &mut Vec<CacheValue>,
    effective: &HashMap<EntityKey<'static>, Record>,
    field: &str,
    equals: &Json,
    inserted: &EntityKey<'static>,
) -> Result<(), LinkPatchError> {
    let typename = inserted.as_ref().split_once(':').map(|(name, _)| name);
    let mut retained = Vec::with_capacity(links.len() + 1);
    for link in links.iter() {
        if let CacheValue::Ref(key) = link {
            if key.as_ref().split_once(':').map(|(name, _)| name) == typename {
                let record = effective
                    .get(key)
                    .ok_or_else(|| LinkPatchError::MissingParent(key.clone()))?;
                let value =
                    record
                        .fields
                        .get(field)
                        .ok_or_else(|| LinkPatchError::MissingField {
                            parent: key.to_string(),
                            field: field.to_string(),
                        })?;
                if cache_scalar_equals(value, equals) {
                    continue;
                }
            }
        }
        retained.push(link.clone());
    }
    retained.insert(0, CacheValue::Ref(inserted.clone()));
    *links = retained;
    Ok(())
}
