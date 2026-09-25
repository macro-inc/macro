use super::*;
use item_filters::ast::channel::{ChannelLiteral, ChannelThreadLiteral};
use item_filters::ast::foreign_entity::ForeignEntityLiteral;
use models_pagination::CursorVal;

#[derive(Clone, Copy, Debug)]
enum Leg {
    Email,
    Channel,
    ChannelThread,
    Call,
    ForeignEntity,
}

const LEGS: [Leg; 5] = [
    Leg::Email,
    Leg::Channel,
    Leg::ChannelThread,
    Leg::Call,
    Leg::ForeignEntity,
];

fn map_ids<T>(tree: &Expr<Uuid>, literal: impl Fn(Uuid) -> T) -> Arc<Expr<T>> {
    Arc::new(tree.collapse_frames(|frame| match frame {
        filter_ast::ExprFrame::And(a, b) => Expr::and(a, b),
        filter_ast::ExprFrame::Or(a, b) => Expr::or(a, b),
        filter_ast::ExprFrame::Not(a) => Expr::is_not(a),
        filter_ast::ExprFrame::Literal(id) => Expr::val(literal(id)),
    }))
}

fn filter_for(leg: Leg, tree: &Expr<Uuid>) -> EntityFilterAst {
    let mut filter = EntityFilterAst::default();
    match leg {
        Leg::Email => filter.email_filter.tree = Some(map_ids(tree, EmailLiteral::ThreadId)),
        Leg::Channel => filter.channel_filter = Some(map_ids(tree, ChannelLiteral::ChannelId)),
        Leg::ChannelThread => {
            filter.channel_thread_filter = Some(map_ids(tree, ChannelThreadLiteral::ThreadId));
        }
        Leg::Call => filter.call_filter = Some(map_ids(tree, CallLiteral::CallId)),
        Leg::ForeignEntity => {
            filter.foreign_entity_filter = Some(map_ids(tree, ForeignEntityLiteral::Id));
        }
    }
    filter
}

fn request<T>(filter: T, follow_up: bool) -> SoupRequest<T> {
    let cursor = if follow_up {
        Query::Cursor(CursorWithValAndFilter {
            id: id(2),
            limit: 50,
            val: CursorVal {
                sort_type: SimpleSortMethod::UpdatedAt,
                last_val: chrono::DateTime::from_timestamp(1_700_000_000, 0).unwrap(),
            },
            filter,
        })
    } else {
        Query::Sort(SimpleSortMethod::UpdatedAt, filter)
    };
    SoupRequest {
        soup_type: SoupType::Expanded,
        limit: 50,
        cursor: SoupQuery::Simple(SimpleQueryInner(cursor)),
        sort_direction: SoupSortDirection::Desc,
        user: MacroUserIdStr::parse_from_str("macro|user@test.com").unwrap(),
        email_preview_view: PreviewView::default(),
        link_ids: vec![id(3)],
    }
}

fn builds_request(leg: Leg, request: &SoupRequest<Option<EntityFilterAst>>) -> bool {
    match leg {
        Leg::Email => request.build_email_request(None).is_some(),
        Leg::Channel => request.build_comms_request().is_some(),
        Leg::ChannelThread => request.build_comms_thread_request().is_some(),
        Leg::Call => request.build_call_request().is_some(),
        Leg::ForeignEntity => request.build_foreign_entity_query().is_some(),
    }
}

#[test]
fn nil_entity_ids_skip_domain_requests_on_initial_and_cursor_pages() {
    for leg in LEGS {
        for follow_up in [false, true] {
            let req = request(Some(filter_for(leg, &Expr::val(Uuid::nil()))), follow_up);
            assert!(
                !builds_request(leg, &req),
                "excluded {leg:?} must not call its service (follow_up={follow_up})"
            );
        }
    }
}

