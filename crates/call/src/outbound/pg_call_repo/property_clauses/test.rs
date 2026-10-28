use filter_ast::Expr;
use item_filters::ast::{
    call::CallLiteral,
    properties::{EntityRefId, PropertiesLiteral, PropertyMatchValue},
};
use uuid::Uuid;

use super::*;

const COMPANIES: Uuid = Uuid::from_u128(0x00000001_0000_0000_0000_00000000000c);
const TAGS: Uuid = Uuid::from_u128(0x0198a1b2_c3d4_7e5f_8061_728394a5b7ff);

fn company(id: &str) -> Expr<CallLiteral> {
    Expr::Literal(CallLiteral::Property(PropertiesLiteral {
        property_definition_id: COMPANIES,
        entity_type: None,
        value: PropertyMatchValue::EntityRef(EntityRefId::new(id.to_string()).unwrap()),
    }))
}

fn tag(option: u128) -> Expr<CallLiteral> {
    Expr::Literal(CallLiteral::Property(PropertiesLiteral {
        property_definition_id: TAGS,
        entity_type: None,
        value: PropertyMatchValue::SelectOption(Uuid::from_u128(option)),
    }))
}

fn has(id: &str) -> PropertyTerm {
    PropertyTerm {
        condition: PropertyCondition::EntityRef {
            definition: COMPANIES,
            entity_id: id.to_string(),
        },
        negated: false,
    }
}

fn lacks(id: &str) -> PropertyTerm {
    PropertyTerm {
        negated: true,
        ..has(id)
    }
}

fn tagged(option: u128) -> PropertyTerm {
    PropertyTerm {
        condition: PropertyCondition::Tag(Uuid::from_u128(option).to_string()),
        negated: false,
    }
}

fn clauses_of(expr: Expr<CallLiteral>) -> Vec<Vec<PropertyTerm>> {
    property_clauses(&Some(std::sync::Arc::new(expr)))
}

#[test]
fn keeps_and_or_and_not_structure() {
    assert_eq!(clauses_of(company("a")), vec![vec![has("a")]]);
    assert_eq!(
        clauses_of(Expr::or(company("a"), company("b"))),
        vec![vec![has("a"), has("b")]]
    );
    assert_eq!(
        clauses_of(Expr::and(company("a"), company("b"))),
        vec![vec![has("a")], vec![has("b")]]
    );
    assert_eq!(
        clauses_of(Expr::is_not(company("a"))),
        vec![vec![lacks("a")]]
    );
    // De Morgan: NOT (a AND b) = NOT a OR NOT b.
    assert_eq!(
        clauses_of(Expr::is_not(Expr::and(company("a"), company("b")))),
        vec![vec![lacks("a"), lacks("b")]]
    );
    // (a AND b) OR c distributes into (a OR c) AND (b OR c).
    assert_eq!(
        clauses_of(Expr::or(
            Expr::and(company("a"), company("b")),
            company("c")
        )),
        vec![vec![has("a"), has("c")], vec![has("b"), has("c")]]
    );
}

#[test]
fn tags_keep_any_and_all_semantics() {
    // ANY: options ORed together.
    assert_eq!(
        clauses_of(Expr::or(tag(1), tag(2))),
        vec![vec![tagged(1), tagged(2)]]
    );
    // ALL: options ANDed together, even next to a channel filter.
    let channel = Expr::Literal(CallLiteral::ChannelId(Uuid::from_u128(9)));
    assert_eq!(
        clauses_of(Expr::and(channel, Expr::and(tag(1), tag(2)))),
        vec![vec![tagged(1)], vec![tagged(2)]]
    );
}

#[test]
fn a_tag_or_a_reference_is_one_clause() {
    assert_eq!(
        clauses_of(Expr::or(tag(1), company("a"))),
        vec![vec![tagged(1), has("a")]]
    );
}

#[test]
fn other_call_literals_leave_properties_unconstrained() {
    let channel = || Expr::Literal(CallLiteral::ChannelId(Uuid::nil()));
    // ANDed in, as soup folds properties into the call filter.
    assert_eq!(
        clauses_of(Expr::and(channel(), company("a"))),
        vec![vec![has("a")]]
    );
    assert!(clauses_of(Expr::or(channel(), company("a"))).is_empty());
    assert!(clauses_of(channel()).is_empty());
    assert!(property_clauses(&None).is_empty());
}

#[test]
fn flattens_clauses_into_query_parameters() {
    let params = clause_params(&[vec![tagged(1), has("a")], vec![lacks("b")]]);

    assert_eq!(
        params,
        PropertyClauseParams {
            clause_count: 2,
            clause_indices: vec![0, 0, 1],
            negated: vec![false, false, true],
            definition_ids: vec![None, Some(COMPANIES), Some(COMPANIES)],
            values: vec![
                Uuid::from_u128(1).to_string(),
                "a".to_string(),
                "b".to_string()
            ],
        }
    );
}

#[test]
fn oversized_filters_drop_their_property_conditions() {
    // 9 nested ORs of two-term ANDs expand to 2^9 = 512 clauses.
    let expr = (0..9).fold(company("seed"), |acc, i| {
        Expr::or(
            acc,
            Expr::and(company(&format!("x{i}")), company(&format!("y{i}"))),
        )
    });
    assert!(clauses_of(expr).is_empty());
}
