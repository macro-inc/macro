use clap::Parser;
use url::Url;
use uuid::Uuid;

#[derive(Debug, Parser)]
#[command(name = "macro", about = "Macro desktop")]
struct LaunchOptions {
    /// Record app memory and all emitted frontend OTel spans until app exit.
    #[arg(long, requires = "otel_traces_url")]
    record_memory: bool,
    /// Full OTLP HTTP /v1/traces endpoint (no API key needed for the Macro proxy).
    #[arg(long, requires = "record_memory", value_parser = traces_url)]
    otel_traces_url: Option<Url>,
    /// URLs passed by the operating system's deep-link handler.
    urls: Vec<String>,
}

fn traces_url(value: &str) -> Result<Url, String> {
    let url = Url::parse(value).map_err(|e| e.to_string())?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.path().trim_end_matches('/').ends_with("/v1/traces")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(
            "expected an http(s) URL ending in /v1/traces, without credentials, query or fragment"
                .into(),
        );
    }
    Ok(url)
}

pub(super) fn configuration() -> (Option<String>, Option<String>) {
    let options = LaunchOptions::parse();
    if options.record_memory && !cfg!(target_os = "macos") {
        use clap::{CommandFactory, error::ErrorKind};
        LaunchOptions::command()
            .error(
                ErrorKind::InvalidValue,
                "memory recording currently supports macOS only",
            )
            .exit();
    }
    (
        options.record_memory.then(|| Uuid::new_v4().to_string()),
        options.otel_traces_url.map(|url| url.to_string()),
    )
}

#[cfg(test)]
#[path = "launch_test.rs"]
mod test;
