//! Whole-URL paste parsers, separate from fuzzy autolink matching.
use indexmap::IndexMap;
use std::sync::LazyLock;

pub(super) struct PrUrl {
    pub github_key: String,
    pub label: String,
    pub canonical: String,
}
pub(super) fn trim_js(text: &str) -> &str {
    text.trim_matches(lexical_model::is_js_whitespace)
}
pub(super) fn parse_pr(text: &str) -> Option<PrUrl> {
    let text = trim_js(text);
    if text.is_empty() || text.chars().any(lexical_model::is_js_whitespace) {
        return None;
    }
    let url = url::Url::parse(text).ok()?;
    if !matches!(url.scheme(), "http" | "https")
        || !matches!(url.host_str(), Some("github.com" | "www.github.com"))
    {
        return None;
    }
    static PATH: LazyLock<regress::Regex> = LazyLock::new(|| {
        regress::Regex::new(r"^/([A-Za-z0-9-]+)/([A-Za-z0-9._-]+)/pull/([1-9][0-9]*)(?:/.*)?$")
            .expect("literal PR path regex")
    });
    let path = url.path();
    let found = PATH.find(path)?;
    let owner = path.get(found.group(1)?)?;
    let repo = path.get(found.group(2)?)?;
    let number = path.get(found.group(3)?)?.parse::<f64>().ok()?;
    let number = if number.is_infinite() {
        "Infinity".into()
    } else {
        lexical_model::to_js_json_string(&lexical_model::js_number(number))
    };
    Some(PrUrl {
        github_key: format!("{owner}/{repo}/pull/{number}"),
        label: format!("{owner}/{repo}#{number}"),
        canonical: format!("https://github.com/{owner}/{repo}/pull/{number}"),
    })
}
#[derive(Clone, Debug, serde::Deserialize)]
pub(in crate::plugins_group_b) struct AppLink {
    pub id: String,
    pub block: String,
    #[serde(default)]
    pub params: IndexMap<String, String>,
}
pub(in crate::plugins_group_b) fn parse_app(
    text: &str,
    hostname: &str,
    native: bool,
) -> Option<AppLink> {
    let url = url::Url::parse(text).ok()?;
    fn clean(host: &str) -> String {
        let host = host.to_lowercase();
        host.strip_prefix("www.").unwrap_or(&host).into()
    }
    let target = clean(url.host_str()?);
    let current = clean(hostname);
    let valid_host = target == current
        || (target == "dev.macro.com" && current == "localhost")
        || (target == "localhost" && current == "dev.macro.com")
        || (native
            && matches!(current.as_str(), "localhost" | "tauri.localhost")
            && matches!(
                target.as_str(),
                "macro.com" | "dev.macro.com" | "staging.macro.com"
            ));
    if !valid_host || !url.path().starts_with("/app/") {
        return None;
    }
    let parts: Vec<_> = url
        .path()
        .split('/')
        .filter(|part| !part.is_empty())
        .collect();
    let [_, block, id] = parts.as_slice() else {
        return None;
    };
    let block = if *block == "agents" { "agent" } else { block };
    static BLOCKS: LazyLock<Vec<String>> = LazyLock::new(|| {
        serde_json::from_str(include_str!("app-blocks.json")).expect("generated app block catalog")
    });
    if !BLOCKS.iter().any(|name| name == block) {
        return None;
    }
    static ID: LazyLock<regress::Regex> = LazyLock::new(|| {
        regress::Regex::new(
            r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$",
        )
        .expect("literal app id regex")
    });
    ID.find(id)?;
    let params = url
        .query_pairs()
        .filter(|(key, _)| key != "referral_code" && key != "__proto__")
        .map(|(key, value)| (key.into_owned(), value.into_owned()))
        .collect();
    Some(AppLink {
        id: (*id).into(),
        block: block.into(),
        params,
    })
}
