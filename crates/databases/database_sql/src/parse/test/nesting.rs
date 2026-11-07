use crate::parse::parse;

#[test]
fn excessive_condition_nesting_returns_an_error() {
    let depth = 2_048;
    let sql = format!(
        "SELECT * FROM deals WHERE {}amount = 1{}",
        "(".repeat(depth),
        ")".repeat(depth)
    );
    let error = parse(&sql).expect_err("excessive nesting must be refused before parsing");
    assert!(error.message.contains("nesting"), "{error}");
}

#[test]
fn condition_nesting_limit_reports_the_first_excessive_parenthesis() {
    for prefix in [
        "SELECT * FROM deals WHERE ",
        "UPDATE deals SET amount = 2 WHERE ",
        "DELETE FROM deals WHERE ",
    ] {
        for closing in [")".repeat(65), String::new()] {
            let sql = format!("{prefix}{}amount = 1{closing}", "(".repeat(65));
            let error = parse(&sql).expect_err("the 65th nested condition is refused");
            assert_eq!(error.span, prefix.len() + 64..prefix.len() + 65);
            assert_eq!(
                error.message,
                "SQL nesting exceeds 64 levels; simplify the condition"
            );
        }
    }
}

#[test]
fn supported_nesting_and_quoted_parentheses_still_parse() {
    let nested = format!(
        "SELECT * FROM deals WHERE {}amount = 1{}",
        "(".repeat(64),
        ")".repeat(64)
    );
    assert!(parse(&nested).is_ok());
    let quoted = format!(
        "SELECT \"{}\" FROM deals WHERE name = '{}'",
        "(".repeat(2_048),
        ")".repeat(2_048)
    );
    assert!(parse(&quoted).is_ok());
    let flat = format!(
        "SELECT * FROM deals WHERE {}",
        vec!["(amount = 1)"; 2_048].join(" OR ")
    );
    assert!(parse(&flat).is_ok());
}

#[test]
fn repeated_not_keywords_are_refused_without_recursion() {
    for prefix in ["", "amount "] {
        let sql = format!(
            "SELECT * FROM deals WHERE {prefix}{}amount = 1",
            "NOT ".repeat(10_000)
        );
        assert!(parse(&sql).is_err());
    }
}
