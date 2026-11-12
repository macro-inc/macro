//! Recorded V8 ranges and capture contents, including lone UTF-16 units.
use regress::Regex;
use serde::Deserialize;

#[derive(Deserialize)]
struct Fixture {
    cases: Vec<Case>,
}

#[derive(Deserialize)]
struct Case {
    source: String,
    flags: String,
    input: Vec<u16>,
    matches: Vec<RecordedMatch>,
}

#[derive(Debug, Deserialize, PartialEq, Eq)]
struct RecordedMatch {
    ranges: Vec<Option<[usize; 2]>>,
    captures: Vec<Option<Vec<u16>>>,
    named: Vec<(String, Option<[usize; 2]>)>,
}

#[test]
fn anchored_v8_ranges_and_captures() {
    let fixture: Fixture =
        serde_json::from_str(include_str!("../../tests/fixtures/anchored-v8.json"))
            .expect("recorded reference V8 corpus");
    for case in fixture.cases {
        let regex = Regex::with_flags(&case.source, case.flags.as_str())
            .expect("recorded source pattern compiles");
        let matches: Vec<_> = if regex.is_unicode() {
            regex.find_from_utf16(&case.input, 0).collect()
        } else {
            regex.find_from_ucs2(&case.input, 0).collect()
        };
        let actual: Vec<_> = matches
            .into_iter()
            .map(|m| {
                let ranges: Vec<_> = std::iter::once(Some(m.range()))
                    .chain(m.captures.iter().cloned())
                    .collect();
                RecordedMatch {
                    captures: ranges
                        .iter()
                        .map(|range| range.clone().map(|range| case.input[range].to_vec()))
                        .collect(),
                    ranges: ranges
                        .into_iter()
                        .map(|range| range.map(|range| [range.start, range.end]))
                        .collect(),
                    named: m
                        .named_groups()
                        .map(|(name, range)| {
                            (name.to_owned(), range.map(|range| [range.start, range.end]))
                        })
                        .collect(),
                }
            })
            .collect();
        assert_eq!(
            actual, case.matches,
            "source {:?}; flags {:?}; input {:?}",
            case.source, case.flags, case.input
        );
    }
}
