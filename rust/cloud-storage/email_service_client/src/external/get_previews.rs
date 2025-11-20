use super::EmailServiceClientExternal;
use anyhow::Result;
use email::inbound::ApiPaginatedThreadCursor;
use models_email::email::service::thread::PreviewView;
use reqwest::Method;
use reqwest::Url;
use std::borrow::Cow;

impl EmailServiceClientExternal {
    pub async fn get_thread_previews_external(
        &self,
        params: impl Iterator<Item = (&'static str, Cow<'_, str>)>,
        view: PreviewView,
        jwt: &str,
    ) -> Result<ApiPaginatedThreadCursor> {
        let url = format!("{}/email/threads/previews/cursor/{}", self.url, view);
        let url_with_params = Url::parse_with_params(&url, params)?;
        let res = self
            .request_url(Method::GET, url_with_params.as_str(), jwt)
            .send()
            .await?;

        if !res.status().is_success() {
            let code = res.status();
            let body = res.text().await.unwrap_or("no body".to_string());
            tracing::error!(
                body=%body,
                status=%code,
                params=%url_with_params,
                view=%view,
                "external API error when fetching document location"
            );
            Err(anyhow::anyhow!("HTTP {}: {}", code, body))
        } else {
            res.json::<ApiPaginatedThreadCursor>()
                .await
                .map_err(anyhow::Error::from)
        }
    }
}
