//! How a search's terms match email: the clauses each term becomes in the
//! address and text fields, and what they cost against OpenSearch's limit.

use opensearch_query_builder::{
    BoolQueryBuilder, MatchBoolPrefixQuery, QueryType, SimpleQueryStringQuery,
};
use unicode_segmentation::UnicodeSegmentation;

use crate::search::query::{CreateQueryParams, QueryKey, create_query};

/// The most clauses a search's terms and text conditions may cost before they
/// are matched in the compact form ([`terms_query`]). OpenSearch refuses a
/// query of more than 1,024 clauses; this leaves room for the filters. In the
/// compact form the 50 terms the search service accepts cost 800.
pub(super) const MAX_TERM_CLAUSES: usize = 960;

/// The most clauses `term` costs in the full form: one per token the analyzer
/// may split it into in each field, or one where it is quoted. A whole address
/// is never split, and is matched two ways.
pub(super) fn clauses(
    term: &str,
    keyword_fields: &'static [&'static str],
    text_fields: &'static [&'static str],
) -> usize {
    let tokens = most_tokens(term);
    let words = if is_text_phrase(term) { 1 } else { tokens };
    let segments = segment_fields(keyword_fields).len();
    let addresses = keyword_fields.len() - segments;
    let address_clauses = if is_address_phrase(term) {
        addresses + segments
    } else {
        2 * addresses + segments * tokens
    };
    address_clauses + text_fields.len() * words
}

/// Whether the standard tokenizer keeps a run of letters like `c` together as
/// one token, because the script is written without spaces: the Thai, Lao,
/// Myanmar and Khmer blocks, with their digits and punctuation, which it
/// splits off. UAX #29 splits each of these characters off.
fn in_spaceless_script(c: char) -> bool {
    matches!(c, '\u{0E00}'..='\u{0EFF}' | '\u{1000}'..='\u{109F}' | '\u{1780}'..='\u{17FF}')
}

/// The most tokens the analyzer splits `term` into. Every Unicode (UAX #29)
/// segment is one at most, and one more for each character in it that is not a
/// letter or digit, where Lucene's older Unicode data may split. In a run of a
/// spaceless script each stretch of letters or of digits is one.
fn most_tokens(term: &str) -> usize {
    let mut tokens = 0;
    let mut stretch = None;
    for segment in term.split_word_bounds() {
        if segment.chars().all(in_spaceless_script) {
            for c in segment.chars() {
                let kind = (c.is_alphabetic(), c.is_numeric());
                if stretch != Some(kind) && kind != (false, false) {
                    tokens += 1;
                }
                stretch = Some(kind);
            }
            continue;
        }
        stretch = None;

        let word = usize::from(segment.chars().any(char::is_alphanumeric));
        let others = segment
            .chars()
            .filter(|c| !c.is_alphanumeric() && !c.is_ascii() && !c.is_whitespace() && *c != '’')
            .count();
        tokens += word + others;
    }
    tokens.max(1)
}

/// The fewest tokens the analyzer splits `term` into: its Unicode (UAX #29)
/// words that hold a letter or a digit, the letters of a run of a spaceless
/// script counted once and its digits once. The tokenizer drops the other
/// words `unicode_words` finds, such as the `₂` of `CO₂`.
fn fewest_tokens(term: &str) -> usize {
    let mut tokens = 0;
    let mut run_letters = false;
    let mut run_digits = false;
    for segment in term.split_word_bounds() {
        let letters = segment.chars().any(char::is_alphabetic);
        let digits = segment.chars().any(is_decimal_digit);
        if segment.chars().all(in_spaceless_script) {
            tokens += usize::from(letters && !run_letters);
            tokens += usize::from(digits && !run_digits);
            run_letters |= letters;
            run_digits |= digits;
            continue;
        }
        run_letters = false;
        run_digits = false;

        tokens += usize::from(letters || digits);
    }
    tokens
}

/// Whether `c` is a digit of any script that the tokenizer keeps: UAX #29
/// joins it to a digit after it, which it does not do to a superscript, a
/// fraction or a circled number.
fn is_decimal_digit(c: char) -> bool {
    c.is_numeric() && format!("{c}1").split_word_bounds().nth(1).is_none()
}

/// Whether `term` is quoted in the text fields: a phrase in quotes or an
/// address.
fn is_text_phrase(term: &str) -> bool {
    term.contains('@') || term.chars().any(char::is_whitespace)
}

/// Whether `term` is quoted in the address fields, where a dot separates
/// segments too.
fn is_address_phrase(term: &str) -> bool {
    is_text_phrase(term) || term.contains('.')
}

/// The `.parts` sub-fields among the address fields.
fn segment_fields(keyword_fields: &'static [&'static str]) -> Vec<&'static str> {
    let parts = keyword_fields
        .iter()
        .filter(|field| field.ends_with(".parts"));
    parts.copied().collect()
}

