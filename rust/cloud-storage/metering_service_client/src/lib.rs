pub use models_metering::{
    CreateUsageRecordRequest, CreateUsageRecordRequestBuilder,
    CreateUsageRecordRequestBuilderError, OperationType, ServiceName, Usage, UsageQuery,
    UsageReport, paths,
};
use reqwest::header::InvalidHeaderValue;
use tracing::instrument;

pub const INTERNAL_API_KEY_HEADER: &str = "x-internal-auth-key";

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("Error from reqwest: {0}")]
    ReqwestError(#[from] reqwest::Error),
    #[error("Invalid auth key header value")]
    InvalidHeaderValue(#[from] InvalidHeaderValue),
}
#[derive(Clone, Debug)]
pub struct Client {
    url: String,
    client: reqwest::Client,
    disabled: bool,
}

impl Client {
    pub fn new(internal_auth_key: String, url: String, disabled: bool) -> Result<Self, Error> {
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert(INTERNAL_API_KEY_HEADER, internal_auth_key.parse()?);

        let client = reqwest::Client::builder()
            .default_headers(headers)
            .build()?;

        Ok(Self {
            url,
            client,
            disabled,
        })
    }

    #[instrument(err)]
    pub async fn record_usage(&self, usage: CreateUsageRecordRequest) -> Result<Usage, Error> {
        if self.disabled {
            return Ok(Usage::default());
        }
        let url = format!("{}{}", self.url, paths::USAGE);
        Ok(self
            .client
            .post(&url)
            .json(&usage)
            .send()
            .await?
            .json()
            .await?)
    }

    #[instrument(err)]
    pub async fn get_usages(&self, query: UsageQuery) -> Result<UsageReport, Error> {
        if self.disabled {
            return Ok(UsageReport::default());
        }
        let url = format!("{}{}", self.url, paths::USAGE);
        Ok(self
            .client
            .get(&url)
            .query(&query)
            .send()
            .await?
            .json()
            .await?)
    }
}
