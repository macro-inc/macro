//! Publishing gathered files through the agent egress.
//!
//! The wire shapes mirror the document storage service's artifact API
//! (`POST /artifacts`, `/artifacts/{id}/uploads`, `/artifacts/{id}/versions`,
//! `GET /artifacts/{id}`), which the egress serves under the same paths.

use std::collections::BTreeMap;

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD as BASE64;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::files::LocalFile;

#[cfg(test)]
pub(crate) mod test;

/// Below this many bytes in total, a new artifact is created with its files
/// inline in one request; the storage service takes request bodies up to
/// 32 MiB, and base64 grows the bytes by a third.
pub(crate) const INLINE_CREATE_BYTES: u64 = 20 * 1024 * 1024;

/// How much of a failed response's body is kept for the agent to read.
const ERROR_BODY_CHARS: usize = 2000;

/// A named page in the artifact.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub(crate) struct Scene {
    /// Slug: lowercase letters, digits and `-`, e.g. `empty-state`.
    pub(crate) id: String,
    /// What people see on the scene's tab.
    pub(crate) title: String,
    /// The scene's page, a file path inside the artifact.
    pub(crate) path: String,
}

/// What to publish.
#[derive(Debug)]
pub(crate) struct Publication {
    pub(crate) files: Vec<LocalFile>,
    /// The artifact to publish a new version of; a new artifact when unset.
    pub(crate) artifact_id: Option<String>,
    /// A new artifact's name.
    pub(crate) name: Option<String>,
    /// The version's scenes; an update keeps the current ones when unset.
    pub(crate) scenes: Option<Vec<Scene>>,
    pub(crate) message: Option<String>,
    /// Refuse the update unless this is still the current version.
    pub(crate) base_version: Option<u32>,
}

/// What was published.
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct Published {
    pub(crate) artifact_id: String,
    pub(crate) version: u32,
    pub(crate) scenes: Vec<Scene>,
    /// Files whose bytes were sent, and files Macro already had.
    pub(crate) uploaded: usize,
    pub(crate) reused: usize,
}

#[derive(Debug, thiserror::Error)]
pub(crate) enum PublishError {
    #[error("a new artifact needs a name")]
    NoName,
    #[error("could not reach Macro: {0}")]
    Transport(#[from] reqwest::Error),
    #[error("Macro refused {call} with {status}: {body}")]
    Refused {
        call: &'static str,
        status: reqwest::StatusCode,
        body: String,
    },
    #[error("Macro created the artifact without publishing its files")]
    NoVersion,
    #[error("Macro asked for {0}, which is not among the files being published")]
    UnknownUpload(String),
}

/// The egress, reached with the session token.
pub(crate) struct Egress {
    client: reqwest::Client,
    base_url: String,
    token: String,
}

#[derive(Serialize)]
struct FileInput<'a> {
    path: &'a str,
    content_type: &'a str,
    sha256: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    content_base64: Option<String>,
}

#[derive(Serialize)]
struct CreateRequest<'a> {
    name: &'a str,
    files: Vec<FileInput<'a>>,
    scenes: &'a [Scene],
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<&'a str>,
}

#[derive(Serialize)]
struct UploadsRequest<'a> {
    files: Vec<UploadFile<'a>>,
}

#[derive(Serialize)]
struct UploadFile<'a> {
    sha256: &'a str,
    size: u64,
    content_type: &'a str,
}

#[derive(Deserialize)]
struct UploadsResponse {
    uploads: Vec<Upload>,
}

#[derive(Deserialize)]
struct Upload {
    sha256: String,
    url: String,
    #[serde(default)]
    headers: BTreeMap<String, String>,
}

#[derive(Serialize)]
struct VersionRequest<'a> {
    files: Vec<FileInput<'a>>,
    scenes: &'a [Scene],
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    base_version: Option<u32>,
}

#[derive(Deserialize)]
struct Artifact {
    document_id: String,
    /// `None` until a version is published.
    current: Option<ArtifactVersion>,
}

#[derive(Deserialize)]
struct ArtifactVersion {
    number: u32,
    scenes: Vec<Scene>,
}

impl Egress {
    pub(crate) fn new(base_url: &str, token: &str) -> Result<Self, PublishError> {
        Ok(Self {
            client: reqwest::Client::builder().build()?,
            base_url: base_url.trim_end_matches('/').to_owned(),
            token: token.to_owned(),
        })
    }

