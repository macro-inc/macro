use super::{Filter, Literal, Query};

fn parse(name: &str, value: &str) -> Result<Query, crate::error::GraphError> {
    Query::parse(&[(name.to_string(), value.to_string())])
}

#[test]
fn the_filters_the_client_sends_parse() {
    let category = parse("$filter", "categories/any(c:c eq 'Bob''s list')").unwrap();
    assert_eq!(category.filter, Some(Filter::Category("Bob's list".into())));

    let property = parse(
        "$filter",
        "singleValueExtendedProperties/Any(ep: ep/id eq 'String {2f537ed4-4b85-4bbb-b231-b7f36d3769e2} Name MacroDraftId' and ep/value eq 'abc')",
    )
    .unwrap();
    assert_eq!(
        property.filter,
        Some(Filter::Property {
            id: "String {2f537ed4-4b85-4bbb-b231-b7f36d3769e2} Name MacroDraftId".into(),
            value: "abc".into(),
        })
    );

    let field = parse("$filter", "isRead eq false").unwrap();
    assert_eq!(
        field.filter,
        Some(Filter::Field {
            name: "isRead".into(),
            value: Literal::Bool(false),
        })
    );
}

#[test]
fn an_expand_names_the_extended_properties_to_return() {
    let query = parse(
        "$expand",
        "singleValueExtendedProperties($filter=id eq 'Integer 0x0E07' or id eq 'String 0x1042')",
    )
    .unwrap();
    assert_eq!(query.properties, vec!["Integer 0x0E07", "String 0x1042"]);
}

#[test]
fn what_the_emulator_cannot_evaluate_is_refused() {
    assert!(parse("$filter", "contains(subject,'x')").is_err());
    assert!(parse("$filter", "categories/any(c:d eq 'x')").is_err());
    assert!(parse("$expand", "attachments").is_err());
    assert!(parse("$search", "\"x\"").is_err());
    assert!(parse("$top", "many").is_err());
}
