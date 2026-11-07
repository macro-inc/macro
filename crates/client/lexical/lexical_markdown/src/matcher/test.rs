use super::*;
#[test]
fn s_with_i_flag_does_not_match_long_s() {
    // V8: /s/i.exec('ſ') === null.
    let regex = RegexMatcher::new("s", "i").expect("regex");
    assert_eq!(regex.exec("ſ"), None);
    assert!(RegexMatcher::new("x", "g").is_err());
    assert!(RegexMatcher::new("x", "y").is_err());
}
#[test]
fn global_replacement_keeps_utf16_spans_and_undefined_captures() {
    let regex = RegexMatcher::new("(x)|(y)", "").expect("regex");
    let matches = find_all(&regex, "😀xy");
    assert_eq!(matches[0].index.get(), 2);
    assert_eq!(matches[0].get(2), None);
    assert_eq!(matches[1].get(2), Some("y"));
    assert_eq!(
        replace_all(&regex, "😀xy", |m| format!("<{}>", m.full())),
        "😀<x><y>"
    );
}
#[test]
fn every_live_expression_compiles_and_has_a_unique_inventory_name() {
    let inventory = crate::patterns::inventory();
    assert_eq!(inventory.len(), 18);
    let mut names = std::collections::HashSet::new();
    for (name, regex) in inventory {
        assert!(names.insert(name));
        assert!(!regex.source().is_empty());
    }
}

include!(concat!(env!("OUT_DIR"), "/regex_inventory.rs"));
#[derive(serde::Deserialize)]
struct Oracle {
    patterns: Vec<Pattern>,
    cases: Vec<Case>,
    ledger: Vec<serde_json::Value>,
}
#[derive(serde::Deserialize)]
struct Pattern {
    name: String,
    source: String,
    flags: String,
}
#[derive(serde::Deserialize)]
struct Case {
    name: String,
    text: String,
    matches: Vec<Expected>,
}
#[derive(serde::Deserialize, Debug, PartialEq)]
struct Expected {
    index: u32,
    groups: Vec<Option<String>>,
}
/// S4§3.6c: source inventory and V8 spans/captures over the fixed corpus.
#[test]
fn regex_differential_matches_pinned_v8_and_source_inventory() {
    let oracle: Oracle =
        serde_json::from_str(include_str!("../../tests/fixtures/regex-v8.json")).expect("oracle");
    let inventory = crate::patterns::inventory();
    let mut names: Vec<_> = inventory.iter().map(|(n, _)| *n).collect();
    names.sort_unstable();
    let mut source_names = SOURCE_REGEX_NAMES.to_vec();
    source_names.sort_unstable();
    assert_eq!(names, source_names);
    let mut oracle_names: Vec<_> = oracle.patterns.iter().map(|p| p.name.as_str()).collect();
    oracle_names.sort_unstable();
    assert_eq!(names, oracle_names);
    for pattern in oracle.patterns {
        let (_, regex) = inventory
            .iter()
            .find(|(n, _)| *n == pattern.name)
            .expect("pattern");
        assert_eq!(regex.source(), pattern.source, "source {}", pattern.name);
        assert_eq!(regex.flags(), pattern.flags);
    }
    for case in oracle.cases {
        let (_, regex) = inventory
            .iter()
            .find(|(n, _)| *n == case.name)
            .expect("pattern");
        let actual = find_all(regex, &case.text)
            .into_iter()
            .map(|m| Expected {
                index: m.index.get(),
                groups: (0..m.group_count())
                    .map(|i| m.get(i).map(str::to_owned))
                    .collect(),
            })
            .collect::<Vec<_>>();
        assert_eq!(actual, case.matches, "{} {:?}", case.name, case.text);
    }
    assert_eq!(oracle.ledger.len(), 4);
    for (entry, unit) in oracle.ledger.iter().zip([0xd800, 0xdfff]) {
        assert_eq!(entry["reason"], "lone-surrogate");
        assert_eq!(entry["inputUnits"], serde_json::json!([unit]));
        let runs = entry["runs"].as_array().expect("actual V8 input probes");
        assert_eq!(runs.len(), names.len());
        let run_names: Vec<_> = runs.iter().map(|run| run["name"].as_str().expect("name")).collect();
        assert_eq!(run_names, names);
    }
}
