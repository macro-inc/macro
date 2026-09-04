use std::sync::Arc;

use filter_ast::Expr;
use item_filters::ast::chat::ChatLiteral;
use item_filters::ast::crm_company::CrmCompanyLiteral;
use item_filters::ast::document::DocumentLiteral;
use item_filters::ast::email::EmailLiteral;
use item_filters::ast::properties::{PropertiesLiteral, PropertyMatchValue};
use system_properties::StatusOption;
use uuid::Uuid;

use super::*;

const USER: &str = "macro|teo@macro.com";

fn leaves<L: Clone>(expr: &Expr<L>, out: &mut Vec<L>) {
    match expr {
        Expr::Literal(literal) => out.push(literal.clone()),
        Expr::And(left, right) | Expr::Or(left, right) => {
            leaves(left, out);
            leaves(right, out);
        }
        Expr::Not(inner) => leaves(inner, out),
    }
}

#[test]
fn preset_ands_with_existing_email_tree() {
    let mut request = AgentListingRequest::default();
    request.email.preset = Some(EmailPreset::Signal);
    request.filters.email_filter.tree = Some(Arc::new(Expr::val(EmailLiteral::Importance(false))));
    let ast = compose_filters(&request, None, None, USER).unwrap();
    let mut literals = Vec::new();
    leaves(ast.email_filter.tree.as_deref().unwrap(), &mut literals);
    let importance: Vec<bool> = literals
        .iter()
        .filter_map(|literal| match literal {
            EmailLiteral::Importance(value) => Some(*value),
            _ => None,
        })
        .collect();
    assert!(importance.contains(&true), "preset importance missing");
    assert!(importance.contains(&false), "caller tree dropped");
}

#[test]
fn crm_is_nil_and_reminders_unset() {
    let ast = compose_filters(&AgentListingRequest::default(), None, None, USER).unwrap();
    match ast.crm_company_filter.as_deref() {
        Some(Expr::Literal(CrmCompanyLiteral::Id(id))) => assert_eq!(*id, Uuid::nil()),
        other => panic!("expected nil CRM filter, got {other:?}"),
    }
    assert!(ast.reminder_filter.is_none());
}

#[test]
fn self_chat_folds_into_chat_filter() {
    let chat = Uuid::from_u128(1);
    let ast = compose_filters(&AgentListingRequest::default(), None, Some(chat), USER).unwrap();
    let mut literals = Vec::new();
    leaves(ast.chat_filter.as_deref().unwrap(), &mut literals);
    assert!(
        matches!(literals.as_slice(), [ChatLiteral::ChatId(id)] if *id == chat),
        "expected only the self chat id, got {literals:?}"
    );
    assert!(matches!(ast.chat_filter.as_deref(), Some(Expr::Not(_))));
}

#[test]
fn task_selection_restricts_to_documents() {
    let mut request = AgentListingRequest::default();
    request.task = Some(TaskSelection {
        status: vec![StatusOption::Completed],
        assigned_to_me: true,
        ..TaskSelection::default()
    });
    let ast = compose_filters(&request, None, None, USER).unwrap();
    let mut documents = Vec::new();
    leaves(ast.document_filter.as_deref().unwrap(), &mut documents);
    assert!(
        documents.iter().any(|literal| matches!(
            literal,
            DocumentLiteral::SubType(document_sub_type::DocumentSubType::Task)
        )),
        "task sub type missing from {documents:?}"
    );
    // Unrequested kinds are masked.
    match ast.email_filter.tree.as_deref() {
        Some(Expr::Literal(EmailLiteral::ThreadId(id))) => assert_eq!(*id, Uuid::nil()),
        other => panic!("expected nil email mask, got {other:?}"),
    }
}

#[test]
fn bare_email_assignee_becomes_macro_ref() {
    let mut request = AgentListingRequest::default();
    request.task = Some(TaskSelection {
        assigned_to: vec!["Carol@Seed.macro.local".to_owned()],
        ..TaskSelection::default()
    });
    let ast = compose_filters(&request, None, None, USER).unwrap();
    let mut properties: Vec<PropertiesLiteral> = Vec::new();
    leaves(ast.properties_filter.as_deref().unwrap(), &mut properties);
    let [assignee] = properties.as_slice() else {
        panic!("expected one assignee literal, got {properties:?}");
    };
    let PropertyMatchValue::EntityRef(reference) = &assignee.value else {
        panic!("expected entity ref, got {assignee:?}");
    };
    assert_eq!(reference.to_string(), "macro|carol@seed.macro.local");
}

#[test]
fn explicit_macro_ref_assignee_is_kept() {
    let mut request = AgentListingRequest::default();
    request.task = Some(TaskSelection {
        assigned_to: vec!["macro|dave@seed.macro.local".to_owned()],
        ..TaskSelection::default()
    });
    let ast = compose_filters(&request, None, None, USER).unwrap();
    let mut properties: Vec<PropertiesLiteral> = Vec::new();
    leaves(ast.properties_filter.as_deref().unwrap(), &mut properties);
    let PropertyMatchValue::EntityRef(reference) = &properties[0].value else {
        panic!("expected entity ref");
    };
    assert_eq!(reference.to_string(), "macro|dave@seed.macro.local");
}

#[test]
fn preset_and_task_without_kinds_conflict() {
    let mut request = AgentListingRequest::default();
    request.email.preset = Some(EmailPreset::Signal);
    request.task = Some(TaskSelection::default());
    let err = compose_filters(&request, None, None, USER).unwrap_err();
    assert!(matches!(err, AgentListingError::ConflictingScopes));
}

#[test]
fn preset_and_task_with_kinds_is_allowed() {
    let mut request = AgentListingRequest::default();
    request.email.preset = Some(EmailPreset::Signal);
    request.task = Some(TaskSelection::default());
    request.kinds =
        Some(NonEmpty::new(vec![AgentSoupKind::Document, AgentSoupKind::EmailThread]).unwrap());
    compose_filters(&request, None, None, USER).unwrap();
}

#[test]
fn kinds_mask_unrequested() {
    let mut request = AgentListingRequest::default();
    request.kinds = Some(NonEmpty::one(AgentSoupKind::Document));
    let ast = compose_filters(&request, None, None, USER).unwrap();
    match ast.chat_filter.as_deref() {
        Some(Expr::Literal(ChatLiteral::ChatId(id))) => assert_eq!(*id, Uuid::nil()),
        other => panic!("expected nil chat mask, got {other:?}"),
    }
    assert!(ast.document_filter.is_none());
}

#[test]
fn limit_bounds() {
    assert!(Limit::new(0).is_err());
    assert!(Limit::new(501).is_err());
    assert_eq!(Limit::new(500).unwrap().get(), 500);
    assert_eq!(Limit::default().get(), 50);
}
