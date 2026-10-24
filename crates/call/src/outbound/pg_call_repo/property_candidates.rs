//! Authorized call candidates with complete boolean filtering before pagination.

use filter_ast::Expr;
use item_filters::{
    CallStatus,
    ast::{
        call::CallLiteral,
        properties::{PropertiesLiteral, PropertyMatchValue},
    },
};
use models_grouping::CandidatePage;
use models_pagination::SimpleSortMethod;
use properties::query_support::{
    CandidateRow, build_property_candidate_query, decode_candidate_page,
};
use sqlx::{PgPool, Postgres, QueryBuilder};

use crate::domain::models::CallCandidateRequest;

pub(super) async fn select(
    pool: &PgPool,
    request: CallCandidateRequest,
) -> Result<CandidatePage, sqlx::Error> {
    let mut query = build_property_candidate_query(&request.selection, |query| {
        query.push("WITH viewer AS (SELECT ");
        query.push_bind(request.selection.viewer().as_ref().to_owned());
        query.push(include_str!("property_candidates/source.sql"));
        query.push("SELECT candidate.call_id::text AS id, 'CALL_RECORD'::text AS entity_type, ");
        if matches!(
            request.selection.query().timestamp_sort,
            Some(SimpleSortMethod::CreatedAt)
        ) {
            query.push("candidate.started_at");
        } else {
            query.push("COALESCE(candidate.ended_at, candidate.started_at)");
        }
        query.push(" AS activity_at, NULL::text AS project_id FROM visible_calls candidate WHERE ");
        if let Some(filter) = request.filter.as_deref() {
            push_filter(query, filter);
        } else {
            query.push("TRUE");
        }
        Ok(())
    })
    .map_err(|error| sqlx::Error::Protocol(error.to_string()))?;
    let rows = query
        .build_query_as::<CandidateRow>()
        .persistent(false)
        .fetch_all(pool)
        .await?;
    Ok(decode_candidate_page(rows, request.selection.query()))
}

fn push_filter(query: &mut QueryBuilder<'_, Postgres>, filter: &Expr<CallLiteral>) {
    match filter {
        Expr::And(left, right) | Expr::Or(left, right) => {
            query.push("(");
            push_filter(query, left);
            query.push(if matches!(filter, Expr::And(..)) {
                " AND "
            } else {
                " OR "
            });
            push_filter(query, right);
            query.push(")");
        }
        Expr::Not(inner) => {
            query.push("NOT (");
            push_filter(query, inner);
            query.push(")");
        }
        Expr::Literal(CallLiteral::CallId(id)) => {
            query.push("candidate.call_id = ").push_bind(*id);
        }
        Expr::Literal(CallLiteral::ChannelId(id)) => {
            query
                .push("COALESCE(candidate.channel_id = ")
                .push_bind(*id)
                .push(", FALSE)");
        }
        Expr::Literal(CallLiteral::Speaker(speaker)) => {
            query.push("((candidate.source_kind = 'active' AND EXISTS (SELECT 1 FROM call_transcripts transcript WHERE transcript.call_id = candidate.call_id AND transcript.speaker_id = ");
            query.push_bind(speaker.as_ref().to_owned());
            query.push(")) OR (candidate.source_kind = 'archived' AND EXISTS (SELECT 1 FROM call_record_transcripts transcript WHERE transcript.call_record_id = candidate.call_id AND COALESCE(transcript.custom_speaker, transcript.speaker_id) = ");
            query.push_bind(speaker.as_ref().to_owned());
            // Imported attendees render as guest IDs, not their linked accounts.
            // Only a provider label left unmatched by hydration can be a Macro ID.
            query.push(")) OR (candidate.source_kind = 'imported' AND EXISTS (SELECT 1 FROM call_entity_transcript_segments transcript WHERE transcript.call_id = candidate.call_id AND transcript.participant_id IS NULL AND transcript.speaker_label = ");
            query.push_bind(speaker.as_ref().to_owned());
            query.push(
                r#" AND NOT EXISTS (
                SELECT 1 FROM call_entity_participants person
                WHERE person.call_id = transcript.call_id
                  AND translate(COALESCE(person.display_name, person.email, 'Participant'),
                      'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz')
                      = translate(transcript.speaker_label,
                          'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz')
            ))))"#,
            );
        }
        Expr::Literal(CallLiteral::Status(status)) => {
            query.push("candidate.status = ").push_bind(match status {
                CallStatus::Attended => "ATTENDED",
                CallStatus::Missed => "MISSED",
                CallStatus::Unattended => "UNATTENDED",
            });
        }
        Expr::Literal(CallLiteral::Attended(attended)) => {
            query.push(if *attended {
                "candidate.status = 'ATTENDED'"
            } else {
                "candidate.status <> 'ATTENDED'"
            });
        }
        Expr::Literal(CallLiteral::Property(property)) => push_property(query, property),
    }
}

fn push_property(query: &mut QueryBuilder<'_, Postgres>, property: &PropertiesLiteral) {
    // CALL_RECORD is not one of the generic typed scopes. An explicit different
    // scope must not read an assignment for the same UUID under another entity.
    if property.entity_type.is_some() {
        query.push("FALSE");
        return;
    }
    query.push("EXISTS (SELECT 1 FROM entity_properties ep WHERE ep.entity_id = candidate.call_id::text AND ep.entity_type = 'CALL_RECORD' AND ");
    match &property.value {
        PropertyMatchValue::SelectOption(option) => {
            // Def-less tag filters match their globally unique option across definitions.
            query.push(
                "jsonb_typeof(ep.values->'value') = 'array' AND jsonb_exists(ep.values->'value', ",
            );
            query.push_bind(option.to_string()).push(")");
        }
        PropertyMatchValue::EntityRef(id) => {
            query
                .push("ep.property_definition_id = ")
                .push_bind(property.property_definition_id);
            query.push(" AND jsonb_typeof(ep.values->'value') = 'array' AND ep.values->'value' @> jsonb_build_array(jsonb_build_object('entity_id', ");
            query.push_bind(id.to_string()).push("::text))");
        }
        PropertyMatchValue::DatePresent | PropertyMatchValue::DateRange(_) => {
            query
                .push("ep.property_definition_id = ")
                .push_bind(property.property_definition_id);
            query.push(" AND CASE WHEN ep.values->>'type' = 'Date' AND ep.values->>'value' IS NOT NULL THEN TRUE");
            if let PropertyMatchValue::DateRange(range) = &property.value {
                if let Some(start) = range.start {
                    query
                        .push(" AND (ep.values->>'value')::timestamptz >= ")
                        .push_bind(start);
                }
                if let Some(end) = range.end {
                    query
                        .push(" AND (ep.values->>'value')::timestamptz < ")
                        .push_bind(end);
                }
            }
            query.push(" ELSE FALSE END");
        }
    }
    query.push(")");
}

#[cfg(test)]
mod test;
