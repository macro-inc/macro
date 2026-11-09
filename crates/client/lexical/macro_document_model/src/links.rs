//! Shared URL normalization and linkify-it modes used by imports and link editing.
use lexical_model::js_trim;
pub use lexical_rich_nodes::utils::linkify::LinkMatch;
use lexical_rich_nodes::utils::{
    linkify::{LinkifyIt, Options},
    matcher::{Matcher, RegexMatcher},
};
use std::sync::LazyLock;
/// Domain recognition policy for typed links and ordinary Markdown imports.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum AutoLinkMode {
    /// Require an explicit protocol, with ordinary fuzzy email recognition.
    #[default]
    Protocol,
    /// Recognize bare hosts only with the source's curated common suffixes.
    CommonTlds,
    /// Recognize bare hosts using linkify-it defaults.
    Fuzzy,
}
static PROTOCOL: LazyLock<LinkifyIt> = LazyLock::new(|| {
    LinkifyIt::with_options(Options {
        fuzzy_link: false,
        ..Default::default()
    })
    .expect("source strict linkifier options")
});
static FUZZY: LazyLock<LinkifyIt> = LazyLock::new(LinkifyIt::default);
static COMMON: LazyLock<LinkifyIt> = LazyLock::new(|| {
    let tlds = [
        "app", "biz", "ca", "co", "com", "dev", "edu", "gov", "info", "io", "me", "net", "org",
        "shop", "site", "store", "tv", "uk", "us", "xyz",
    ]
    .map(str::to_owned);
    LinkifyIt::with_replaced_tlds(Options::default(), &tlds).expect("source common suffix patterns")
});
fn encode_uri_segment(segment: &str) -> String {
    let mut encoded = urlencoding::encode(segment).into_owned();
    for (escape, text) in [
        ("%3B", ";"),
        ("%2F", "/"),
        ("%3F", "?"),
        ("%3A", ":"),
        ("%40", "@"),
        ("%26", "&"),
        ("%3D", "="),
        ("%2B", "+"),
        ("%24", "$"),
        ("%2C", ","),
        ("%23", "#"),
        ("%21", "!"),
        ("%27", "'"),
        ("%28", "("),
        ("%29", ")"),
        ("%2A", "*"),
    ] {
        encoded = encoded.replace(escape, text);
    }
    let regex =
        RegexMatcher::new("%25([\\da-f]{2})", "i").expect("source encoded percent expression");
    let mut output = String::new();
    let mut cursor = 0;
    // The encoded input is ASCII, so UTF-16 match offsets are byte offsets here.
    for m in regex.find_all(&encoded) {
        output.push_str(
            encoded
                .get(cursor..m.index.get() as usize)
                .expect("matcher offset in encoded ASCII"),
        );
        output.push('%');
        output.push_str(m.get(1).unwrap_or(""));
        cursor = m.end().get() as usize;
    }
    output.push_str(
        encoded
            .get(cursor..)
            .expect("matcher endpoint in encoded ASCII"),
    );
    output
}
/// Normalize an editable URL, adding HTTPS to bare hosts and rejecting unsafe schemes.
pub fn normalize_link_url(input: &str) -> Option<String> {
    let trimmed = js_trim(input);
    if trimmed.is_empty() {
        return None;
    }
    let probe = trimmed.replace(['\t', '\n', '\r'], "");
    let regex =
        RegexMatcher::new(r"^([a-z][a-z\d+.-]*):", "i").expect("source URL scheme expression");
    let scheme = regex.exec(&probe);
    let is_host_with_port = scheme.as_ref().is_some_and(|m| {
        let name = m.get(1).unwrap_or("").to_lowercase();
        (name == "localhost" || name.contains('.'))
            && RegexMatcher::new(r"^\d+(?:[/?#]|$)", "")
                .expect("source host port expression")
                .test(probe.strip_prefix(m.full()).unwrap_or(""))
    });
    let candidate = if scheme.is_some() && !is_host_with_port {
        trimmed.to_owned()
    } else {
        format!("https://{trimmed}")
    };
    let parsed = url::Url::parse(&candidate).ok()?;
    match parsed.scheme() {
        "mailto" => return Some(trimmed.into()),
        "http" | "https" => {}
        _ => return None,
    }
    let split = candidate.find(['#', '?']).unwrap_or(candidate.len());
    let base = candidate.get(..split)?;
    let suffix = candidate.get(split..)?;
    let encoded = base
        .split('/')
        .map(|segment| {
            if segment.contains(':') {
                segment.to_owned()
            } else {
                encode_uri_segment(segment)
            }
        })
        .collect::<Vec<_>>()
        .join("/");
    Some(encoded + suffix)
}
/// Find normalized URL candidates with source UTF-16 offsets and raw labels.
pub fn find_auto_link_matches(text: &str, mode: AutoLinkMode) -> Vec<LinkMatch> {
    let linkifier = match mode {
        AutoLinkMode::Protocol => &*PROTOCOL,
        AutoLinkMode::CommonTlds => &*COMMON,
        AutoLinkMode::Fuzzy => &*FUZZY,
    };
    linkifier
        .matches(text)
        .into_iter()
        .filter_map(|mut link| {
            link.url = normalize_link_url(if link.schema.is_empty() {
                &link.raw
            } else {
                &link.url
            })?;
            Some(link)
        })
        .collect()
}
/// First recognized normalized URL in source order.
pub fn find_next_auto_link_match(text: &str, mode: AutoLinkMode) -> Option<LinkMatch> {
    find_auto_link_matches(text, mode).into_iter().next()
}
