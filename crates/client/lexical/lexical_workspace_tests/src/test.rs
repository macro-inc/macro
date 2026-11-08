use regress::Regex;
use serde::Deserialize;
use std::collections::BTreeMap;

#[derive(Deserialize)]
struct Fixture {
    classes: Vec<(u16, Vec<usize>)>,
    ascii: Vec<usize>,
    word: Vec<usize>,
    cases: Vec<Case>,
}

#[derive(Deserialize)]
struct Case {
    source: String,
    input: Vec<u16>,
    matches: Vec<Vec<Option<[usize; 2]>>>,
}

#[test]
fn regex_icase_v8() {
    let fixture: Fixture = serde_json::from_str(include_str!("../tests/fixtures/icase-v8.json"))
        .expect("recorded V8 fixture");
    let classes: BTreeMap<_, _> = fixture.classes.into_iter().collect();
    let bmp: Vec<u16> = (u16::MIN..=u16::MAX).collect();

    // The fixture stores singleton identity classes implicitly. Each regex is
    // run against every UTF-16 code unit, including lone surrogates.
    // UCS-2 is the legacy JS mode; the UTF-16 decoder combines surrogate pairs.
    for unit in u16::MIN..=u16::MAX {
        let expected = classes
            .get(&unit)
            .cloned()
            .unwrap_or_else(|| vec![usize::from(unit)]);
        for source in [format!(r"\u{unit:04x}"), format!(r"[\u{unit:04x}]")] {
            let regex = Regex::with_flags(&source, "i").expect("literal compiles");
            let actual: Vec<_> = regex.find_from_ucs2(&bmp, 0).map(|m| m.start()).collect();
            assert_eq!(actual, expected, "{source}");
        }

        // Maximal negative-class runs are a compact, exact representation of
        // all 65,536 membership decisions for [^c].
        let source = format!(r"[^\u{unit:04x}]+");
        let regex = Regex::with_flags(&source, "i").expect("negative class compiles");
        let actual: Vec<_> = regex
            .find_from_ucs2(&bmp, 0)
            .map(|m| [m.start(), m.end()])
            .collect();
        let mut complement = Vec::new();
        let mut start = 0;
        for matched in expected {
            if start < matched {
                complement.push([start, matched]);
            }
            start = matched + 1;
        }
        if start < bmp.len() {
            complement.push([start, bmp.len()]);
        }
        assert_eq!(actual, complement, "{source}");
    }

    for (source, expected) in [("[a-z]", fixture.ascii), (r"\w", fixture.word)] {
        let regex = Regex::with_flags(source, "i").expect("class compiles");
        let actual: Vec<_> = regex.find_from_ucs2(&bmp, 0).map(|m| m.start()).collect();
        assert_eq!(actual, expected, "{source}");
    }

    for case in fixture.cases {
        let regex = Regex::with_flags(&case.source, "i").expect("static pattern compiles");
        let actual: Vec<Vec<_>> = regex
            .find_from_ucs2(&case.input, 0)
            .map(|m| m.groups().map(|r| r.map(|r| [r.start, r.end])).collect())
            .collect();
        assert_eq!(actual, case.matches, "{} on {:?}", case.source, case.input);
    }
}

#[test]
fn unicode_case_folding_is_preserved() {
    for (pattern, input) in [("s", "ſ"), ("[a-z]", "K"), (r"\w", "ſ")] {
        let legacy = Regex::with_flags(pattern, "i").expect("legacy regex");
        assert!(legacy.find(input).is_none());
        let unicode = Regex::with_flags(pattern, "iu").expect("Unicode regex");
        assert!(unicode.find(input).is_some());
    }
}

#[test]
fn loro_snapshot_round_trip() {
    let source = loro::LoroDoc::new();
    source.set_peer_id(1).expect("peer id");
    source
        .get_text("text")
        .insert(0, "snapshot Σ𐐀")
        .expect("text insert");
    let bytes = source
        .export(loro::ExportMode::Snapshot)
        .expect("snapshot export");
    let target = loro::LoroDoc::new();
    target.import(&bytes).expect("snapshot import");
    assert_eq!(source.get_deep_value(), target.get_deep_value());
}

#[test]
fn loro_imports_javascript_snapshot() {
    let bytes: Vec<u8> = serde_json::from_str(include_str!("../tests/fixtures/loro-js.json"))
        .expect("JavaScript snapshot fixture");
    let doc = loro::LoroDoc::new();
    doc.import(&bytes).expect("JavaScript snapshot import");
    assert_eq!(doc.get_text("text").to_string(), "snapshot Σ𐐀");
}
