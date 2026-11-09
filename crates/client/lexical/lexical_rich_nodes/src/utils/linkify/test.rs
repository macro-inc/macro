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

// Preserve the unfiltered regress search as an independent oracle for the
// conservative rejection filters. The pinned corpus separately checks JS output.
fn unfiltered_matches(linkify: &LinkifyIt, text: &str) -> Vec<LinkMatch> {
    let units: Vec<_> = text.encode_utf16().collect();
    let mut found = Vec::new();
    for m in linkify.compiled.schema.find_from_ucs2(&units, 0) {
        let Some(group) = m.group(2) else { continue };
        let schema = String::from_utf16_lossy(&units[group]);
        let len = linkify.validate(&units, &schema, m.end());
        if len > 0 {
            let start = m.start() + m.group(1).map_or(0, |g| g.len());
            let mut link = LinkifyIt::normalized(
                &units,
                Found {
                    schema: "",
                    index: start,
                    end: m.end() + len,
                },
            );
            link.schema = schema.to_ascii_lowercase();
            link.url = link.raw.clone();
            found.push((0, link));
        }
    }
    if linkify.options.fuzzy_email {
        for m in linkify.compiled.email.find_from_ucs2(&units, 0) {
            found.push((
                1,
                LinkifyIt::normalized(
                    &units,
                    Found {
                        schema: "mailto:",
                        index: m.start() + m.group(1).map_or(0, |g| g.len()),
                        end: m.end(),
                    },
                ),
            ));
        }
    }
    if linkify.options.fuzzy_link {
        let regex = if linkify.options.fuzzy_ip {
            &linkify.compiled.fuzzy
        } else {
            &linkify.compiled.no_ip
        };
        for m in regex.find_from_ucs2(&units, 0) {
            found.push((
                2,
                LinkifyIt::normalized(
                    &units,
                    Found {
                        schema: "",
                        index: m.start() + m.group(1).map_or(0, |g| g.len()),
                        end: m.end(),
                    },
                ),
            ));
        }
    }
    found.sort_by(|(a_priority, a), (b_priority, b)| {
        a.index
            .cmp(&b.index)
            .then(b.last_index.cmp(&a.last_index))
            .then(a_priority.cmp(b_priority))
    });
    let mut end = 0;
    found
        .into_iter()
        .filter_map(|(_, link)| {
            if link.index < end {
                None
            } else {
                end = link.last_index;
                Some(link)
            }
        })
        .collect()
}

proptest::proptest! {
    #[test]
    fn rejection_filters_preserve_unfiltered_regress(
        prefix in proptest::collection::vec(proptest::char::any(), 0..80),
        suffix in proptest::collection::vec(proptest::char::any(), 0..80),
        token in proptest::sample::select(vec!["", ".", ":", "@", "//example.com", "HTTP://example.com", "user@example.com", "example.org", "localhost", "127.0.0.1", "例子.com"]),
        fuzzy_ip in proptest::bool::ANY,
        fuzzy_link in proptest::bool::ANY,
        fuzzy_email in proptest::bool::ANY,
    ) {
        let text=format!("{} {token} {}",prefix.into_iter().collect::<String>(),suffix.into_iter().collect::<String>());
        let linkify=LinkifyIt::with_options(Options {fuzzy_ip,fuzzy_link,fuzzy_email,..Default::default()}).expect("valid options");
        proptest::prop_assert_eq!(linkify.matches(&text),unfiltered_matches(&linkify,&text));
    }
}

#[test]
fn ordinary_prose_with_sentence_periods_has_no_links() {
    let linkify = LinkifyIt::default();
    assert_eq!(linkify.matches("It will be seen that this mere painstaking burrower and grub-worm of a poor devil of a Sub-Sub appears to have gone through the long Vaticans and street-stalls of the earth. Far from it."), vec![]);
    assert_eq!(
        linkify.matches("A full stop. A colon: a slash / and no links."),
        vec![]
    );
}
