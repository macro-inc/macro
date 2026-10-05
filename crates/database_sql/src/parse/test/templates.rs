use super::*;
use crate::parse::schema::SchemaStatement;

#[test]
fn database_creation_parses_a_template_without_changing_the_blank_form() {
    for (sql, template) in [
        ("CREATE DATABASE \"Launch plan\"", None),
        (
            "CREATE DATABASE \"Launch plan\" TEMPLATE project_tracker;",
            Some("project_tracker"),
        ),
        (
            "create database \"Launch plan\" template \"reading_list\"",
            Some("reading_list"),
        ),
    ] {
        assert_eq!(
            parse_schema(sql).unwrap(),
            Some(SchemaStatement::CreateDatabase {
                name: Identifier("Launch plan".into()),
                template: template.map(|slug| Identifier(slug.into())),
            }),
        );
    }
    for sql in [
        "CREATE DATABASE Launch TEMPLATE",
        "CREATE DATABASE Launch TEMPLATE reading_list extra",
        "CREATE DATABASE Launch TEMPLATE reading_list; DROP TABLE Books",
    ] {
        assert!(parse_schema(sql).is_err(), "{sql}");
    }
}
