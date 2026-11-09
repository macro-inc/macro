use super::*;
#[test]
fn astral_prefix_offsets_and_email_protocol_overlap_are_utf16() {
    let linkify = LinkifyIt::default();
    assert_eq!(
        linkify.matches("😀 user@example.com https://example.com"),
        vec![
            LinkMatch {
                schema: "mailto:".into(),
                index: 3,
                last_index: 19,
                raw: "user@example.com".into(),
                text: "user@example.com".into(),
                url: "mailto:user@example.com".into()
            },
            LinkMatch {
                schema: "https:".into(),
                index: 20,
                last_index: 39,
                raw: "https://example.com".into(),
                text: "https://example.com".into(),
                url: "https://example.com".into()
            },
        ]
    );
    assert_eq!(
        linkify.matches("😀 https://example.com/😀"),
        vec![LinkMatch {
            schema: "https:".into(),
            index: 3,
            last_index: 25,
            raw: "https://example.com/😀".into(),
            text: "https://example.com/😀".into(),
            url: "https://example.com/😀".into(),
        }]
    );
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Case {
    text: String,
    options: Options,
    tlds: Option<Vec<String>>,
    keep: bool,
    test: bool,
    pretest: bool,
    matches: Vec<LinkMatch>,
    at_start: Option<LinkMatch>,
}
/// Differential corpus emitted by linkify-it 5.0.2 / uc.micro 2.1.0 with a fixed seed.
#[test]
fn linkify_it_5_0_2_differential_corpus() -> Result<(), LinkifyError> {
    let cases: Vec<Case> = serde_json::from_str(include_str!("corpus.json")).expect("corpus");
    assert_eq!(cases.len(), 5018);
    let mut cache = std::collections::HashMap::new();
    for case in cases {
        let key = serde_json::to_string(&(case.options, &case.tlds, case.keep)).expect("config");
        if !cache.contains_key(&key) {
            let mut matcher = LinkifyIt::with_options(case.options)?;
            if let Some(tlds) = &case.tlds {
                matcher.tlds(tlds, case.keep)?;
            }
            cache.insert(key.clone(), matcher);
        }
        let matcher = cache.get(&key).expect("matcher");
        if let Some(tlds) = case.tlds.as_ref().filter(|_| !case.keep) {
            let direct = LinkifyIt::with_replaced_tlds(case.options, tlds)?;
            assert_eq!(
                direct.matches(&case.text),
                case.matches,
                "direct TLD match {:?}",
                case.text
            );
            assert_eq!(
                direct.test(&case.text),
                case.test,
                "direct TLD test {:?}",
                case.text
            );
            assert_eq!(
                direct.pretest(&case.text),
                case.pretest,
                "direct TLD pretest {:?}",
                case.text
            );
            assert_eq!(
                direct.match_at_start(&case.text),
                case.at_start,
                "direct TLD start {:?}",
                case.text
            );
        }
        assert_eq!(
            matcher.matches(&case.text),
            case.matches,
            "match {:?} {:?}",
            case.text,
            case.options
        );
        assert_eq!(matcher.test(&case.text), case.test, "test {:?}", case.text);
        assert_eq!(
            matcher.pretest(&case.text),
            case.pretest,
            "pretest {:?}",
            case.text
        );
        assert_eq!(
            matcher.match_at_start(&case.text),
            case.at_start,
            "matchAtStart {:?}",
            case.text
        );
    }
    Ok(())
}
