use async_graphql::{EmptySubscription, Schema, parser::types::TypeSystemDefinition};
use macro_user_id::user_id::MacroUserIdStr;

use crate::{CalendarMutationRoot, GraphqlCalendarQuery};

#[test]
fn calendar_types_match_the_shared_schema() {
    let generated = Schema::build(
        GraphqlCalendarQuery::new(
            MacroUserIdStr::parse_from_str("macro|viewer@example.com").unwrap(),
        ),
        CalendarMutationRoot,
        EmptySubscription,
    )
    .finish()
    .sdl();
    let shared = include_str!("../../../static_assets/schema.graphql");
    let document = async_graphql::parser::parse_schema(&generated).unwrap();

    for definition in document.definitions {
        let TypeSystemDefinition::Type(definition) = definition else {
            continue;
        };
        let name = definition.node.name.node.as_str();
        if matches!(
            name,
            "GraphqlCalendarQuery" | "CalendarMutationRoot" | "Boolean" | "String" | "Int" | "ID"
        ) {
            continue;
        }
        assert_eq!(
            type_definition(&generated, name),
            type_definition(shared, name),
            "calendar contract differs for {name}"
        );
    }
}

fn type_definition<'a>(sdl: &'a str, name: &str) -> &'a str {
    for kind in ["type", "enum", "input", "union"] {
        let header = format!("\n{kind} {name} ");
        if let Some(start) = sdl.find(&header) {
            let definition = &sdl[start + 1..];
            if kind == "union" {
                return definition.lines().next().unwrap();
            }
            let end = definition.find("\n}").expect("definition closing brace");
            return &definition[..end + 2];
        }
    }
    panic!("missing calendar type {name}");
}
