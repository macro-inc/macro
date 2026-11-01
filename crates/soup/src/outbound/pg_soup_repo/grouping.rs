//! SQL grouping and property-value expressions for Soup queries.

use models_grouping::{GroupByField, date_bucket_sql_key, date_bucket_sql_order};
use std::borrow::Cow;
use system_properties::SystemPropertyKey;

const PROJECT_GROUPING: GroupByField = GroupByField::Property {
    property_definition_id: SystemPropertyKey::PROJECT_UUID,
    entity_type: None,
    bucketing: None,
};

/// SQL expressions derived from one property value and its definition.
pub(super) struct PropertyValueSql {
    /// Nullable numeric sort key for the complete stored value.
    pub sort_key: String,
    /// SQL type used to bind the sort key.
    pub sort_type: &'static str,
    /// Group key for one expanded value; absent values retain the empty key.
    pub group_key: String,
    /// Nullable display order for one expanded option.
    pub group_order: String,
}

/// SQL expressions for one stored property type.
struct PropertyTypeSql {
    data_types: &'static str,
    value_type: &'static str,
    sort_key: Option<String>,
    group_key: Option<String>,
    group_order: Option<String>,
}

/// Guard a DATE value before casting its JSON payload.
pub(super) fn property_date_expression(alias: &str) -> String {
    format!(
        "CASE WHEN {alias}.values->>'type' = 'Date' THEN ({alias}.values->>'value')::timestamptz END"
    )
}

/// Derive sorting and grouping from the same per-type rules.
/// All arguments are trusted SQL aliases or expressions owned by this adapter.
pub(super) fn property_value_sql(
    alias: &str,
    property_definition_id: &str,
    data_type: &str,
    element: &str,
    option_alias: &str,
) -> PropertyValueSql {
    let date = property_date_expression(alias);
    let option_order = format!("{option_alias}.display_order::double precision");
    // Keep the map lookup independent of the item so PostgreSQL can build it once as an InitPlan.
    let selected_order = format!(
        "(SELECT min(((SELECT jsonb_object_agg(po.id::text, po.display_order) FROM property_options po WHERE po.property_definition_id = {property_definition_id}) ->> chosen.id)::double precision) FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof({alias}.values->'value') = 'array' THEN {alias}.values->'value' ELSE '[]'::jsonb END) chosen(id))"
    );
    let number = format!(
        "CASE WHEN jsonb_typeof({alias}.values->'value') = 'number' THEN ({alias}.values->>'value')::double precision END"
    );
    let boolean = format!(
        "CASE WHEN jsonb_typeof({alias}.values->'value') = 'boolean' THEN CASE WHEN ({alias}.values->>'value')::boolean THEN 1::double precision ELSE 0::double precision END END"
    );
    let option_group =
        format!("CASE WHEN {option_alias}.id IS NOT NULL THEN {element}#>>'{{}}' END");
    let branches = [
        PropertyTypeSql {
            data_types: "'DATE'",
            value_type: "Date",
            sort_key: Some(format!(
                "EXTRACT(EPOCH FROM {date})::double precision * 1000000"
            )),
            group_key: None,
            group_order: None,
        },
        PropertyTypeSql {
            data_types: "'NUMBER'",
            value_type: "Number",
            sort_key: Some(number),
            group_key: None,
            group_order: None,
        },
        PropertyTypeSql {
            data_types: "'BOOLEAN'",
            value_type: "Boolean",
            sort_key: Some(boolean),
            group_key: None,
            group_order: None,
        },
        PropertyTypeSql {
            data_types: "'SELECT_STRING', 'SELECT_NUMBER', 'TAG'",
            value_type: "SelectOption",
            sort_key: Some(selected_order),
            group_key: Some(option_group),
            group_order: Some(option_order),
        },
        PropertyTypeSql {
            data_types: "'ENTITY'",
            value_type: "EntityReference",
            sort_key: None,
            group_key: Some(format!("{element}->>'entity_id'")),
            group_order: None,
        },
        PropertyTypeSql {
            data_types: "'LINK'",
            value_type: "Link",
            sort_key: None,
            group_key: Some(format!("{element}#>>'{{}}'")),
            group_order: None,
        },
    ];
    let mut sort_key = String::from("CASE");
    let mut group_key = String::from("CASE");
    let mut group_order = String::from("CASE");
    for branch in branches {
        let condition = format!(
            " WHEN {data_type} IN ({}) AND {alias}.values->>'type' = '{}' THEN ",
            branch.data_types, branch.value_type
        );
        let null_number = "NULL::double precision";
        sort_key.push_str(&condition);
        sort_key.push_str(branch.sort_key.as_deref().unwrap_or(null_number));
        group_key.push_str(&condition);
        group_key.push_str(branch.group_key.as_deref().unwrap_or("NULL::text"));
        group_order.push_str(&condition);
        group_order.push_str(branch.group_order.as_deref().unwrap_or(null_number));
    }
    sort_key.push_str(" ELSE NULL::double precision END");
    group_key.push_str(" ELSE NULL::text END");
    group_order.push_str(" ELSE NULL::double precision END");
    PropertyValueSql {
        sort_key,
        sort_type: "double precision",
        group_key: format!("COALESCE({group_key}, '')"),
        group_order,
    }
}

