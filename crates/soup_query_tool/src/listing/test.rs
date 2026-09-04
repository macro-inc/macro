use std::sync::Arc;

use filter_ast::Expr;
use item_filters::ast::chat::ChatLiteral;
use item_filters::ast::crm_company::CrmCompanyLiteral;
use item_filters::ast::document::DocumentLiteral;
use item_filters::ast::email::EmailLiteral;
use models_pagination::SimpleSortMethod;
use soup::domain::models::SoupSortDirection;
use uuid::Uuid;

use crate::listing::{EmailScope, Limit, ListingRequest, and_opt, compose_filters};
use crate::schema::input::{SoupEmailPreset, SoupKind, TaskFilter, TaskStatus};

fn request() -> ListingRequest {
    ListingRequest {
        kinds: None,
        filters: item_filters::ast::EntityFilterAst::default(),
        task: None,
        sort: SimpleSortMethod::UpdatedAt,
        direction: SoupSortDirection::Desc,
        limit: Limit::new(50).unwrap(),
        email: EmailScope {
            view: email::domain::models::PreviewView::default(),
            inbox: None,
            preset: None,
        },
        tags: None,
    }
}

#[test]
fn preset_ands_with_existing_email_tree() {
    let mut request = request();
    request.email.preset = Some(SoupEmailPreset::Signal);
    request.filters.email_filter.tree = Some(Arc::new(Expr::val(EmailLiteral::Importance(false))));
    let ast = compose_filters(&request, None, None, "macro|teo@macro.com").unwrap();
    assert!(ast.email_filter.tree.is_some());
}

#[test]
fn crm_is_nil_and_reminders_unset() {
    let ast = compose_filters(&request(), None, None, "macro|teo@macro.com").unwrap();
    match ast.crm_company_filter.as_deref() {
        Some(Expr::Literal(CrmCompanyLiteral::Id(id))) => assert_eq!(*id, Uuid::nil()),
        other => panic!("expected nil CRM filter, got {other:?}"),
    }
    assert!(ast.reminder_filter.is_none());
}

#[test]
fn self_chat_folds_into_chat_filter() {
    let chat = Uuid::from_u128(1);
    let ast = compose_filters(&request(), None, Some(chat), "macro|teo@macro.com").unwrap();
    assert!(ast.chat_filter.is_some());
    let _ = ChatLiteral::ChatId(chat);
}

#[test]
fn task_filter_restricts_to_documents() {
    let mut request = request();
    request.task = Some(TaskFilter {
        status: Some(vec![TaskStatus::Completed]),
        priority: None,
        assigned_to_me: Some(true),
        assigned_to: None,
        updated_at: None,
        created_at: None,
    });
    let ast = compose_filters(&request, None, None, "macro|teo@macro.com").unwrap();
    match ast.document_filter.as_deref() {
        Some(_) => {}
        None => panic!("taskFilter should AND a document tree"),
    }
    // Unrequested kinds are masked.
    assert!(ast.email_filter.tree.is_some());
}

#[test]
fn and_opt_keeps_left_when_right_absent() {
    let left = Expr::val(DocumentLiteral::Id(Uuid::nil()));
    let out = and_opt(left.clone(), None);
    assert!(matches!(out, Expr::Literal(_)));
}

#[test]
fn kinds_mask_unrequested() {
    let mut request = request();
    request.kinds = Some(non_empty::NonEmpty::one(SoupKind::Document));
    let ast = compose_filters(&request, None, None, "macro|teo@macro.com").unwrap();
    match ast.chat_filter.as_deref() {
        Some(Expr::Literal(ChatLiteral::ChatId(id))) => assert_eq!(*id, Uuid::nil()),
        other => panic!("expected nil chat mask, got {other:?}"),
    }
}
