//! Favicon helpers used to fill in a default favicon when meta-tag extraction
//! didn't produce one.

use std::collections::HashMap;
use url::Url;

/// Returns the conventional `<scheme>://<host>[:<port>]/favicon.ico` URL for
/// the given input URL.
pub fn favico_url(url: &str) -> Result<String, anyhow::Error> {
    let url = Url::parse(url).map_err(|e| anyhow::anyhow!("failed to parse url: {e}"))?;
    let host = url.host().ok_or_else(|| anyhow::anyhow!("no host"))?;
    let scheme = url.scheme();
    let port = url
        .port()
        .map(|port| format!(":{port}"))
        .unwrap_or_default();
    Ok(format!("{scheme}://{host}{port}/favicon.ico"))
}

/// Inserts a conventional `/favicon.ico` URL into `meta_tags` when one wasn't
/// already extracted from the page's `<link>` tags.
pub fn append_optimistic_favico(
    mut meta_tags: HashMap<String, String>,
    url: &str,
) -> HashMap<String, String> {
    let optimistic_url = favico_url(url)
        .inspect_err(|err| tracing::debug!(error=?err, "could not form favicon url"));

    if !meta_tags.contains_key("favicon")
        && let Ok(url) = optimistic_url
    {
        meta_tags.insert("favicon".to_string(), url);
    }

    meta_tags
}