/// Build the group select expression for a field.
pub fn group_select_expr(field: &GroupByField) -> Cow<'static, str> {
    match field {
        GroupByField::Date => Cow::Owned(date_bucket_sql_key("sort_ts")),
        GroupByField::EntityType => Cow::Borrowed("item_type"),
        GroupByField::Project => group_select_expr(&PROJECT_GROUPING),
        GroupByField::Property { .. } => Cow::Owned(
            property_value_sql(
                "ep_group",
                "NULL::uuid",
                "ep_group.data_type",
                "ep_group.val",
                "po_group",
            )
            .group_key,
        ),
    }
}

/// Build the group order expression for a field.
pub fn group_order_expr(field: &GroupByField) -> Cow<'static, str> {
    match field {
        GroupByField::Date => Cow::Owned(date_bucket_sql_order("sort_ts")),
        GroupByField::EntityType => Cow::Borrowed("\"group_key\""),
        GroupByField::Project => group_order_expr(&PROJECT_GROUPING),
        GroupByField::Property { .. } => {
            Cow::Borrowed("(\"group_key\" = '') ASC, \"group_order\" ASC NULLS LAST, \"group_key\"")
        }
    }
}

/// Result of building a group JOIN clause with optional bind parameter.
pub struct GroupJoinClause {
    /// SQL JOIN clause; the optional entity type uses the fixed `$10` slot.
    pub sql: String,
    /// Entity type value to bind at `$10`, if present.
    pub entity_type_bind: Option<String>,
}

/// Expand option, tag, entity and link values into their server-derived groups.
/// Scalar values never expand arrays, including malformed DATE payloads.
pub fn group_join_clause(field: &GroupByField) -> Option<GroupJoinClause> {
    if matches!(field, GroupByField::Project) {
        return group_join_clause(&PROJECT_GROUPING);
    }
    let GroupByField::Property {
        property_definition_id,
        entity_type,
        ..
    } = field
    else {
        return None;
    };
    let entity_type_filter = if entity_type.is_some() {
        "AND ep.entity_type = $10::property_entity_type"
    } else {
        ""
    };
    let data_type = format!(
        "(SELECT data_type FROM property_definitions WHERE id = '{property_definition_id}')"
    );
    Some(GroupJoinClause {
        sql: format!(
            "LEFT JOIN LATERAL (
                SELECT ep.values, ep.property_definition_id, {data_type} AS data_type, elem.val
                FROM entity_properties ep
                LEFT JOIN LATERAL jsonb_array_elements(
                    CASE WHEN {data_type} IN ('SELECT_STRING', 'SELECT_NUMBER', 'TAG', 'ENTITY', 'LINK')
                        AND jsonb_typeof(ep.values->'value') = 'array'
                        THEN ep.values->'value' ELSE '[]'::jsonb END
                ) elem(val) ON TRUE
                WHERE ep.entity_id = t.id::text
                  AND ep.entity_type = t.property_entity_type
                  AND ep.property_definition_id = '{property_definition_id}'
                  {entity_type_filter}
            ) ep_group ON TRUE"
        ),
        entity_type_bind: entity_type.clone(),
    })
}

#[cfg(test)]
mod test;
