use std::collections::BTreeMap;

use super::Attestations;

const NOTE: &str = r#"src/main.rs
  s_c9883b05a2487d::t_9f8e7d6c5b4a32 1-10,15-20
  s_c9883b05a2487d::t_a1b2c3d4e5f678 25,30-35
  h_31dce776f88375 42-50
"src/my file.rs"
  d9978a8723e02b52 3-4
  s_e7f2a90b31cc48::t_deadbeef012345 1-2
---
{"schema_version":"authorship/3.0.0","prompts":{}}
"#;

#[test]
fn counts_session_lines_and_skips_humans() {
    let attestations = Attestations::parse(NOTE);

    assert_eq!(
        attestations.lines_per_session(),
        BTreeMap::from([
            ("d9978a8723e02b52", 2),
            ("s_c9883b05a2487d", 23),
            ("s_e7f2a90b31cc48", 2),
        ])
    );
    assert_eq!(
        attestations.sessions_in_file("src/my file.rs"),
        BTreeMap::from([("d9978a8723e02b52", 2), ("s_e7f2a90b31cc48", 2)])
    );
}

#[test]
fn finds_the_session_of_a_line() {
    let attestations = Attestations::parse(NOTE);

    assert_eq!(
        attestations.session_at("src/main.rs", 31),
        Some("s_c9883b05a2487d")
    );
    assert_eq!(attestations.session_at("src/main.rs", 12), None);
    assert_eq!(attestations.session_at("src/main.rs", 45), None);
    assert_eq!(attestations.session_at("other.rs", 1), None);
}

#[test]
fn skips_malformed_lines_and_stops_at_the_metadata() {
    let note = "a.rs\n  s_1::t_1 not-a-range\n  s_2::t_2 4-5\n---\nb.rs\n  s_3::t_3 1\n";
    let attestations = Attestations::parse(note);

    assert_eq!(
        attestations.lines_per_session(),
        BTreeMap::from([("s_2", 2)])
    );
}
