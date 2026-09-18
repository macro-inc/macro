//! `HAS` is a textual rewrite, so the risks are lexical: touching content
//! inside literals/identifiers/comments, mangling keywords, panicking on
//! multi-byte input, and not being a fixpoint. The fuzz test generates
//! SQL-shaped token streams from a seeded RNG and checks the rewrite is
//! idempotent, never panics, and preserves every opaque span verbatim and
//! in order.

use rand::Rng;

use super::desugar;
use crate::domain::test_support::rng;

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
    assert_eq!(
        desugar("where tags HaS :tag"),
        "where EXISTS (SELECT 1 FROM json_each(tags) WHERE json_each.value = :tag)"
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
    assert_eq!(
        desugar("t.\"a\"\"b\" HAS 'x'"),
        "EXISTS (SELECT 1 FROM json_each(t.\"a\"\"b\") WHERE json_each.value = 'x')"
    );
}

#[test]
fn comments_are_copied_verbatim() {
    let line = "SELECT a -- tags HAS 'vip'\nFROM t WHERE tags HAS 'vip'";
    assert_eq!(
        desugar(line),
        "SELECT a -- tags HAS 'vip'\nFROM t WHERE EXISTS (SELECT 1 FROM json_each(tags) WHERE json_each.value = 'vip')"
    );
    let block = "SELECT a /* x HAS y */ FROM t";
    assert_eq!(desugar(block), block);
    // An apostrophe inside a comment must not open a string literal.
    let apostrophe = "SELECT a -- don't\nFROM t WHERE tags HAS 'x'";
    assert_eq!(
        desugar(apostrophe),
        "SELECT a -- don't\nFROM t WHERE EXISTS (SELECT 1 FROM json_each(tags) WHERE json_each.value = 'x')"
    );
    let unterminated = "SELECT a FROM t /* tags HAS 'x'";
    assert_eq!(desugar(unterminated), unterminated);
    let trailing = "SELECT a FROM t -- tags HAS 'x'";
    assert_eq!(desugar(trailing), trailing);
}

#[test]
fn quoted_identifiers_containing_has_are_untouched() {
    let sql = "SELECT \"my HAS col\" FROM t WHERE \"a HAS b\" = 1";
    assert_eq!(desugar(sql), sql);
}

#[test]
fn keywords_are_never_a_left_operand() {
    for sql in [
        "SELECT has FROM t",
        "SELECT x AS has FROM t",
        "SELECT count(*) FROM t GROUP BY has",
        "SELECT * FROM t WHERE has IS NULL",
        "SELECT * FROM t ORDER BY has DESC",
        "UPDATE t SET has = 1",
        "SELECT * FROM t WHERE x = 1 AND has = 2",
    ] {
        assert_eq!(desugar(sql), sql);
    }
}

#[test]
fn numeric_operands_compare_as_text() {
    assert_eq!(
        desugar("WHERE scores HAS 5"),
        "WHERE EXISTS (SELECT 1 FROM json_each(scores) WHERE json_each.value = CAST(5 AS TEXT))"
    );
    assert_eq!(
        desugar("WHERE scores HAS -1"),
        "WHERE EXISTS (SELECT 1 FROM json_each(scores) WHERE json_each.value = CAST(-1 AS TEXT))"
    );
    assert_eq!(
        desugar("WHERE scores HAS 2.5"),
        "WHERE EXISTS (SELECT 1 FROM json_each(scores) WHERE json_each.value = CAST(2.5 AS TEXT))"
    );
    assert_eq!(
        desugar("WHERE tags HAS other_col"),
        "WHERE EXISTS (SELECT 1 FROM json_each(tags) WHERE json_each.value = other_col)"
    );
}

#[test]
fn chained_has_rewrites_only_the_first_and_never_corrupts_output() {
    let out = desugar("WHERE a HAS b HAS c");
    assert_eq!(
        out,
        "WHERE EXISTS (SELECT 1 FROM json_each(a) WHERE json_each.value = b) HAS c"
    );
}

#[test]
fn multi_byte_input_does_not_panic() {
    for sql in [
        "INSERT INTO t (col) VALUES ('日本語')",
        "SELECT '🎉' AS x, 日 FROM t",
        "WHERE tags HAS 'é' AND name = 'ünïcödé'",
        "SELECT ' é' FROM t WHERE x = 'à'",
        "SELECT a -- 日\nFROM t",
        "é",
        " 日",
        "x HAS 日本",
    ] {
        let out = desugar(sql);
        assert_eq!(desugar(&out), out, "{sql}");
    }
    assert_eq!(
        desugar("WHERE tags HAS 'é'"),
        "WHERE EXISTS (SELECT 1 FROM json_each(tags) WHERE json_each.value = 'é')"
    );
}

