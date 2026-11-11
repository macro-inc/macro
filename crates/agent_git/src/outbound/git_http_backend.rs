//! Smart HTTP through `git http-backend` (CGI), streaming both bodies.

use std::process::Stdio;

use futures::StreamExt;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio_util::{io::ReaderStream, sync::CancellationToken, task::TaskTracker};
use tracing::Instrument;

use crate::domain::models::{
    AuthorizedRepo, GitAccess, GitEndpoint, GitRequest, GitResponse, GitService,
};
use crate::domain::ports::GitBackend;
use crate::outbound::repo_directories::{RepoDirectories, git_command};

/// Most CGI header bytes accepted from git.
const MAX_HEADER_BYTES: usize = 64 * 1024;
/// Most headers git sends on one response.
const MAX_HEADERS: usize = 32;

/// Errors from [`GitHttpBackend`].
#[derive(Debug, thiserror::Error)]
pub enum GitHttpBackendError {
    /// Spawning or talking to git failed.
    #[error("git http-backend I/O: {0}")]
    Io(#[from] std::io::Error),
    /// git's CGI headers did not parse.
    #[error("malformed CGI headers from git http-backend: {0}")]
    MalformedHeaders(String),
}

/// [`GitBackend`] that runs `git http-backend` per request.
#[derive(Debug, Clone)]
pub struct GitHttpBackend {
    directories: RepoDirectories,
    tasks: TaskTracker,
}

impl GitHttpBackend {
    /// Serve repos under `directories`; the owner closes and drains `tasks` at shutdown.
    pub fn new(directories: RepoDirectories, tasks: TaskTracker) -> Self {
        Self { directories, tasks }
    }
}

fn path_and_query(endpoint: GitEndpoint) -> (&'static str, &'static str, String) {
    match endpoint {
        GitEndpoint::InfoRefs(service) => {
            let service: &'static str = service.into();
            ("GET", "info/refs", format!("service={service}"))
        }
        GitEndpoint::Rpc(GitService::UploadPack) => ("POST", "git-upload-pack", String::new()),
        GitEndpoint::Rpc(GitService::ReceivePack) => ("POST", "git-receive-pack", String::new()),
    }
}

/// Parse the CGI header block (ending in a blank line) into a status and headers.
fn parse_cgi_headers(block: &[u8]) -> Result<(u16, Vec<(String, String)>), GitHttpBackendError> {
    let mut parsed = [httparse::EMPTY_HEADER; MAX_HEADERS];
    let headers = match httparse::parse_headers(block, &mut parsed) {
        Ok(httparse::Status::Complete((_, headers))) => headers,
        Ok(httparse::Status::Partial) => {
            return Err(GitHttpBackendError::MalformedHeaders(
                "incomplete header block".to_owned(),
            ));
        }
        Err(error) => return Err(GitHttpBackendError::MalformedHeaders(error.to_string())),
    };

    let mut status = 200;
    let mut response_headers = Vec::new();

    for header in headers {
        let value = String::from_utf8_lossy(header.value).into_owned();

        if header.name.eq_ignore_ascii_case("status") {
            // `Status: 403 Forbidden`
            status = value
                .split_whitespace()
                .next()
                .and_then(|code| code.parse().ok())
                .ok_or_else(|| GitHttpBackendError::MalformedHeaders(format!("status {value}")))?;
            continue;
        }

        response_headers.push((header.name.to_owned(), value));
    }

    Ok((status, response_headers))
}

impl GitBackend for GitHttpBackend {
    type Err = GitHttpBackendError;