#[test]
fn legacy_rest_exclusions_skip_requests_after_ast_expansion() {
    let nil = Uuid::nil().to_string();
    let filters: EntityFilters = serde_json::from_value(serde_json::json!({
        "email_filters": { "email_thread_ids": [nil] },
        "channel_filters": { "channel_ids": [nil] },
        "channel_thread_filters": { "thread_ids": [nil] },
        "call_filters": { "call_ids": [nil] },
        "foreign_entity_filters": { "ids": [nil] }
    }))
    .unwrap();
    for follow_up in [false, true] {
        let req = request(filters.clone(), follow_up).into_ast().unwrap();
        for leg in LEGS {
            assert!(!builds_request(leg, &req), "excluded REST leg {leg:?}");
        }
    }
}

#[test]
fn absent_filters_and_real_entity_ids_keep_domain_requests() {
    for leg in LEGS {
        for follow_up in [false, true] {
            for filter in [None, Some(filter_for(leg, &Expr::val(id(1))))] {
                assert!(builds_request(leg, &request(filter, follow_up)), "{leg:?}");
            }
        }
    }
}

#[test]
fn exclusion_respects_and_or_and_not_without_dropping_possible_matches() {
    let excluded = Expr::val(Uuid::nil());
    let included = Expr::val(id(1));
    let cases = [
        (Expr::and(excluded.clone(), included.clone()), false),
        (Expr::and(included.clone(), excluded.clone()), false),
        (Expr::or(excluded.clone(), excluded.clone()), false),
        (Expr::or(excluded.clone(), included.clone()), true),
        (Expr::or(included.clone(), excluded.clone()), true),
        (Expr::is_not(excluded.clone()), true),
        (Expr::is_not(included), true),
        // Negations are deliberately not simplified: pruning is conservative.
        (Expr::is_not(Expr::is_not(excluded)), true),
    ];
    for leg in LEGS {
        for (tree, expected) in &cases {
            for follow_up in [false, true] {
                let req = request(Some(filter_for(leg, tree)), follow_up);
                assert_eq!(
                    builds_request(leg, &req),
                    *expected,
                    "{leg:?}: {tree:?} (follow_up={follow_up})"
                );
            }
        }
    }
}

#[test]
fn crm_scoped_email_exclusions_preserve_authorization_prechecks() {
    for scope in [
        item_filters::ast::CrmScope::Domains(vec!["example.com".to_string()]),
        item_filters::ast::CrmScope::Addresses(vec!["contact@example.com".to_string()]),
    ] {
        let mut filter = filter_for(Leg::Email, &Expr::val(Uuid::nil()));
        filter.email_filter.crm_scope = Some(scope);
        for follow_up in [false, true] {
            let req = request(Some(filter.clone()), follow_up);
            let email = req
                .build_email_request(None)
                .expect("email service must still validate the CRM scope");
            assert!(email.crm_scope.is_some());
        }
    }
}

#[test]
fn exclusion_only_skips_the_targeted_entity_type() {
    for excluded_leg in LEGS {
        let req = request(
            Some(filter_for(excluded_leg, &Expr::val(Uuid::nil()))),
            false,
        );
        let built = LEGS.map(|leg| builds_request(leg, &req));
        assert_eq!(built.into_iter().filter(|built| *built).count(), 4);
    }
}

#[test]
fn notified_hydration_legs_also_skip_excluded_entities() {
    for leg in [
        Leg::Email,
        Leg::Channel,
        Leg::ChannelThread,
        Leg::ForeignEntity,
    ] {
        for tree in [Expr::val(Uuid::nil()), Expr::val(id(1))] {
            let expected = matches!(&tree, Expr::Literal(id) if !id.is_nil());
            let filter = Some(filter_for(leg, &tree));
            let mut req = request(None, false);
            req.cursor = SoupQuery::Notified(NotifiedQueryInner(Query::Sort(NotifiedAt, filter)));
            assert_eq!(builds_request(leg, &req), expected, "{leg:?}: {tree:?}");
        }
    }
}
