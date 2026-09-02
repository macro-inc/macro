use std::sync::Arc;

use document_sub_type::DocumentSubType;
use filter_ast::Expr;
use item_filters::ast::{
    CrmScope, EntityFilterAst,
    calendar_event::CalendarEventLiteral,
    call::CallLiteral,
    channel::{ChannelLiteral, ChannelThreadLiteral},
    chat::ChatLiteral,
    crm_company::CrmCompanyLiteral,
    date::DateLiteral,
    document::DocumentLiteral,
    email::EmailLiteral,
    foreign_entity::ForeignEntityLiteral,
    project::ProjectLiteral,
    properties::{PropertiesLiteral, PropertyEntityType, PropertyMatchValue},
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
    let mut ast = EntityFilterAst {
        calendar_event_filter: Some(Arc::new(Expr::val(CalendarEventLiteral::Id(Uuid::nil())))),
        channel_filter: Some(Arc::new(Expr::val(ChannelLiteral::ChannelId(Uuid::nil())))),
        channel_thread_filter: Some(Arc::new(Expr::val(ChannelThreadLiteral::ThreadId(
            Uuid::nil(),
        )))),
        call_filter: Some(Arc::new(Expr::val(CallLiteral::CallId(Uuid::nil())))),
        crm_company_filter: Some(Arc::new(Expr::val(CrmCompanyLiteral::Id(Uuid::nil())))),
        foreign_entity_filter: Some(Arc::new(Expr::val(ForeignEntityLiteral::Id(Uuid::nil())))),
        ..EntityFilterAst::default()
    };
    ast.email_filter.tree = Some(Arc::new(Expr::val(EmailLiteral::ThreadId(Uuid::nil()))));
    ast
}