/// Matches `terms`: every group of them ([`term_groups`]), each against the
/// address fields or the text fields. In the compact form, for a search whose
/// terms would cost too many clauses, a term of several tokens matches them
/// adjacent and whole, as one clause per field.
pub(super) fn terms_query<'a>(
    terms: &'a [String],
    match_type: &str,
    keyword_fields: &'static [&'static str],
    text_fields: &'static [&'static str],
    compact: bool,
) -> QueryType<'a> {
    let group_query =
        |group: &[&'a str]| group_query(group, match_type, keyword_fields, text_fields, compact);
    let groups = term_groups(terms, match_type);
    if let [group] = groups.as_slice() {
        return group_query(group);
    }

    let mut all = BoolQueryBuilder::new();
    for group in &groups {
        all.must(group_query(group));
    }
    all.build().into()
}

/// The groups of `terms` that each match on their own. An address or a domain
/// is one, as a typed `from:` or `to:` is, so that it stands beside a word of
/// the text. The words are one together, because a word in many addresses,
/// such as the name of the searcher's own domain, would otherwise match nearly
/// every message. A word with no letter or digit (`½`, an emoji) may match
/// nothing on its own, so beside an address it is left out. Regexp syntax may
/// span terms, so input that uses it stays whole.
fn term_groups<'a>(terms: &'a [String], match_type: &str) -> Vec<Vec<&'a str>> {
    let terms = terms.iter().map(String::as_str);
    if match_type == "regexp" && terms.clone().any(holds_syntax) {
        return vec![terms.collect()];
    }

    let (addresses, mut words): (Vec<&str>, Vec<&str>) =
        terms.partition(|term| names_address(term));
    if addresses.is_empty() {
        return vec![words];
    }
    words.retain(|word| fewest_tokens(word) > 0);
    let mut groups: Vec<Vec<&str>> = addresses.into_iter().map(|term| vec![term]).collect();
    if !words.is_empty() {
        groups.push(words);
    }
    groups
}

/// Whether `term` is an address or a domain (`ana@example.com`, `@example.com`,
/// `example.com`) rather than a word. Any dotted name reads as a domain
/// (`node.js`). A number (`3.5`), an abbreviation (`p.m.`) and a phrase are
/// words.
fn names_address(term: &str) -> bool {
    let is_domain = || {
        let name = term.trim_matches(|c: char| !c.is_alphanumeric());
        name.rsplit_once('.').is_some_and(|(name, top_level)| {
            name.ends_with(char::is_alphanumeric)
                && top_level.chars().count() >= 2
                && top_level.chars().all(char::is_alphabetic)
        })
    };
    !term.chars().any(char::is_whitespace)
        && fewest_tokens(term) > 0
        && (term.contains('@') || is_domain())
}

/// Matches `terms`, all of them, against the address fields or the text
/// fields.
fn group_query<'a>(
    terms: &[&'a str],
    match_type: &str,
    keyword_fields: &'static [&'static str],
    text_fields: &'static [&'static str],
    compact: bool,
) -> QueryType<'a> {
    let mut combined = BoolQueryBuilder::new();
    combined.minimum_should_match(1);
    for query in addresses_query(terms, match_type, keyword_fields, compact) {
        combined.should(query);
    }
    combined.should(text_terms_query(terms, match_type, text_fields, compact));
    combined.build().into()
}

/// Matches `terms`, all of them, against the whole addresses, or against their
/// `.parts` by segment, which match everything the whole addresses do except
/// mail indexed before it had any. They are two queries, because a pattern for
/// one never matches the other's fields and would cost a clause in each of
/// them. Regexp syntax runs in all of them.
fn addresses_query<'a>(
    terms: &[&str],
    match_type: &str,
    keyword_fields: &'static [&'static str],
    compact: bool,
) -> Vec<QueryType<'a>> {
    let regexp_syntax = match_type == "regexp" && terms.iter().any(|term| holds_syntax(term));
    let queries = if regexp_syntax {
        vec![(build_regexp_address_string(terms), keyword_fields.to_vec())]
    } else {
        let segments = segment_fields(keyword_fields);
        let addresses = keyword_fields
            .iter()
            .copied()
            .filter(|field| !segments.contains(field))
            .collect();
        vec![
            (build_address_query_string(terms, compact), addresses),
            (build_segment_query_string(terms, compact), segments),
        ]
    };
    queries
        .into_iter()
        .filter(|(_, fields)| !fields.is_empty())
        .map(|(query, fields)| {
            SimpleQueryStringQuery::new(query, fields)
                .default_operator("AND")
                .into()
        })
        .collect()
}