#[test]
fn edge_positions_are_safe() {
    for sql in [
        "",
        " ",
        "HAS",
        " HAS ",
        "x HAS",
        "x HAS ",
        "HAS x",
        "'",
        "\"",
        "--",
        "/*",
        "x HAS ''",
        "x HAS 'oops",
        "x HAS \"oops",
        "x HAS -- c",
        "x HAS /* c */ 'y'",
    ] {
        let out = desugar(sql);
        assert_eq!(desugar(&out), out, "{sql}");
    }
    assert_eq!(desugar("x HAS"), "x HAS");
    assert_eq!(desugar("x HAS "), "x HAS ");
}

// ===== Fuzz =====

/// A reference scanner: every string literal, quoted identifier, and
/// comment in `sql`, in order. Independent from the implementation.
/// Unterminated literals and comments are excluded from the generator:
/// SQLite rejects such SQL anyway, and the rewrite may legitimately append
/// text after them.
fn opaque_spans(sql: &str) -> Vec<&str> {
    let bytes = sql.as_bytes();
    let mut spans = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        let start = i;
        let end = match bytes[i] {
            q @ (b'\'' | b'"' | b'`') => {
                let mut k = i + 1;
                loop {
                    match bytes.get(k) {
                        None => break k,
                        Some(&b) if b == q => {
                            if bytes.get(k + 1) == Some(&q) {
                                k += 2;
                            } else {
                                break k + 1;
                            }
                        }
                        Some(_) => k += 1,
                    }
                }
            }
            b'[' => match sql[i + 1..].find(']') {
                Some(n) => i + 1 + n + 1,
                None => bytes.len(),
            },
            b'-' if bytes.get(i + 1) == Some(&b'-') => match sql[i..].find('\n') {
                Some(n) => i + n + 1,
                None => bytes.len(),
            },
            b'/' if bytes.get(i + 1) == Some(&b'*') => match sql[i + 2..].find("*/") {
                Some(n) => i + 2 + n + 2,
                None => bytes.len(),
            },
            _ => {
                i += sql[i..].chars().next().expect("in bounds").len_utf8();
                continue;
            }
        };
        spans.push(&sql[start..end]);
        i = end;
    }
    spans
}

fn random_token(rng: &mut rand::rngs::StdRng) -> String {
    const PLAIN: &[&str] = &[
        "SELECT",
        "FROM",
        "WHERE",
        "AND",
        "OR",
        "NOT",
        "AS",
        "BY",
        "GROUP",
        "ORDER",
        "t",
        "g",
        "tags",
        "g.people",
        "\"my col\"",
        "\"a\"\"b\"",
        "has",
        "HAS",
        "Has",
        "hash",
        "has_flag",
        "5",
        "-1",
        "2.5",
        "?",
        ":p",
        "=",
        "(",
        ")",
        ",",
        "*",
        ";",
        "count(*)",
        "日本語",
        "é",
        "🎉",
        "json_each.value",
        "EXISTS",
    ];
    const OPAQUE: &[&str] = &[
        "'x HAS y'",
        "'it''s'",
        "''",
        "'日 HAS 本'",
        "\"a HAS b\"",
        "\"quoted\"",
        "`a HAS b`",
        "`back tick`",
        "[a HAS b]",
        "[bracketed]",
        "-- a HAS b\n",
        "-- don't\n",
        "/* x HAS 'y */",
        "/* 日 */",
    ];
    if rng.random_bool(0.3) {
        OPAQUE[rng.random_range(0..OPAQUE.len())].to_string()
    } else {
        PLAIN[rng.random_range(0..PLAIN.len())].to_string()
    }
}

#[test]
fn fuzz_rewrite_is_idempotent_and_preserves_opaque_spans() {
    let mut rng = rng(11);
    for _ in 0..2000 {
        let n = rng.random_range(0..12);
        let mut sql = String::new();
        for _ in 0..n {
            sql.push_str(&random_token(&mut rng));
            sql.push_str(match rng.random_range(0..4) {
                0 => "",
                1 => "  ",
                2 => "\n",
                _ => " ",
            });
        }
        let once = desugar(&sql);
        let twice = desugar(&once);
        assert_eq!(once, twice, "not a fixpoint for {sql:?}");
        assert_eq!(
            opaque_spans(&once),
            opaque_spans(&sql),
            "opaque spans changed for {sql:?} → {once:?}"
        );
        if !sql.contains("HAS") && !sql.contains("has") && !sql.contains("Has") {
            assert_eq!(once, sql, "rewrite without HAS must be the identity");
        }
        assert!(once.len() >= sql.len(), "{sql:?} shrank to {once:?}");
    }
}
