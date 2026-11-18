//! Pinned live upstream expressions; all compile once at startup.
use crate::matcher::RegexMatcher;
use std::sync::LazyLock;
pub(crate) static ORDERED_LIST: LazyLock<RegexMatcher> = LazyLock::new(|| {
    RegexMatcher::new(r###"^(\s*)(\d{1,})\.\s"###, "").expect("upstream ORDERED_LIST")
});
pub(crate) static UNORDERED_LIST: LazyLock<RegexMatcher> = LazyLock::new(|| {
    RegexMatcher::new(r###"^(\s*)[-*+]\s"###, "").expect("upstream UNORDERED_LIST")
});
pub(crate) static CHECK_LIST: LazyLock<RegexMatcher> = LazyLock::new(|| {
    RegexMatcher::new(r###"^(\s*)(?:[-*+]\s)?\s?(\[(\s|x)?\])\s"###, "i")
        .expect("upstream CHECK_LIST")
});
pub(crate) static HEADING: LazyLock<RegexMatcher> =
    LazyLock::new(|| RegexMatcher::new(r###"^(#{1,6})\s"###, "").expect("upstream HEADING"));
pub(crate) static QUOTE: LazyLock<RegexMatcher> =
    LazyLock::new(|| RegexMatcher::new(r###"^>\s"###, "").expect("upstream QUOTE"));
pub(crate) static CODE_START: LazyLock<RegexMatcher> = LazyLock::new(|| {
    RegexMatcher::new(r###"^([ \t]*`{3,})([\w-]+)?[ \t]?"###, "").expect("upstream CODE_START")
});
pub(crate) static CODE_END: LazyLock<RegexMatcher> =
    LazyLock::new(|| RegexMatcher::new(r###"^[ \t]*`{3,}$"###, "").expect("upstream CODE_END"));
pub(crate) static CODE_SINGLE_LINE: LazyLock<RegexMatcher> = LazyLock::new(|| {
    RegexMatcher::new(
        r###"^[ \t]*```[^`]+(?:(?:`{1,2}|`{4,})[^`]+)*```(?:[^`]|$)"###,
        "",
    )
    .expect("upstream CODE_SINGLE_LINE")
});
pub(crate) static TABLE_ROW: LazyLock<RegexMatcher> = LazyLock::new(|| {
    RegexMatcher::new(r###"^(?:\|)(.+)(?:\|)\s?$"###, "").expect("upstream TABLE_ROW")
});
pub(crate) static TABLE_ROW_DIVIDER: LazyLock<RegexMatcher> = LazyLock::new(|| {
    RegexMatcher::new(r###"^(\| ?:?-*:? ?)+\|\s?$"###, "").expect("upstream TABLE_ROW_DIVIDER")
});
pub(crate) static TAG_START: LazyLock<RegexMatcher> = LazyLock::new(|| {
    RegexMatcher::new(r###"^<[a-z_][\w-]*(?:\s[^<>]*)?/?>"###, "i").expect("upstream TAG_START")
});
pub(crate) static TAG_END: LazyLock<RegexMatcher> = LazyLock::new(|| {
    RegexMatcher::new(r###"^</[a-z_][\w-]*\s*>"###, "i").expect("upstream TAG_END")
});
pub(crate) static TAG_START_AT_END: LazyLock<RegexMatcher> = LazyLock::new(|| {
    RegexMatcher::new(r###"(?:^<[a-z_][\w-]*(?:\s[^<>]*)?/?>)$"###, "i")
        .expect("upstream TAG_START_AT_END")
});
pub(crate) static TAG_END_AT_END: LazyLock<RegexMatcher> = LazyLock::new(|| {
    RegexMatcher::new(r###"(?:^</[a-z_][\w-]*\s*>)$"###, "i").expect("upstream TAG_END_AT_END")
});
pub(crate) static CODE_SPAN: LazyLock<RegexMatcher> = LazyLock::new(|| {
    RegexMatcher::new(r###"(^|[^\\`])(`)((?:\\`|[^`])+?)(`)(?!`)"###, "")
        .expect("upstream CODE_SPAN")
});
pub(crate) static LIST_ESCAPE: LazyLock<RegexMatcher> = LazyLock::new(|| {
    RegexMatcher::new(r###"^(\s{0,3}\d+)(\.\s)"###, "").expect("upstream LIST_ESCAPE")
});
pub(crate) static LINK_IMPORT: LazyLock<RegexMatcher> = LazyLock::new(|| {
    RegexMatcher::new(
        r###"(?:\[(.+?)\])(?:\((?:([^()\s]+)(?:\s"((?:[^"]*\\")*[^"]*)"\s*)?)\))"###,
        "",
    )
    .expect("upstream LINK_IMPORT")
});
pub(crate) static LINK: LazyLock<RegexMatcher> = LazyLock::new(|| {
    RegexMatcher::new(r###"(?:\[([^[\]]*(?:\[[^[\]]*\][^[\]]*)*)\])(?:\((?:([^()\s]+)(?:\s"((?:[^"]*\\")*[^"]*)"\s*)?)\))$"###,"").expect("upstream LINK")
});

#[cfg(test)]
pub(crate) fn inventory() -> Vec<(&'static str, &'static RegexMatcher)> {
    vec![
        ("ORDERED_LIST", &*ORDERED_LIST),
        ("UNORDERED_LIST", &*UNORDERED_LIST),
        ("CHECK_LIST", &*CHECK_LIST),
        ("HEADING", &*HEADING),
        ("QUOTE", &*QUOTE),
        ("CODE_START", &*CODE_START),
        ("CODE_END", &*CODE_END),
        ("CODE_SINGLE_LINE", &*CODE_SINGLE_LINE),
        ("TABLE_ROW", &*TABLE_ROW),
        ("TABLE_ROW_DIVIDER", &*TABLE_ROW_DIVIDER),
        ("TAG_START", &*TAG_START),
        ("TAG_END", &*TAG_END),
        ("TAG_START_AT_END", &*TAG_START_AT_END),
        ("TAG_END_AT_END", &*TAG_END_AT_END),
        ("CODE_SPAN", &*CODE_SPAN),
        ("LIST_ESCAPE", &*LIST_ESCAPE),
        ("LINK_IMPORT", &*LINK_IMPORT),
        ("LINK", &*LINK),
    ]
}
