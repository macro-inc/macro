mod get_previews;
mod init_email;

pub use init_email::InitEmailOutcome;

#[derive(Clone, Debug)]
pub struct EmailServiceClientExternal {
    url: String,
    client: reqwest::Client,
}

impl EmailServiceClientExternal {
    pub fn new(url: String) -> Self {
        Self {
            url,
            client: reqwest::Client::new(),
        }
    }

    pub(crate) fn request(
        &self,
        method: reqwest::Method,
        path: &str,
        jwt_token: &str,
    ) -> reqwest::RequestBuilder {
        self.request_url(method, format!("{}{}", self.url, path).as_str(), jwt_token)
    }

    pub(crate) fn request_url(
        &self,
        method: reqwest::Method,
        url: &str,
        jwt_token: &str,
    ) -> reqwest::RequestBuilder {
        self.client
            .request(method, url)
            .header("Authorization", format!("Bearer {}", jwt_token))
    }
}
