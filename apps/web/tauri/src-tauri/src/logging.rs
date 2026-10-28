use tracing_subscriber::EnvFilter;

const DEPENDENCY_FILTERS: &str =
    "turso_core=warn,tungstenite=info,tokio_tungstenite=info,reqwest=info,hyper=info,h2=info";

/// Keep per-row/page Turso spans out of the default native logging pipeline,
/// especially iOS OS activity logging. An explicit RUST_LOG still takes priority.
pub(super) fn default_filter(debug: bool) -> EnvFilter {
    let level = if debug { "debug" } else { "info" };
    EnvFilter::new(format!("{level},{DEPENDENCY_FILTERS}"))
}

#[cfg(test)]
mod test;
