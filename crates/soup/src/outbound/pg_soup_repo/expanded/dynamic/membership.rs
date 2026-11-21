//! Index-backed owner-or-assignee membership, independent of access and facets.
//!
//! Exact grouping and arbitrary sorts read the complete personal membership set,
//! not a page-sized subset. Never truncate that set before filtering or counting.

use filter_ast::Expr;
use item_filters::ast::{
    document::DocumentLiteral,
    initiative::InitiativeLiteral,
    properties::{PropertiesLiteral, PropertyEntityType, PropertyMatchValue},
};
use model_owner::Owner;
use system_properties::SystemPropertyKey;

use super::sql_string_literal;

fn matches_assignee(
    owner: &Owner,
    property: &PropertiesLiteral,
    kind: Option<PropertyEntityType>,
) -> bool {
    property.property_definition_id == SystemPropertyKey::ASSIGNEES_UUID
        && property.entity_type == kind
        && matches!(&property.value, PropertyMatchValue::EntityRef(id) if id.to_string() == owner.principal_id())
}

fn document_owner(expr: &Expr<DocumentLiteral>) -> Option<&Owner> {
    let Expr::Or(left, right) = expr else {
        return None;
    };
    let (owner, property) = match (left.as_ref(), right.as_ref()) {
        (
            Expr::Literal(DocumentLiteral::Owner(owner)),
            Expr::Literal(DocumentLiteral::Property(property)),
        )
        | (
            Expr::Literal(DocumentLiteral::Property(property)),
            Expr::Literal(DocumentLiteral::Owner(owner)),
        ) => (owner, property),
        _ => return None,
    };
    matches_assignee(owner, property, None).then_some(owner)
}

fn initiative_owner(expr: &Expr<InitiativeLiteral>) -> Option<&Owner> {
    let Expr::Or(left, right) = expr else {
        return None;
    };
    let (owner, property) = match (left.as_ref(), right.as_ref()) {
        (
            Expr::Literal(InitiativeLiteral::Owner(owner)),
            Expr::Literal(InitiativeLiteral::Property(property)),
        )
        | (
            Expr::Literal(InitiativeLiteral::Property(property)),
            Expr::Literal(InitiativeLiteral::Owner(owner)),
        ) => (owner, property),
        _ => return None,
    };
    matches_assignee(owner, property, Some(PropertyEntityType::Initiative)).then_some(owner)
}

/// Only positive conjuncts bound the whole query to personal membership.
pub(super) fn bounds_documents(expr: Option<&Expr<DocumentLiteral>>) -> bool {
    expr.is_some_and(|expr| match expr {
        Expr::And(left, right) => bounds_documents(Some(left)) || bounds_documents(Some(right)),
        _ => document_owner(expr).is_some(),
    })
}

pub(super) fn bounds_initiatives(expr: Option<&Expr<InitiativeLiteral>>) -> bool {
    expr.is_some_and(|expr| match expr {
        Expr::And(left, right) => bounds_initiatives(Some(left)) || bounds_initiatives(Some(right)),
        _ => initiative_owner(expr).is_some(),
    })
}

/// Membership work needs a timeout even inside a broader OR or negation.
pub(super) fn contains_documents(expr: Option<&Expr<DocumentLiteral>>) -> bool {
    expr.is_some_and(|expr| {
        document_owner(expr).is_some()
            || match expr {
                Expr::And(left, right) | Expr::Or(left, right) => {
                    contains_documents(Some(left)) || contains_documents(Some(right))
                }
                Expr::Not(inner) => contains_documents(Some(inner)),
                Expr::Literal(_) => false,
            }
    })
}

pub(super) fn contains_initiatives(expr: Option<&Expr<InitiativeLiteral>>) -> bool {
    expr.is_some_and(|expr| {
        initiative_owner(expr).is_some()
            || match expr {
                Expr::And(left, right) | Expr::Or(left, right) => {
                    contains_initiatives(Some(left)) || contains_initiatives(Some(right))
                }
                Expr::Not(inner) => contains_initiatives(Some(inner)),
                Expr::Literal(_) => false,
            }
    })
}

fn assigned_ids(owner: &Owner, kind: Option<PropertyEntityType>) -> String {
    let principal = sql_string_literal(&owner.principal_id());
    let entity_type = kind
        .map(|kind| format!("AND ep.entity_type = '{kind}'"))
        .unwrap_or_default();
    format!(
        r#"SELECT ep.entity_id FROM entity_properties ep
        WHERE ep.property_definition_id = '{assignees}'
          {entity_type}
          AND ep.values->'value' @> jsonb_build_array(jsonb_build_object('entity_id', {principal}))"#,
        assignees = SystemPropertyKey::ASSIGNEES_UUID,
    )
}

/// Keep membership in an uncorrelated indexed set; a direct OR scans accessible documents.
pub(super) fn document_predicate(expr: &Expr<DocumentLiteral>) -> Option<String> {
    let owner = document_owner(expr)?;
    let principal = sql_string_literal(&owner.principal_id());
    // A document that became a task can retain DOCUMENT property assignments.
    let assigned = assigned_ids(owner, None);
    Some(format!(
        r#"d.id = ANY(ARRAY(
        SELECT owned.id FROM "Document" owned
        WHERE owned.owner = {principal} AND owned."deletedAt" IS NULL
        UNION
        {assigned}
    ))"#,
    ))
}

pub(super) fn initiative_predicate(expr: &Expr<InitiativeLiteral>) -> Option<String> {
    let owner = initiative_owner(expr)?;
    let principal = sql_string_literal(&owner.principal_id());
    let assigned = assigned_ids(owner, Some(PropertyEntityType::Initiative));
    // Validate text property IDs before casting, without casting the indexed initiative key.
    Some(format!(
        r#"i.id = ANY(ARRAY(
        SELECT owned.id FROM initiative owned WHERE owned.owner_user_id = {principal}
        UNION
        SELECT CASE WHEN assigned.entity_id ~ '^[0-9a-fA-F]{{8}}-[0-9a-fA-F]{{4}}-[0-9a-fA-F]{{4}}-[0-9a-fA-F]{{4}}-[0-9a-fA-F]{{12}}$'
            THEN assigned.entity_id::uuid END
        FROM ({assigned} OFFSET 0) assigned
    ))"#,
    ))
}