    /// Publish `publication`: create the artifact, or upload what Macro is
    /// missing and publish a new version of it.
    #[tracing::instrument(
        name = "artifact.publish",
        skip_all,
        err,
        fields(
            artifact_id = tracing::field::Empty,
            version = tracing::field::Empty,
            file_count = publication.files.len(),
            uploaded = tracing::field::Empty,
            reused = tracing::field::Empty,
        )
    )]
    pub(crate) async fn publish(
        &self,
        publication: Publication,
    ) -> Result<Published, PublishError> {
        let published = match &publication.artifact_id {
            Some(id) => {
                self.publish_version(
                    id,
                    &publication.files,
                    publication.scenes.as_deref(),
                    publication.message.as_deref(),
                    publication.base_version,
                )
                .await?
            }
            None => self.create(&publication).await?,
        };
        let span = tracing::Span::current();
        span.record("artifact_id", published.artifact_id.as_str());
        span.record("version", published.version);
        span.record("uploaded", published.uploaded);
        span.record("reused", published.reused);
        Ok(published)
    }

    async fn create(&self, publication: &Publication) -> Result<Published, PublishError> {
        let name = publication.name.as_deref().ok_or(PublishError::NoName)?;
        let total: u64 = publication
            .files
            .iter()
            .map(|file| file.bytes.len() as u64)
            .sum();
        let scenes = publication.scenes.clone().unwrap_or_default();

        if total <= INLINE_CREATE_BYTES {
            let created: Artifact = self
                .post(
                    "create the artifact",
                    "",
                    &CreateRequest {
                        name,
                        files: publication.files.iter().map(inline).collect(),
                        scenes: &scenes,
                        message: publication.message.as_deref(),
                    },
                )
                .await?;
            let current = created.current.ok_or(PublishError::NoVersion)?;
            return Ok(Published {
                artifact_id: created.document_id,
                version: current.number,
                scenes: current.scenes,
                uploaded: publication.files.len(),
                reused: 0,
            });
        }

        // Too big for one request: create the artifact with no version,
        // upload into it, then publish version 1 (base 0: nothing published).
        let created: Artifact = self
            .post(
                "create the artifact",
                "",
                &CreateRequest {
                    name,
                    files: Vec::new(),
                    scenes: &[],
                    message: None,
                },
            )
            .await?;
        self.publish_version(
            &created.document_id,
            &publication.files,
            Some(&scenes),
            publication.message.as_deref(),
            Some(0),
        )
        .await
    }

    async fn publish_version(
        &self,
        id: &str,
        files: &[LocalFile],
        scenes: Option<&[Scene]>,
        message: Option<&str>,
        base_version: Option<u32>,
    ) -> Result<Published, PublishError> {
        let scenes = match scenes {
            Some(scenes) => scenes.to_vec(),
            None => {
                let artifact: Artifact = self.get("read the artifact", &format!("/{id}")).await?;
                artifact
                    .current
                    .map(|current| current.scenes)
                    .unwrap_or_default()
            }
        };

        let mut wanted = Vec::new();
        for file in files {
            if !wanted
                .iter()
                .any(|upload: &UploadFile<'_>| upload.sha256 == file.sha256)
            {
                wanted.push(UploadFile {
                    sha256: &file.sha256,
                    size: file.bytes.len() as u64,
                    content_type: file.content_type,
                });
            }
        }
        let distinct = wanted.len();
        let missing: UploadsResponse = self
            .post(
                "request uploads",
                &format!("/{id}/uploads"),
                &UploadsRequest { files: wanted },
            )
            .await?;
        for upload in &missing.uploads {
            let file = files
                .iter()
                .find(|file| file.sha256 == upload.sha256)
                .ok_or_else(|| PublishError::UnknownUpload(upload.sha256.clone()))?;
            self.put(upload, file).await?;
        }

        let version: ArtifactVersion = self
            .post(
                "publish the version",
                &format!("/{id}/versions"),
                &VersionRequest {
                    files: files.iter().map(by_hash).collect(),
                    scenes: &scenes,
                    message,
                    base_version,
                },
            )
            .await?;
        Ok(Published {
            artifact_id: id.to_owned(),
            version: version.number,
            scenes: version.scenes,
            uploaded: missing.uploads.len(),
            reused: distinct - missing.uploads.len(),
        })
    }

    async fn post<Body: Serialize, Answer: for<'de> Deserialize<'de>>(
        &self,
        call: &'static str,
        path: &str,
        body: &Body,
    ) -> Result<Answer, PublishError> {
        let response = self
            .client
            .post(format!("{}/artifacts{path}", self.base_url))
            .bearer_auth(&self.token)
            .json(body)
            .send()
            .await?;
        answer(call, response).await
    }

    async fn get<Answer: for<'de> Deserialize<'de>>(
        &self,
        call: &'static str,
        path: &str,
    ) -> Result<Answer, PublishError> {
        let response = self
            .client
            .get(format!("{}/artifacts{path}", self.base_url))
            .bearer_auth(&self.token)
            .send()
            .await?;
        answer(call, response).await
    }

    /// Send one file's bytes to its presigned URL, with exactly the headers
    /// the signature covers and no session token.
    #[tracing::instrument(name = "artifact.upload", skip_all, err, fields(size = file.bytes.len()))]
    async fn put(&self, upload: &Upload, file: &LocalFile) -> Result<(), PublishError> {
        let mut request = self.client.put(&upload.url).body(file.bytes.clone());
        for (name, value) in &upload.headers {
            request = request.header(name, value);
        }
        let response = request.send().await?;
        if response.status().is_success() {
            return Ok(());
        }
        Err(refused("upload a file", response).await)
    }
}

fn inline(file: &LocalFile) -> FileInput<'_> {
    FileInput {
        path: &file.path,
        content_type: file.content_type,
        sha256: &file.sha256,
        content_base64: Some(BASE64.encode(&file.bytes)),
    }
}

fn by_hash(file: &LocalFile) -> FileInput<'_> {
    FileInput {
        path: &file.path,
        content_type: file.content_type,
        sha256: &file.sha256,
        content_base64: None,
    }
}

async fn answer<Answer: for<'de> Deserialize<'de>>(
    call: &'static str,
    response: reqwest::Response,
) -> Result<Answer, PublishError> {
    if !response.status().is_success() {
        return Err(refused(call, response).await);
    }
    Ok(response.json().await?)
}

async fn refused(call: &'static str, response: reqwest::Response) -> PublishError {
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    PublishError::Refused {
        call,
        status,
        body: body.chars().take(ERROR_BODY_CHARS).collect(),
    }
}
