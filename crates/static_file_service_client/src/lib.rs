pub mod delete_file;
pub mod get_file;
pub mod put_file;

pub static INTERNAL_ACCESS_HEADER: &str = "x-internal-auth-key";
/// Names the user an internal request acts for; the service records them as
/// the owner of files it reserves.
pub static INTERNAL_MACRO_USER_ID_HEADER: &str = "x-internal-macro-user-id";

#[derive(Clone)]
pub struct StaticFileServiceClient {
    url: String,
    client: reqwest::Client,
}

impl StaticFileServiceClient {
    pub fn new(internal_auth_key: String, url: String) -> Self {
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert(INTERNAL_ACCESS_HEADER, internal_auth_key.parse().unwrap());

        let client = reqwest::Client::builder()
            .default_headers(headers)
            .build()
            .unwrap();

        Self { url, client }
    }
}
