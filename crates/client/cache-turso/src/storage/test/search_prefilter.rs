use super::*;
use cache_core::search::fuzzy_freshness_score;
use proptest::prelude::*;

/// ASCII, case pairs, multibyte letters whose lowercase changes length, NUL,
/// commas and whitespace: the inputs where a byte test could disagree with the
/// core's character match.
const ALPHABET: &[char] = &[
    'a', 'b', 'c', 'A', 'B', ' ', ',', '\t', '\0', 'é', 'É', 'ß', 'İ', 'ı', '漢', '字', '%', '_',
];

fn text(max: usize) -> impl Strategy<Value = String> {
    prop::collection::vec(prop::sample::select(ALPHABET), 0..max)
        .prop_map(|characters| characters.into_iter().collect())
}

fn document(search_text: String) -> SearchDocument {
    SearchDocument {
        profile: SearchProfile::QuickAccessV1,
        record_key: EntityKey::entity("Thing", &["id"]),
        bucket: "document".to_owned(),
        search_text,
        timestamp_ms: 0,
        source_hash: String::new(),
    }
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 20_000, ..ProptestConfig::default() })]

    /// The prefilter keeps every row the core ranks, so search results are unchanged.
    #[test]
    fn prefilter_keeps_every_row_the_core_matches(raw_text in text(24), raw_query in text(8)) {
        // The projection's normalization (`subsequence_match::normalize_text`).
        let search_text = raw_text.split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase();
        let query = SearchQuery::new(&raw_query);
        if fuzzy_freshness_score(&document(search_text.clone()), &raw_query, 0).is_some() {
            prop_assert!(search::may_match(&query, &search_text));
        }
    }
}