/// Matches `terms`, all of them, against the text fields. A partial term that
/// is not one plain word ([`one_word`]) is matched with a query the analyzer
/// reads ([`analyzed_prefix`]): a `term*` prefix is not analyzed, so `follow-up*`
/// would look for one token `follow-up` the index never holds. Every other
/// term, and that one too in the compact form, goes in the simple_query_string
/// [`build_text_query_string`] builds.
fn text_terms_query<'a>(
    terms: &[&'a str],
    match_type: &str,
    text_fields: &'static [&'static str],
    compact: bool,
) -> QueryType<'a> {
    let (analyzed, others): (Vec<&str>, Vec<&str>) = terms
        .iter()
        .partition(|term| !compact && is_analyzed_prefix(term, match_type));
    let others = (!others.is_empty()).then(|| {
        QueryType::from(
            SimpleQueryStringQuery::new(
                build_text_query_string(&others, match_type, compact),
                text_fields.iter().copied(),
            )
            .default_operator("AND"),
        )
    });
    if analyzed.is_empty()
        && let Some(others) = others
    {
        return others;
    }

    let mut all = BoolQueryBuilder::new();
    if let Some(others) = others {
        all.must(others);
    }
    for term in analyzed {
        let mut any_field = BoolQueryBuilder::new();
        any_field.minimum_should_match(1);
        for field in text_fields {
            any_field.should(analyzed_prefix(term, field));
        }
        all.must(any_field.build().into());
    }
    all.build().into()
}

/// Whether a partial `term` long enough to match as a prefix is more than one
/// plain word (`follow-up`, `AT&T`, `東京都`, `CO₂`, a Thai run, `lunch🎉`). A
/// phrase in quotes or an address already matches as a phrase in
/// [`build_text_query_string`], and a short term as its analyzed words.
fn is_analyzed_prefix(term: &str, match_type: &str) -> bool {
    match_type == "partial"
        && !is_text_phrase(term)
        && term.chars().count() >= MIN_PREFIX_LEN
        && one_word(term).is_none()
}

/// Matches `term`'s tokens in `field`, the last as a prefix. Several tokens
/// must be adjacent, as the shared term builder matches them
/// ([`create_query`]). A term the analyzer may read as one token, such as a
/// Thai run or `CO₂`, is never a phrase prefix: OpenSearch expands a phrase
/// prefix of one token into a clause for each word that starts with it.
fn analyzed_prefix<'a>(term: &'a str, field: &'static str) -> QueryType<'a> {
    if fewest_tokens(term) >= 2 {
        return create_query(CreateQueryParams {
            query_key: QueryKey::MatchPhrasePrefix,
            field,
            term,
        });
    }
    MatchBoolPrefixQuery::new(field, term)
        .operator("and")
        .into()
}

/// Builds the simple_query_string over the whole addresses. A one-word term
/// becomes `(term | term@*)`, an address without an `@` or an exact match on
/// the local part, which the `.parts` sub-fields match too; it finds mail
/// indexed before they existed. This deliberately does NOT use a trailing `*`
/// on the bare term, so partial segments don't leak across addresses (e.g.
/// `ali` won't match `alice@example.com`). A term containing `@`, `.`, or
/// spaces matches a full address only. A term of one word with punctuation
/// around it (`-lunch`) matches by that word alone ([`one_word`]). The compact
/// form matches the local part only.
/// The local part is lowercased because email addresses are case-insensitive.
/// Terms are ANDed together with `+`.
pub(super) fn build_address_query_string(terms: &[impl AsRef<str>], compact: bool) -> String {
    terms
        .iter()
        .map(|term| {
            let term = term.as_ref();
            if is_address_phrase(term) {
                return phrase(term);
            }
            let word = escape_syntax(one_word(term).unwrap_or(term));
            let local_part = format!("{}@*", word.to_lowercase());
            if compact {
                local_part
            } else {
                format!("({word} | {local_part})")
            }
        })
        .collect::<Vec<_>>()
        .join(" + ")
}

/// Builds the simple_query_string over the `.parts` sub-fields, where a bare
/// word matches a whole segment. Terms containing `@`, `.`, or spaces (quoted
/// phrases from `split_search_terms`) are wrapped in quotes to force phrase
/// matching: the `email_parts` analyzer splits such terms into segment tokens,
/// so the phrase requires an in-order adjacent run — `mail.example.com`,
/// `example.com`, and full addresses all match `x@mail.example.com`, but
/// reordered or gapped segments don't. Without the quotes,
/// `default_operator: "AND"` would match each segment independently anywhere
/// in the field, at one clause per segment, so the compact form quotes every
/// term.
/// Terms are ANDed together with `+`.
pub(super) fn build_segment_query_string(terms: &[impl AsRef<str>], compact: bool) -> String {
    terms
        .iter()
        .map(|term| {
            let term = term.as_ref();
            if compact || is_address_phrase(term) {
                return phrase(term);
            }
            let word = one_word(term).unwrap_or(term);
            format!("({})", escape_syntax(word))
        })
        .collect::<Vec<_>>()
        .join(" + ")
}