fn excluded_non_document_local_partitions(ast: &mut EntityFilterAst) {
    ast.project_filter = Some(Arc::new(Expr::val(ProjectLiteral::ProjectIdSelf(
        Uuid::nil(),
    ))));
    ast.chat_filter = Some(Arc::new(Expr::val(ChatLiteral::ChatId(Uuid::nil()))));
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
fn production_documents_membership_literals_require_and_compile_in_v2() {
    for literal in [
        DocumentLiteral::IsEmailAttachment(false),
        DocumentLiteral::IsEmailAttachment(true),
        DocumentLiteral::SubType(DocumentSubType::Task),
        DocumentLiteral::SubType(DocumentSubType::Snippet),
        DocumentLiteral::SubType(DocumentSubType::Skill),
    ] {
        let mut ast = excluded_deferred_partitions();
        ast.document_filter = Some(Arc::new(Expr::val(literal)));
        assert_eq!(
            compile_soup_flat_v1(&ast, request()).unwrap(),
            LocalCompileOutcome::Unsupported(UnsupportedReason::Literal("document"))
        );
        let LocalCompileOutcome::Supported(query) = compile_soup_flat_v2(&ast, request()).unwrap()
        else {
            panic!("v2 document membership literal fell back");
        };
        assert_eq!(query.as_query().profile, vocabulary::profile_v2());
    }
}

#[test]
fn v2_subtype_and_attachment_preserve_direct_and_or_not_shapes() {
    let mut ast = excluded_deferred_partitions();
    ast.document_filter = Some(Arc::new(Expr::and(
        Expr::val(DocumentLiteral::SubType(DocumentSubType::Task)),
        Expr::or(
            Expr::val(DocumentLiteral::IsEmailAttachment(true)),
            Expr::is_not(Expr::val(DocumentLiteral::SubType(
                DocumentSubType::Snippet,
            ))),
        ),
    )));

    let LocalCompileOutcome::Supported(query) = compile_soup_flat_v2(&ast, request()).unwrap()
    else {
        panic!("supported v2 Boolean tree fell back");
    };
    assert_eq!(
        query.as_query().partitions[0].predicate,
        PredicateExpr::And(
            Box::new(PredicateExpr::Exact {
                attribute: vocabulary::document_sub_type(),
                value: ExactValue::utf8("task").unwrap(),
            }),
            Box::new(PredicateExpr::Or(
                Box::new(PredicateExpr::Exact {
                    attribute: vocabulary::email_attachment(),
                    value: ExactValue::new([1]).unwrap(),
                }),
                Box::new(PredicateExpr::Not(Box::new(PredicateExpr::Exact {
                    attribute: vocabulary::document_sub_type(),
                    value: ExactValue::utf8("snippet").unwrap(),
                }))),
            )),
        )
    );

    let mut ast = excluded_deferred_partitions();
    ast.document_filter = Some(Arc::new(Expr::val(DocumentLiteral::IsEmailAttachment(
        false,
    ))));
    let LocalCompileOutcome::Supported(query) = compile_soup_flat_v2(&ast, request()).unwrap()
    else {
        panic!("direct v2 attachment literal fell back");
    };
    assert_eq!(
        query.as_query().partitions[0].predicate,
        PredicateExpr::Exact {
            attribute: vocabulary::email_attachment(),
            value: ExactValue::new([0]).unwrap(),
        }
    );
}

#[test]
fn v3_compiles_my_tasks_importance_and_status_membership() {
    assert_eq!(
        STATUS_PROPERTY_DEFINITION_ID,
        system_properties::SystemPropertyKey::STATUS_UUID
    );

    let not_started = Uuid::from_u128(11);
    let in_progress = Uuid::from_u128(12);
    let mut ast = excluded_deferred_partitions();
    excluded_non_document_local_partitions(&mut ast);
    ast.document_filter = Some(Arc::new(Expr::and(
        Expr::val(DocumentLiteral::SubType(DocumentSubType::Task)),
        Expr::val(DocumentLiteral::Importance(true)),
    )));
    ast.properties_filter = Some(Arc::new(Expr::or(
        Expr::val(PropertiesLiteral {
            property_definition_id: STATUS_PROPERTY_DEFINITION_ID,
            entity_type: None,
            value: PropertyMatchValue::SelectOption(not_started),
        }),
        Expr::val(PropertiesLiteral {
            property_definition_id: STATUS_PROPERTY_DEFINITION_ID,
            entity_type: Some(PropertyEntityType::Task),
            value: PropertyMatchValue::SelectOption(in_progress),
        }),
    )));

    assert_eq!(
        compile_soup_flat_v2(&ast, request()).unwrap(),
        LocalCompileOutcome::Unsupported(UnsupportedReason::GlobalProperties)
    );
    let LocalCompileOutcome::Supported(query) = compile_soup_flat_v3(&ast, request()).unwrap()
    else {
        panic!("My Tasks v3 request fell back");
    };
    assert_eq!(query.as_query().profile, vocabulary::profile_v3());
    let document = &query.as_query().partitions[0].predicate;
    assert!(format!("{document:?}").contains("importance"));
    assert!(format!("{document:?}").contains("task-status-option"));
}

#[test]
fn v3_rejects_non_status_properties_and_unrestricted_local_partitions() {
    for importance in [
        Expr::val(DocumentLiteral::Importance(false)),
        Expr::is_not(Expr::val(DocumentLiteral::Importance(true))),
    ] {
        let mut ast = excluded_deferred_partitions();
        ast.document_filter = Some(Arc::new(importance));
        assert_eq!(
            check_soup_flat_v3(&ast, request()),
            Eligibility::Unsupported(UnsupportedReason::Literal("document"))
        );
    }

    let mut ast = excluded_deferred_partitions();
    ast.properties_filter = Some(Arc::new(Expr::val(PropertiesLiteral {
        property_definition_id: Uuid::from_u128(99),
        entity_type: None,
        value: PropertyMatchValue::SelectOption(Uuid::from_u128(1)),
    })));
    excluded_non_document_local_partitions(&mut ast);
    assert_eq!(
        check_soup_flat_v3(&ast, request()),
        Eligibility::Unsupported(UnsupportedReason::GlobalProperties)
    );

    ast.properties_filter = Some(Arc::new(Expr::val(PropertiesLiteral {
        property_definition_id: STATUS_PROPERTY_DEFINITION_ID,
        entity_type: None,
        value: PropertyMatchValue::SelectOption(Uuid::from_u128(1)),
    })));
    ast.project_filter = None;
    assert_eq!(
        check_soup_flat_v3(&ast, request()),
        Eligibility::Unsupported(UnsupportedReason::GlobalProperties)
    );
}

#[test]
fn unsupported_supported_partition_literals_force_v1_and_v2_network_fallback() {
    for expression in [
        Expr::and(
            Expr::val(DocumentLiteral::IsEmailAttachment(false)),
            Expr::val(DocumentLiteral::Importance(true)),
        ),
        Expr::or(
            Expr::val(DocumentLiteral::SubType(DocumentSubType::Task)),
            Expr::val(DocumentLiteral::Importance(true)),
        ),
        Expr::is_not(Expr::val(DocumentLiteral::Importance(true))),
    ] {
        let mut ast = excluded_deferred_partitions();
        ast.document_filter = Some(Arc::new(expression));
        for outcome in [
            compile_soup_flat_v1(&ast, request()).unwrap(),
            compile_soup_flat_v2(&ast, request()).unwrap(),
        ] {
            assert_eq!(
                outcome,
                LocalCompileOutcome::Unsupported(UnsupportedReason::Literal("document"))
            );
        }
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
