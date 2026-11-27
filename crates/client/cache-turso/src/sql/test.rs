use super::*;

#[test]
fn numbers_enter_only_as_structure() {
    assert_eq!(Sql::placeholders(0).as_str(), "");
    assert_eq!(Sql::placeholders(3).as_str(), "?, ?, ?");
    assert_eq!(Sql::placeholder(7).as_str(), "?7");
    assert_eq!(Sql::numbered_placeholders(2, 3).as_str(), "?2, ?3, ?4");
    let mut names = Ordinals::new();
    let first = names.take();
    assert_eq!(Sql::numbered("expr_", first).as_str(), "expr_0");
    assert_eq!(Sql::numbered("expr_", names.take()).as_str(), "expr_1");
    assert_eq!(
        Sql::numbered("expr_", first).as_str(),
        "expr_0",
        "a copy names the same"
    );
    assert_eq!(Sql::constant::<4095>().as_str(), "4095");
    assert_eq!(Sql::repeat("(?, ?)", 2, ", ").as_str(), "(?, ?), (?, ?)");
    assert_eq!(
        Sql::join(
            [
                Sql::numbered("w", names.take()),
                Sql::numbered("w", names.take())
            ],
            " UNION ALL "
        )
        .as_str(),
        "w2 UNION ALL w3"
    );
}

#[test]
fn the_macro_fills_every_named_hole() {
    let table = "records";
    let ids = Sql::placeholders(2);
    let sql = crate::sql!(
        "SELECT json_object('a', 1) FROM {table} WHERE id IN ({ids})",
        table,
        ids
    );
    assert_eq!(
        sql.as_str(),
        "SELECT json_object('a', 1) FROM records WHERE id IN (?, ?)"
    );
    assert_eq!(sql.to_string(), sql.as_str());
    assert!(holes_match("{a} {b} {a}", &["a", "b"]));
    assert!(!holes_match("{a} {b}", &["a"]), "a hole without a part");
    assert!(!holes_match("{a}", &["a", "b"]), "a part without a hole");
    assert!(!holes_match("{}", &[]), "a brace outside a hole");
    assert!(!holes_match("{a:?}", &["a"]), "a formatting spec");
    assert!(!holes_match("a }", &[]), "a lone closing brace");
}

#[test]
fn only_crate_text_is_reportable() {
    let built = crate::sql!("SELECT {ids}", ids = Sql::placeholders(1));
    assert!(Template::from("COMMIT").reportable().text_may_be_sent());
    assert!(Template::from(&built).reportable().text_may_be_sent());
    let unreported = UnreportedSql::new(format!("PRAGMA table_info('{}')", "canary"));
    let template = Template::from(&unreported);
    assert!(!template.reportable().text_may_be_sent());
    assert_eq!(template.text(), "PRAGMA table_info('canary')");
    let ad_hoc = String::from("SELECT 1");
    assert!(!Template::from(&ad_hoc).reportable().text_may_be_sent());
}

/// Values bound to a template never become its text: the same template
/// serves every value, so its fingerprint names the shape, not the data.
#[test]
fn bound_values_stay_out_of_the_text() {
    let canaries = ["canary-a'; DROP TABLE records; --", "canary-b"];
    let sql = crate::sql!(
        "SELECT value FROM records WHERE id IN ({ids})",
        ids = Sql::placeholders(canaries.len())
    );
    assert_eq!(sql.as_str(), "SELECT value FROM records WHERE id IN (?, ?)");
    assert!(canaries.iter().all(|canary| !sql.as_str().contains(canary)));
}
