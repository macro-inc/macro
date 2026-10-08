use super::PipedreamClient;
use crate::domain::models::{
    ConnectProxyError, PipedreamConnection, ProxyMethod, ProxyRequest, ProxyResponse,
};
use crate::domain::ports::ConnectProxyTransport;
use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use std::time::Duration;

#[cfg(test)]
mod test;

/// Headers with this prefix are forwarded upstream by the Connect API proxy.
const UPSTREAM_HEADER_PREFIX: &str = "x-pd-proxy-";

impl PipedreamClient {
    /// The proxy endpoint for `target`: the URL travels URL-safe base64
    /// encoded (unpadded) in the path.
    fn proxy_url(&self, target: &str) -> String {
        self.connect_api(&format!("/proxy/{}", URL_SAFE_NO_PAD.encode(target)))
    }
}

impl ConnectProxyTransport for PipedreamClient {
    #[tracing::instrument(skip(self, connection, request), fields(app_slug = %connection.app_slug, method = ?request.method), err)]
    async fn send(
        &self,
        connection: &PipedreamConnection,
        request: ProxyRequest,
    ) -> Result<ProxyResponse, ConnectProxyError> {
        let url = self.proxy_url(&request.url);
        let builder = match request.method {
            ProxyMethod::Get => self.http.get(url),
            ProxyMethod::Post => self.http.post(url),
        };
        // The same external user id the MCP path and Connect tokens use.
        let mut builder = self.authed(builder).await?.query(&[
            ("external_user_id", connection.user_id.as_ref()),
            ("account_id", connection.account_id.as_str()),
        ]);
        for (name, value) in &request.headers {
            builder = builder.header(
                format!("{UPSTREAM_HEADER_PREFIX}{}", name.to_ascii_lowercase()),
                value,
            );
        }
        if let Some(body) = &request.body {
            builder = builder.json(body);
        }

        let response = builder
            .send()
            .await
            .map_err(|e| anyhow::Error::new(e).context("sending proxied request"))?;
        let status = response.status().as_u16();
        let retry_after = response
            .headers()
            .get(reqwest::header::RETRY_AFTER)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.trim().parse::<u64>().ok())
            .map(Duration::from_secs);
        let body = response
            .bytes()
            .await
            .map_err(|e| anyhow::Error::new(e).context("reading proxied response"))?
            .to_vec();
        Ok(ProxyResponse {
            status,
            retry_after,
            body,
        })
    }
}