/// Builds the simple_query_string that runs regexp input, whose punctuation is
/// syntax, over every address field: `(term | term@*)`, a segment or a local
/// part.
fn build_regexp_address_string(terms: &[&str]) -> String {
    terms
        .iter()
        .map(|term| {
            if is_address_phrase(term) {
                return format!("\"{}\"", term);
            }
            format!("({} | {}@*)", term, term.to_lowercase())
        })
        .collect::<Vec<_>>()
        .join(" + ")
}

/// `term` as one phrase, its punctuation literal.
fn phrase(term: &str) -> String {
    format!("\"{}\"", escape_syntax(term))
}

/// The word of a term that is one Unicode (UAX #29) word with nothing but
/// ASCII punctuation around it (`-lunch`, `(lunch`, `Re:`). A prefix is not
/// analyzed, so with the punctuation it would look for a token the index never
/// holds. The index does hold a symbol as a token, so a term with one (`C♯`)
/// is more than its word.
fn one_word(term: &str) -> Option<&str> {
    let mut words = term.unicode_word_indices();
    let (Some((start, word)), None) = (words.next(), words.next()) else {
        return None;
    };
    let mut around = term[..start]
        .chars()
        .chain(term[start + word.len()..].chars());
    around.all(|c| c.is_ascii_punctuation()).then_some(word)
}

/// Whether `term` holds punctuation a simple_query_string reads as syntax.
fn holds_syntax(term: &str) -> bool {
    escape_syntax(term) != term
}

/// `term` as literal text for a simple_query_string, which otherwise reads
/// punctuation in it as syntax: a leading `-` as NOT, so `-lunch` matched
/// every message whose addresses lack `lunch`, `|` as OR, `(` as a group and
/// `~2` as a fuzzy match. Regexp input is not escaped: its punctuation is
/// syntax.
fn escape_syntax(term: &str) -> String {
    let mut escaped = String::with_capacity(term.len());
    for c in term.chars() {
        if matches!(c, '+' | '|' | '-' | '"' | '*' | '(' | ')' | '~' | '\\') {
            escaped.push('\\');
        }
        escaped.push(c);
    }
    escaped
}

/// Minimum prefix length before we emit a `term*` wildcard. Shorter prefixes
/// expand to too many unique tokens in the index and risk blowing past
/// `max_clause_count`. Under this threshold we fall back to exact token match.
const MIN_PREFIX_LEN: usize = 3;

/// Builds the simple_query_string over the text-analyzed fields.
/// Single-word terms become `term*` so a prefix like `scri` matches the
/// token `script` in subject/content/display-name fields. Terms shorter than
/// `MIN_PREFIX_LEN` fall back to a grouped exact-token match to keep term
/// expansion bounded. In `exact` match mode the prefix wildcard is dropped so
/// every single-word term is an exact-token match. Multi-word terms (quoted
/// phrases from `split_search_terms`) and `@`-containing terms are wrapped in
/// quotes to
/// force phrase matching — otherwise `default_operator: "AND"` would turn
/// `(reply test)` into `reply AND test` and match each token independently
/// anywhere in the field instead of as an adjacent phrase. The compact form
/// quotes every other term that is not a prefix too, so that it costs one
/// clause per field.
///
/// A term that is one word with punctuation around it (`follow-`, `Re:`,
/// `-lunch`) matches by that word alone ([`one_word`]), as
/// [`child_content_query`](crate::search::query::child_content_query) does.
pub(super) fn build_text_query_string(
    terms: &[impl AsRef<str>],
    match_type: &str,
    compact: bool,
) -> String {
    terms
        .iter()
        .map(|term| {
            let term = term.as_ref();
            if is_text_phrase(term) {
                return match match_type {
                    "regexp" => format!("\"{}\"", term),
                    _ => phrase(term),
                };
            }
            let word = one_word(term);
            let long = word.unwrap_or(term).chars().count() >= MIN_PREFIX_LEN;
            match (match_type, word) {
                // Regexp punctuation is syntax, so the term runs as typed.
                ("regexp", _) if term.chars().count() >= MIN_PREFIX_LEN => format!("{}*", term),
                ("regexp", _) if !compact || holds_syntax(term) => format!("({})", term),
                ("partial", Some(word)) if long => format!("{}*", escape_syntax(word)),
                _ if compact => phrase(term),
                _ => format!("({})", escape_syntax(word.unwrap_or(term))),
            }
        })
        .collect::<Vec<_>>()
        .join(" + ")
}
