//! Channel metadata in the existing Soup snapshot, patch, and notification paths.

use super::*;
use soup_filter_projection::channel::{ChannelProjectionInput, project_channel};

type Object = serde_json::Map<String, serde_json::Value>;

fn organization(value: &serde_json::Value) -> Result<Option<i64>, ()> {
    if value.is_null() {
        return Ok(None);
    }
    Ok(Some(
        value.as_str().ok_or(())?.parse::<i64>().map_err(|_| ())?,
    ))
}

fn channel_type(value: &serde_json::Value) -> Result<&str, ()> {
    match value.as_str() {
        Some(kind @ ("public" | "private" | "team" | "direct_message")) => Ok(kind),
        _ => Err(()),
    }
}

pub(super) fn complete(record_key: RecordKey, object: &Object) -> Result<IndexDocument, ()> {
    if object.get("cacheProjection") != Some(&serde_json::Value::Null) {
        return Err(());
    }
    let input = ChannelProjectionInput {
        record_key,
        id: uuid::Uuid::parse_str(
            object
                .get("id")
                .and_then(serde_json::Value::as_str)
                .ok_or(())?,
        )
        .map_err(|_| ())?,
        owner: object
            .get("ownerId")
            .and_then(serde_json::Value::as_str)
            .ok_or(())?
            .to_owned(),
        channel_type: channel_type(object.get("channelType").ok_or(())?)?.to_owned(),
        team_id: optional_uuid(object.get("teamId").ok_or(())?).ok_or(())?,
        organization_id: organization(object.get("organizationId").ok_or(())?)?,
        is_participant: object
            .get("isParticipant")
            .and_then(serde_json::Value::as_bool)
            .ok_or(())?,
        created_at: graphql_timestamp(object.get("createdAt").ok_or(())?).ok_or(())?,
        updated_at: graphql_timestamp(object.get("updatedAt").ok_or(())?).ok_or(())?,
    };
    let document = project_channel(input).map_err(|_| ())?;
    notifications::compose_active_notifications(document, object)
}

pub(super) fn patch(
    record_key: RecordKey,
    object: &Object,
    updated_at_fallback_ms: Option<i64>,
) -> Result<OptimisticProjectionMutation, ()> {
    let mut exact: Vec<_> = direct_patch::owner(object)?.into_iter().collect();
    if let Some(value) = object.get("channelType") {
        exact.push(ExactAttributePatch {
            attribute: vocabulary::channel_type(),
            values: vec![ExactValue::utf8(channel_type(value)?).map_err(|_| ())?],
        });
    }
    if let Some(value) = object.get("isParticipant") {
        exact.push(ExactAttributePatch {
            attribute: vocabulary::channel_participant(),
            values: vec![ExactValue::new([u8::from(value.as_bool().ok_or(())?)]).map_err(|_| ())?],
        });
    }
    // Optimistic payloads use the alias from the generated Soup fragment; the
    // selected authoritative path has already resolved arbitrary aliases.
    if let Some(value) = object.get("teamId").or_else(|| object.get("channelTeamId")) {
        exact.push(ExactAttributePatch {
            attribute: vocabulary::channel_team(),
            values: optional_uuid(value)
                .ok_or(())?
                .map(|id| ExactValue::new(id.as_bytes()))
                .transpose()
                .map_err(|_| ())?
                .into_iter()
                .collect(),
        });
    }
    if let Some(value) = object.get("organizationId") {
        exact.push(ExactAttributePatch {
            attribute: vocabulary::channel_organization(),
            values: organization(value)?
                .map(|id| ExactValue::new(id.to_be_bytes()))
                .transpose()
                .map_err(|_| ())?
                .into_iter()
                .collect(),
        });
    }
    if object.contains_key("notifications") {
        exact.extend(notifications::snapshot_patches(&record_key, object)?);
    }
    let (integers, sorts) = direct_patch::timestamps(object, updated_at_fallback_ms)?;
    Ok(OptimisticProjectionMutation::Patch {
        record_key,
        profile: vocabulary::profile_v4(),
        partition: vocabulary::channel_partition(),
        exact,
        integers,
        sorts,
    })
}

#[cfg(test)]
mod test;
