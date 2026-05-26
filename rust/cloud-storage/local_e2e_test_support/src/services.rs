use anyhow::{Context, ensure};
use url::Url;

use crate::LocalE2eConfig;

const DEFAULT_DOCUMENT_STORAGE_URL: &str = "http://localhost:8086";
const DEFAULT_CONNECTION_GATEWAY_WS_URL: &str = "ws://localhost:8082/";

/// Host URLs for services used by local E2E tests.
#[derive(Clone, Debug)]
pub struct LocalE2eServices {
    document_storage_url: String,
    connection_gateway_ws_url: String,
}

impl LocalE2eServices {
    /// Load service URLs from config, falling back to the standard local ports.
    pub fn from_config(config: &LocalE2eConfig) -> anyhow::Result<Self> {
        let document_storage_url = trim_trailing_slash(
            config
                .get("LOCAL_E2E_DOCUMENT_STORAGE_URL")
                .unwrap_or(DEFAULT_DOCUMENT_STORAGE_URL),
        );
        let connection_gateway_ws_url = config
            .get("LOCAL_E2E_CONNECTION_GATEWAY_WS_URL")
            .unwrap_or(DEFAULT_CONNECTION_GATEWAY_WS_URL)
            .to_owned();

        validate_local_service_url(
            &document_storage_url,
            "document storage",
            &["http", "https"],
        )?;
        validate_local_service_url(
            &connection_gateway_ws_url,
            "connection gateway websocket",
            &["ws", "wss"],
        )?;

        Ok(Self {
            document_storage_url,
            connection_gateway_ws_url,
        })
    }

    /// Load service URLs using default config discovery.
    pub fn load() -> anyhow::Result<Self> {
        let config = LocalE2eConfig::load()?;
        Self::from_config(&config)
    }

    /// Base URL for document storage service HTTP endpoints.
    pub fn document_storage_url(&self) -> &str {
        &self.document_storage_url
    }

    /// URL for posting a channel message through document storage's comms API.
    pub fn post_channel_message_url(&self, channel_id: &str) -> String {
        format!(
            "{}/comms/channels/{}/message",
            self.document_storage_url, channel_id
        )
    }

    /// URL for fetching channel data through document storage's comms API.
    pub fn get_channel_url(&self, channel_id: &str) -> String {
        format!(
            "{}/comms/channels/{}",
            self.document_storage_url, channel_id
        )
    }

    /// Connection gateway websocket URL with a `macro-api-token` query param.
    pub fn connection_gateway_ws_url_with_token(&self, token: &str) -> anyhow::Result<String> {
        let mut url = Url::parse(&self.connection_gateway_ws_url)
            .with_context(|| format!("invalid websocket URL {}", self.connection_gateway_ws_url))?;
        url.query_pairs_mut().append_pair("macro-api-token", token);
        Ok(url.to_string())
    }
}

fn trim_trailing_slash(value: &str) -> String {
    value.trim_end_matches('/').to_owned()
}

fn validate_local_service_url(
    raw_url: &str,
    service_name: &str,
    allowed_schemes: &[&str],
) -> anyhow::Result<()> {
    let url =
        Url::parse(raw_url).with_context(|| format!("invalid {service_name} URL {raw_url}"))?;
    let host = url.host_str().unwrap_or_default();

    ensure!(
        allowed_schemes.contains(&url.scheme()),
        "refusing to run local E2E tests against {service_name} URL {raw_url}; expected scheme in {allowed_schemes:?}"
    );
    ensure!(
        matches!(host, "localhost" | "127.0.0.1" | "::1"),
        "refusing to run local E2E tests against non-local {service_name} URL {raw_url}"
    );

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::validate_local_service_url;

    #[test]
    fn local_service_urls_must_be_localhost() {
        validate_local_service_url("http://localhost:8086", "document storage", &["http"]).unwrap();
        validate_local_service_url("ws://127.0.0.1:8082/", "gateway", &["ws"]).unwrap();
        validate_local_service_url(
            "http://macro-db-dev.example.com",
            "document storage",
            &["http"],
        )
        .unwrap_err();
        validate_local_service_url("http://localhost:8082", "gateway", &["ws"]).unwrap_err();
    }
}
