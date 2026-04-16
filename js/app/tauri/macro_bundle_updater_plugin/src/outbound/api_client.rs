use crate::domain::{
    models::{BundleUpdate, DownloadBundleError, DownloadBundleRequest, Progress},
    ports::UpdateRepo,
};
use futures::TryStreamExt;
use reqwest::{StatusCode, header::CONTENT_LENGTH};
use rootcause::{Report, report};
use thiserror::Error;
use tokio::io::AsyncWriteExt;
use url::Url;

pub struct BundleClient {
    client: reqwest::Client,
    base: Url,
}

#[derive(Debug, Error)]
pub enum BundleClientErr {
    #[error(transparent)]
    Reqwest(#[from] reqwest::Error),
    #[error("Url {0} cannot be a base")]
    CannotBeABase(Url),
}

impl BundleClient {
    pub fn new(mut base: Url) -> Self {
        base.set_path("");
        let client = reqwest::Client::new();
        Self { client, base }
    }

    // pub async fn request(&self) -> Result<Option<BundleUpdate>, BundleClientErr> {
    // }
}

impl UpdateRepo for BundleClient {
    async fn check_for_update(
        &self,
        request: crate::domain::models::AppInfo,
    ) -> Result<Option<BundleUpdate>, rootcause::Report> {
        let mut url = self.base.clone();
        url.path_segments_mut()
            .map_err(|_| BundleClientErr::CannotBeABase(self.base.clone()))?
            .clear()
            .push("update")
            .push("bundle")
            .push(request.target.into())
            .push(request.arch.into())
            .push(&request.current_version.to_string());

        let res = self.client.get(url).send().await?.error_for_status()?;

        if res.status() == StatusCode::NO_CONTENT {
            return Ok(None);
        }

        Ok(Some(res.json().await?))
    }

    async fn get_update_bundle<P: AsRef<std::path::Path> + Send>(
        &self,
        request: crate::domain::models::DownloadBundleRequest<P>,
    ) -> Result<(), Report<DownloadBundleError>> {
        let DownloadBundleRequest {
            url,
            destination,
            on_progress,
            ..
        } = request;
        let res = self
            .client
            .get(url)
            .send()
            .await
            .map_err(|e| report!(e).context(DownloadBundleError::OtherError))?
            .error_for_status()
            .map_err(|e| report!(e).context(DownloadBundleError::OtherError))?;

        let mut content_length_progress = res
            .headers()
            .get(CONTENT_LENGTH)
            .and_then(|v| v.to_str().ok())
            .and_then(|x| x.parse::<usize>().ok())
            .map(Progress::from_total);

        let mut file = tokio::fs::File::create(destination.as_ref())
            .await
            .map_err(|e| report!(e).context(DownloadBundleError::FileError))?;

        let mut stream = res
            .bytes_stream()
            .map_err(|e| report!(e).context(DownloadBundleError::OtherError));
        while let Some(mut chunk) = stream.try_next().await? {
            let size = chunk.len();
            file.write_all_buf(&mut chunk)
                .await
                .map_err(|e| report!(e).context(DownloadBundleError::FileError))?;

            if let Some(progress) = content_length_progress.as_mut() {
                progress.inc_by(size);
                on_progress
                    .send(progress.percentage())
                    .await
                    .inspect_err(|e| tracing::error!("Failed to send {e:?}"))
                    .ok();
            }
        }

        file.flush()
            .await
            .map_err(|e| report!(e).context(DownloadBundleError::FileError))?;
        file.sync_all()
            .await
            .map_err(|e| report!(e).context(DownloadBundleError::FileError))?;

        Ok(())
    }
}
