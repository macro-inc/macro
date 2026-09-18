use super::desugar;

#[test]
fn rewrites_membership_predicate() {
    assert_eq!(
        desugar("SELECT * FROM guests g WHERE g.people HAS 'usr_1'"),
        "SELECT * FROM guests g WHERE EXISTS (SELECT 1 FROM json_each(g.people) WHERE json_each.value = 'usr_1')"
    );
}

#[test]
fn is_case_insensitive_and_handles_parameters() {
    assert_eq!(
        desugar("where tags has ?"),
        "where EXISTS (SELECT 1 FROM json_each(tags) WHERE json_each.value = ?)"
    );
}

#[test]
fn leaves_literals_and_plain_sql_alone() {
    let sql = "SELECT 'x HAS y' AS s, hash FROM t WHERE has_flag = 1";
    assert_eq!(desugar(sql), sql);
}

#[test]
fn handles_quoted_identifiers_and_escaped_literals() {
    assert_eq!(
        desugar("\"my col\" HAS 'it''s'"),
        "EXISTS (SELECT 1 FROM json_each(\"my col\") WHERE json_each.value = 'it''s')"
    );
}