    #[tracing::instrument(name = "agent_git.transfer", skip_all, fields(repo_id = %agent_credentials::telemetry_id(repo.agent_user_id().as_ref()), endpoint = ?request.endpoint, git.request.bytes = 0_i64, git.response.bytes = 0_i64, git.rejected_reason, otel.status_code), err)]
    async fn serve(
        &self,
        repo: &AuthorizedRepo,
        request: GitRequest,
    ) -> Result<GitResponse, GitHttpBackendError> {
        let (method, endpoint_path, query) = path_and_query(request.endpoint);
        let path_info = format!(
            "/{}/{endpoint_path}",
            self.directories.repo_directory_name(repo.agent_user_id())
        );

        let mut command = git_command();
        command
            .arg("http-backend")
            .env("GIT_PROJECT_ROOT", self.directories.root())
            .env("GIT_HTTP_EXPORT_ALL", "1")
            .env("PATH_INFO", path_info)
            .env("REQUEST_METHOD", method)
            .env("QUERY_STRING", query)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        command
            .env(
                "GIT_CONFIG_COUNT",
                if repo.max_input_size().is_some() {
                    "3"
                } else {
                    "2"
                },
            )
            .env("GIT_CONFIG_KEY_0", "receive.fsckObjects")
            .env("GIT_CONFIG_VALUE_0", "true")
            .env("GIT_CONFIG_KEY_1", "transfer.fsckObjects")
            .env("GIT_CONFIG_VALUE_1", "true");
        if let Some(remaining) = repo.max_input_size() {
            command
                .env("GIT_CONFIG_KEY_2", "receive.maxInputSize")
                .env("GIT_CONFIG_VALUE_2", remaining.to_string());
        }

        // http-backend refuses receive-pack without an authenticated user.
        if repo.access() == GitAccess::Push {
            command.env("REMOTE_USER", repo.agent_user_id().as_ref());
        }
        if let Some(content_type) = &request.content_type {
            command.env("CONTENT_TYPE", content_type);
        }
        if let Some(content_encoding) = &request.content_encoding {
            command.env("HTTP_CONTENT_ENCODING", content_encoding);
        }
        if let Some(git_protocol) = &request.git_protocol {
            command.env("GIT_PROTOCOL", git_protocol);
        }

        let mut child = command.spawn()?;
        let (Some(mut stdin), Some(stdout), Some(mut stderr)) =
            (child.stdin.take(), child.stdout.take(), child.stderr.take())
        else {
            return Err(GitHttpBackendError::Io(std::io::Error::other(
                "git http-backend pipes were not captured",
            )));
        };

        // Pumps end with the request: body exhausted, failed, or git exited.
        let input_cancel = CancellationToken::new();
        let process_finished = input_cancel.clone().drop_guard();
        let mut body = request.body;
        let input_span = tracing::Span::current();
        self.tasks.spawn(
            async move {
                let mut bytes = 0_i64;
                loop {
                    let chunk = tokio::select! {
                        _ = input_cancel.cancelled() => return,
                        chunk = body.next() => chunk,
                    };
                    let Some(chunk) = chunk else { break };
                    let written = match chunk {
                        Ok(chunk) => {
                            bytes = bytes
                                .saturating_add(i64::try_from(chunk.len()).unwrap_or(i64::MAX));
                            tracing::Span::current().record("git.request.bytes", bytes);
                            stdin.write_all(&chunk).await
                        }
                        Err(error) => Err(error),
                    };

                    if let Err(error) = written {
                        tracing::Span::current().record("otel.status_code", "ERROR");
                        tracing::Span::current()
                            .record("git.rejected_reason", "request_body_failed");
                        tracing::warn!(error = %error, "git request body stopped");
                        return;
                    }
                }
            }
            .instrument(input_span),
        );
        let process_span = tracing::Span::current();
        self.tasks.spawn(
            async move {
                let _process_finished = process_finished;
                let mut output = String::new();
                if stderr.read_to_string(&mut output).await.is_ok() && !output.is_empty() {
                    tracing::warn!(
                        stderr_bytes = output.len() as i64,
                        "git http-backend stderr"
                    );
                }

                match child.wait().await {
                    Ok(status) if !status.success() => {
                        tracing::Span::current().record("otel.status_code", "ERROR");
                        tracing::Span::current().record("git.rejected_reason", "backend_exit");
                        tracing::warn!(%status, "git http-backend exited unsuccessfully");
                    }
                    Ok(_) => {}
                    Err(error) => {
                        tracing::Span::current().record("otel.status_code", "ERROR");
                        tracing::Span::current()
                            .record("git.rejected_reason", "backend_wait_failed");
                        tracing::warn!(error = %error, "git http-backend wait failed");
                    }
                }
            }
            .instrument(process_span),
        );

        let mut reader = BufReader::new(stdout);
        let mut block = Vec::new();

        loop {
            let read = reader.read_until(b'\n', &mut block).await?;

            if read == 0 {
                return Err(GitHttpBackendError::MalformedHeaders(
                    "git exited before its headers ended".to_owned(),
                ));
            }
            if block.ends_with(b"\r\n\r\n") || block.ends_with(b"\n\n") {
                break;
            }
            if block.len() > MAX_HEADER_BYTES {
                return Err(GitHttpBackendError::MalformedHeaders(
                    "header block too large".to_owned(),
                ));
            }
        }

        let (status, headers) = parse_cgi_headers(&block)?;

        if status >= 400 {
            tracing::Span::current().record("otel.status_code", "ERROR");
            tracing::Span::current().record("git.rejected_reason", "backend_http_error");
        }
        let response_span = tracing::Span::current();
        let mut bytes = 0_i64;
        Ok(GitResponse {
            status,
            headers,
            body: Box::pin(ReaderStream::new(reader).map(move |chunk| {
                match &chunk {
                    Ok(chunk) => {
                        bytes =
                            bytes.saturating_add(i64::try_from(chunk.len()).unwrap_or(i64::MAX));
                        response_span.record("git.response.bytes", bytes);
                    }
                    Err(_) => {
                        response_span.record("otel.status_code", "ERROR");
                        response_span.record("git.rejected_reason", "response_body_failed");
                    }
                }
                chunk
            })),
        })
    }
}

#[cfg(test)]
mod test;
