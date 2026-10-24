//! Source-owned candidate selection for the entity families stored by Soup.

use super::*;
use crate::domain::models::property_candidates::PropertyCandidateRequest;
use item_filters::ast::properties::properties_filter_matches_propertyless;
use models_grouping::CandidatePage;
use properties::query_support::{
    CandidateRow, build_property_candidate_query, decode_candidate_page,
};

/// Select before hydration, preserving the ordinary source gates and full filters.
pub(in crate::outbound::pg_soup_repo) async fn select(
    db: &PgPool,
    request: PropertyCandidateRequest,
) -> Result<CandidatePage, sqlx::Error> {
    let sort = request
        .selection
        .query()
        .timestamp_sort
        .unwrap_or(SimpleSortMethod::UpdatedAt);
    let mut document_ids = DocumentIdArrays::starting_at(9);
    let source_sql = source_sql(&request.filter, sort, &mut document_ids);
    let mut query = build_property_candidate_query(&request.selection, |query| {
        // Existing source predicates address these eight parameter slots.
        // Register them before the property helper adds its own bound values.
        query.push(PREFIX);
        query.push("request_context AS (SELECT ");
        query.push_bind(request.selection.viewer().as_ref().to_owned()).push("::text AS user_id, ");
        query.push_bind(sort.to_string()).push("::text AS sort_method, ");
        query.push_bind(i64::from(request.selection.query().limit)).push("::bigint AS page_limit, ");
        query.push_bind(None::<DateTime<Utc>>).push("::timestamptz AS after_time, ");
        query.push_bind(None::<String>).push("::text AS after_id, ");
        query.push_bind(StatusOption::COMPLETED_UUID.to_string()).push("::text AS completed_option, ");
        query.push_bind(SystemPropertyKey::STATUS_UUID).push("::uuid AS status_property, ");
        query.push_bind(SystemPropertyKey::ASSIGNEES_UUID).push("::uuid AS assignees_property), id_parameters AS (SELECT 1 AS reserved");
        for (index, ids) in document_ids.into_binds().into_iter().enumerate() {
            query.push(", ").push_bind(ids).push(format!("::text[] AS ids_{index}"));
        }
        query.push("), source_rows AS (").push(source_sql);
        query.push(") SELECT id::text AS id, property_entity_type::text AS entity_type, sort_ts AS activity_at, project_id FROM source_rows");
        if let Some(filter) = request.filter.agent_session_filter.as_deref()
            && crate::outbound::pg_soup_repo::agent_session::opted_in(filter)
            && request.filter.properties_filter.as_deref().is_none_or(properties_filter_matches_propertyless)
        {
            query.push(" UNION ALL ");
            crate::outbound::pg_soup_repo::agent_session::push_property_candidates(query, sort, filter);
        }
        Ok(())
    }).map_err(|error| sqlx::Error::Protocol(error.to_string()))?;
    let rows = query
        .build_query_as::<CandidateRow>()
        .persistent(false)
        .fetch_all(db)
        .await?;
    Ok(decode_candidate_page(rows, request.selection.query()))
}

fn source_sql(
    filter: &EntityFilterAst,
    sort: SimpleSortMethod,
    document_ids: &mut DocumentIdArrays,
) -> String {
    let mut sources = Vec::new();
    if !document_filter_is_impossible(filter.document_filter.as_deref())
        && properties_filter_can_apply_to(
            filter.properties_filter.as_deref(),
            &[PropertyEntityType::Document, PropertyEntityType::Task],
        )
    {
        sources.push(format!(
            "{}{}{}{}{}",
            grouped_document_top_clause(sort),
            if document_filter_needs_task_property_joins(filter.document_filter.as_deref()) {
                DOCUMENT_TASK_PROPERTY_JOINS
            } else {
                ""
            },
            document_top_where_clause(sort),
            build_document_filter(filter.document_filter.as_deref(), Some(document_ids)),
            build_properties_filter(filter.properties_filter.as_deref(), "d.id"),
        ));
    }
    if !chat_filter_is_impossible(filter.chat_filter.as_deref())
        && properties_filter_can_apply_to(
            filter.properties_filter.as_deref(),
            &[PropertyEntityType::Chat],
        )
    {
        sources.push(format!(
            "{}{}{}{}",
            grouped_chat_top_clause(sort),
            chat_top_where_clause(),
            build_chat_filter(filter.chat_filter.as_deref()),
            build_properties_filter(filter.properties_filter.as_deref(), "c.id")
        ));
    }
    if !project_filter_is_impossible(filter.project_filter.as_deref())
        && properties_filter_can_apply_to(
            filter.properties_filter.as_deref(),
            &[PropertyEntityType::Project],
        )
    {
        sources.push(format!(
            "{}{}{}{}",
            grouped_project_top_clause(sort),
            project_top_where_clause(),
            build_project_filter(filter.project_filter.as_deref()),
            build_properties_filter(filter.properties_filter.as_deref(), "p.id")
        ));
    }
    if !calendar_event_filter_is_impossible(filter.calendar_event_filter.as_deref())
        && properties_filter_can_apply_to(
            filter.properties_filter.as_deref(),
            &[PropertyEntityType::CalendarEvent],
        )
    {
        sources.push(format!(
            "{}{}{}",
            grouped_calendar_event_top_clause(sort),
            build_calendar_event_filter(filter.calendar_event_filter.as_deref()),
            build_properties_filter(filter.properties_filter.as_deref(), "event.id::text")
        ));
    }
    if initiative_opted_in(filter.initiative_filter.as_deref())
        && properties_filter_can_apply_to(
            filter.properties_filter.as_deref(),
            &[PropertyEntityType::Initiative],
        )
    {
        sources.push(format!(
            "{}{}{}",
            initiative_top_clause(sort, true),
            build_initiative_filter(filter.initiative_filter.as_deref()),
            build_properties_filter(filter.properties_filter.as_deref(), "i.id::text")
        ));
    }
    if database_row_opted_in(filter.database_row_filter.as_deref())
        && properties_filter_can_apply_to(
            filter.properties_filter.as_deref(),
            &[PropertyEntityType::DatabaseRow],
        )
    {
        sources.push(format!(
            "{}{}{}",
            database_row_top_clause(sort, true),
            build_database_row_filter(filter.database_row_filter.as_deref()),
            build_properties_filter(filter.properties_filter.as_deref(), "r.id::text")
        ));
    }
    if sources.is_empty() {
        "SELECT NULL::text AS item_type, NULL::text AS id, NULL::timestamptz AS sort_ts, NULL::text AS project_id, NULL::property_entity_type AS property_entity_type WHERE FALSE".into()
    } else {
        sources.join(" UNION ALL ")
    }
}

#[cfg(test)]
mod test;
