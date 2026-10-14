//! Image and link URL policy, matching the web renderer's `resource-policy.ts`.

use std::sync::LazyLock;

use regex::Regex;

/// Whether remote images may load.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RemoteImages {
    /// Remote images load, through the proxy for `img[src]` when one is set.
    Allow,
    /// Remote image references are removed from HTML and CSS.
    Block,
}

/// Explicit image policy: preparation never reads an origin, flag or network.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImagePolicy {
    /// Whether remote images may load.
    pub remote: RemoteImages,
    /// Proxy endpoint for HTTP(S) `img[src]`. CSS and HTML background images
    /// keep direct URLs under the remote policy.
    pub proxy_url: Option<String>,
}

impl ImagePolicy {
    /// Remote images allowed, without a proxy.
    pub fn allow() -> Self {
        Self {
            remote: RemoteImages::Allow,
            proxy_url: None,
        }
    }

    /// The same remote policy without the `img[src]` proxy.
    pub(super) fn without_proxy(&self) -> Self {
        Self {
            remote: self.remote,
            proxy_url: None,
        }
    }
}

static SCHEME: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)^[a-z][a-z\d+.-]*:").expect("valid regex"));
static HTTP: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)^https?://").expect("valid regex"));
static HTTP_SCHEME: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)^https?:").expect("valid regex"));
static CID: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)^cid:").expect("valid regex"));
static RASTER_DATA: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)^data:image/(?:png|gif|jpe?g|webp|avif|bmp);base64,[a-z0-9+/=]+$")
        .expect("valid regex")
});
static SAFE_LINK: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)^(?:https?://|mailto:|tel:|sms:|cid:)").expect("valid regex")
});

/// JavaScript's `String.prototype.trim` whitespace: WhiteSpace and LineTerminator.
pub(super) fn is_js_whitespace(c: char) -> bool {
    matches!(
        c,
        '\t' | '\n' | '\u{0B}' | '\u{0C}' | '\r' | ' ' | '\u{A0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200A}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202F}'
                | '\u{205F}'
                | '\u{3000}'
                | '\u{FEFF}'
    )
}

fn clean_url(value: &str) -> String {
    let url: String = value
        .chars()
        .filter(|&c| c >= '\u{20}' && c != '\u{7F}')
        .collect();
    let url = url.trim_matches(is_js_whitespace);
    match url.strip_prefix("//") {
        Some(rest) => format!("https://{rest}"),
        None => url.to_string(),
    }
}

/// JavaScript's `encodeURIComponent`.
fn encode_uri_component(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&byte) {
            out.push(byte as char);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

/// Relative resources stay literal; only the browser resolves their base URL.
pub(super) fn image_url(value: &str, policy: &ImagePolicy) -> Option<String> {
    let url = clean_url(value);
    if CID.is_match(&url) {
        return Some(format!("cid:{}", &url[4..]));
    }
    if RASTER_DATA.is_match(&url) {
        return Some(url);
    }
    if policy.remote == RemoteImages::Block {
        return None;
    }
    if !SCHEME.is_match(&url) {
        return Some(url);
    }
    if !HTTP.is_match(&url) {
        return None;
    }
    let Some(proxy) = &policy.proxy_url else {
        return Some(
            HTTP_SCHEME
                .replace(&url, |caps: &regex::Captures<'_>| caps[0].to_lowercase())
                .into_owned(),
        );
    };
    if !HTTP.is_match(proxy) {
        return None;
    }
    let separator = if proxy.contains('?') { '&' } else { '?' };
    Some(format!(
        "{proxy}{separator}url={}",
        encode_uri_component(&url)
    ))
}

pub(super) fn link_url(value: &str) -> Option<String> {
    let url = clean_url(value);
    (SAFE_LINK.is_match(&url) || !SCHEME.is_match(&url)).then_some(url)
}
