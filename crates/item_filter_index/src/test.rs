use std::sync::Arc;

use filter_ast::Expr;
use item_filters::ast::{
    CrmScope, EntityFilterAst,
    calendar_event::CalendarEventLiteral,
    call::CallLiteral,
    channel::{ChannelLiteral, ChannelThreadLiteral},
    crm_company::CrmCompanyLiteral,
    date::DateLiteral,
    document::DocumentLiteral,
    email::EmailLiteral,
    foreign_entity::ForeignEntityLiteral,
    properties::{PropertiesLiteral, PropertyMatchValue},
};
use predicate_index::{PredicateExpr, RangeBound};

use super::*;

fn request() -> SoupFlatRequest {
    SoupFlatRequest {
        sort: SoupIndexSort::UpdatedAt,
        direction: SortDirection::Desc,
        limit: 20,
        has_cursor: false,
    }
}

fn excluded_deferred_partitions() -> EntityFilterAst {
    let mut ast = EntityFilterAst::default();
    ast.calendar_event_filter = Some(Arc::new(Expr::val(CalendarEventLiteral::Id(Uuid::nil()))));
    ast.email_filter.tree = Some(Arc::new(Expr::val(EmailLiteral::ThreadId(Uuid::nil()))));
    ast.channel_filter = Some(Arc::new(Expr::val(ChannelLiteral::ChannelId(Uuid::nil()))));
    ast.channel_thread_filter = Some(Arc::new(Expr::val(ChannelThreadLiteral::ThreadId(
        Uuid::nil(),
    ))));
    ast.call_filter = Some(Arc::new(Expr::val(CallLiteral::CallId(Uuid::nil()))));
    ast.crm_company_filter = Some(Arc::new(Expr::val(CrmCompanyLiteral::Id(Uuid::nil()))));
    ast.foreign_entity_filter = Some(Arc::new(Expr::val(ForeignEntityLiteral::Id(Uuid::nil()))));
    ast
}

#[test]
fn compiles_complete_supported_forest_after_eligibility() {
    let id = Uuid::from_u128(1);
    let timestamp = chrono::DateTime::parse_from_rfc3339("2026-01-01T00:00:00.123456Z")
        .unwrap()
        .to_utc();
    let mut ast = excluded_deferred_partitions();
    ast.document_filter = Some(Arc::new(Expr::and(
        Expr::val(DocumentLiteral::Id(id)),
        Expr::is_not(Expr::val(DocumentLiteral::UpdatedAt(
            DateLiteral::LessThan(timestamp),
        ))),
    )));

    let LocalCompileOutcome::Supported(query) = compile_soup_flat_v1(&ast, request()).unwrap()
    else {
        panic!("supported request fell back")
    };
    let document = &query.as_query().partitions[0].predicate;
    assert!(matches!(
        document,
        PredicateExpr::And(left, right)
            if matches!(left.as_ref(), PredicateExpr::Exact { attribute, value }
                if attribute == &vocabulary::id() && value.as_bytes() == id.as_bytes())
                && matches!(right.as_ref(), PredicateExpr::Not(expr)
                    if matches!(expr.as_ref(), PredicateExpr::I64Range {
                        attribute,
                        lower: None,
                        upper: Some(RangeBound::Exclusive(_)),
                    } if attribute == &vocabulary::updated_at()))
    ));
}

#[test]
fn unsupported_supported_partition_literals_never_disappear() {
    for expression in [
        Expr::and(
            Expr::val(DocumentLiteral::Id(Uuid::nil())),
            Expr::val(DocumentLiteral::Importance(true)),
        ),
        Expr::or(
            Expr::val(DocumentLiteral::Id(Uuid::nil())),
            Expr::val(DocumentLiteral::Importance(true)),
        ),
        Expr::is_not(Expr::val(DocumentLiteral::Importance(true))),
    ] {
        let mut ast = excluded_deferred_partitions();
        ast.document_filter = Some(Arc::new(expression));
        assert_eq!(
            compile_soup_flat_v1(&ast, request()).unwrap(),
            LocalCompileOutcome::Unsupported(UnsupportedReason::Literal("document"))
        );
    }
}

#[test]
fn unsupported_partition_is_empty_only_for_conservative_positive_nil_shapes() {
    let unsupported = Expr::val(ChannelLiteral::Importance(true));
    for (expression, supported) in [
        (
            Expr::and(
                Expr::val(ChannelLiteral::ChannelId(Uuid::nil())),
                unsupported.clone(),
            ),
            true,
        ),
        (
            Expr::or(
                Expr::val(ChannelLiteral::ChannelId(Uuid::nil())),
                unsupported.clone(),
            ),
            false,
        ),
        (
            Expr::is_not(Expr::val(ChannelLiteral::ChannelId(Uuid::nil()))),
            false,
        ),
    ] {
        let mut ast = excluded_deferred_partitions();
        ast.channel_filter = Some(Arc::new(expression));
        assert_eq!(
            check_soup_flat_v1(&ast, request()),
            if supported {
                Eligibility::Supported
            } else {
                Eligibility::Unsupported(UnsupportedReason::Partition("channel"))
            }
        );
    }
}

#[test]
fn every_deferred_partition_must_be_proven_empty() {
    let mut ast = excluded_deferred_partitions();
    ast.call_filter = None;
    assert_eq!(
        check_soup_flat_v1(&ast, request()),
        Eligibility::Unsupported(UnsupportedReason::Partition("call"))
    );

    let mut ast = excluded_deferred_partitions();
    ast.reminder_filter = Some(Arc::new(Expr::val(
        item_filters::ast::reminder::ReminderLiteral::Include,
    )));
    assert_eq!(
        check_soup_flat_v1(&ast, request()),
        Eligibility::Unsupported(UnsupportedReason::Partition("reminder"))
    );

    let mut ast = excluded_deferred_partitions();
    ast.properties_filter = Some(Arc::new(Expr::val(PropertiesLiteral {
        property_definition_id: Uuid::nil(),
        entity_type: None,
        value: PropertyMatchValue::SelectOption(Uuid::nil()),
    })));
    assert_eq!(
        check_soup_flat_v1(&ast, request()),
        Eligibility::Unsupported(UnsupportedReason::GlobalProperties)
    );

    let mut ast = excluded_deferred_partitions();
    ast.email_filter.tree = None;
    ast.email_filter.crm_scope = Some(CrmScope::Domains(vec!["example.com".to_owned()]));
    assert_eq!(
        check_soup_flat_v1(&ast, request()),
        Eligibility::Unsupported(UnsupportedReason::Partition("email"))
    );
}

#[test]
fn unsupported_options_fail_before_generic_compilation() {
    let ast = excluded_deferred_partitions();
    assert_eq!(
        compile_soup_flat_v1(
            &ast,
            SoupFlatRequest {
                sort: SoupIndexSort::Unsupported,
                ..request()
            }
        )
        .unwrap(),
        LocalCompileOutcome::Unsupported(UnsupportedReason::Sort)
    );
    assert_eq!(
        compile_soup_flat_v1(
            &ast,
            SoupFlatRequest {
                has_cursor: true,
                ..request()
            }
        )
        .unwrap(),
        LocalCompileOutcome::Unsupported(UnsupportedReason::Cursor)
    );
}

#[test]
fn invalid_limit_is_a_validation_error_not_unsupported() {
    let ast = excluded_deferred_partitions();
    assert_eq!(
        compile_soup_flat_v1(
            &ast,
            SoupFlatRequest {
                limit: 0,
                ..request()
            }
        ),
        Err(CompileError::Validation(ValidationError::Limit(0)))
    );
}
