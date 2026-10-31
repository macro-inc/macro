use std::time::Duration;

use opentelemetry::global;
use opentelemetry_http::HeaderInjector;
use reqwest::{Method, header::HeaderMap};
use tracing_opentelemetry::OpenTelemetrySpanExt as _;

#[derive(Clone)]
pub struct VendorMcp {
    http: reqwest::Client,
}

impl VendorMcp {
    pub fn new() -> Result<Self, reqwest::Error> {
        let http = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .read_timeout(Duration::from_secs(300))
            .redirect(reqwest::redirect::Policy::none())
            .build()?;
        Ok(Self { http })
    }

    #[tracing::instrument(name = "connect.mcp.vendor_http", skip_all, fields(vendor_status), err)]
    pub async fn send(
        &self,
        method: Method,
        url: &str,
        mut headers: HeaderMap,
        access_token: &str,
        body: reqwest::Body,
    ) -> Result<reqwest::Response, reqwest::Error> {
        global::get_text_map_propagator(|propagator| {
            propagator.inject_context(
                &tracing::Span::current().context(),
                &mut HeaderInjector(&mut headers),
            );
        });
        let response = self
            .http
            .request(method, url)
            .headers(headers)
            .bearer_auth(access_token)
            .body(body)
            .send()
            .await?;
        tracing::Span::current().record("vendor_status", response.status().as_u16());
        Ok(response)
    }
}
