use super::*;
use filter_ast::Expr;
use item_filters::ast::{
    EmailFilterAst,
    calendar_event::CalendarEventLiteral,
    call::CallLiteral,
    channel::{ChannelLiteral, ChannelThreadLiteral},
    chat::ChatLiteral,
    crm_company::CrmCompanyLiteral,
    document::DocumentLiteral,
    email::EmailLiteral,
    foreign_entity::ForeignEntityLiteral,
    project::ProjectLiteral,
};
use std::sync::Arc;

#[test]
fn frontend_task_scope_accepts_disabled_non_task_legs() {
    let ast = EntityFilterAst {
        document_filter: Some(Arc::new(Expr::val(DocumentLiteral::SubType(
            document_sub_type::DocumentSubType::Task,
        )))),
        calendar_event_filter: Some(Arc::new(Expr::val(CalendarEventLiteral::Id(Uuid::nil())))),
        project_filter: Some(Arc::new(Expr::val(ProjectLiteral::ProjectIdSelf(
            Uuid::nil(),
        )))),
        chat_filter: Some(Arc::new(Expr::val(ChatLiteral::ChatId(Uuid::nil())))),
        email_filter: EmailFilterAst {
            tree: Some(Arc::new(Expr::val(EmailLiteral::ThreadId(Uuid::nil())))),
            ..Default::default()
        },
        channel_filter: Some(Arc::new(Expr::val(ChannelLiteral::ChannelId(Uuid::nil())))),
        channel_thread_filter: Some(Arc::new(Expr::val(ChannelThreadLiteral::ThreadId(
            Uuid::nil(),
        )))),
        call_filter: Some(Arc::new(Expr::val(CallLiteral::CallId(Uuid::nil())))),
        crm_company_filter: Some(Arc::new(Expr::val(CrmCompanyLiteral::Id(Uuid::nil())))),
        foreign_entity_filter: Some(Arc::new(Expr::val(ForeignEntityLiteral::Id(Uuid::nil())))),
        ..Default::default()
    };
    assert!(validate_filter(Some(&ast), SoupType::Expanded, false).is_ok());
}

#[test]
fn nil_exclusions_do_not_hide_active_disjunctions_or_negations() {
    let nil = Expr::val(ProjectLiteral::ProjectIdSelf(Uuid::nil()));
    let active = Expr::val(ProjectLiteral::ProjectIdSelf(Uuid::from_u128(2)));
    let mut ast = EntityFilterAst {
        project_filter: Some(Arc::new(Expr::or(nil.clone(), active.clone()))),
        ..Default::default()
    };
    assert!(validate_filter(Some(&ast), SoupType::Expanded, false).is_err());
    ast.project_filter = Some(Arc::new(Expr::is_not(nil.clone())));
    assert!(validate_filter(Some(&ast), SoupType::Expanded, false).is_err());
    ast.project_filter = Some(Arc::new(Expr::and(nil, active)));
    assert!(validate_filter(Some(&ast), SoupType::Expanded, false).is_ok());
}
