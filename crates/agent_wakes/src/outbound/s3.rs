//! Trace blobs in S3: one JSON object per wake, under
//! `agent-wakes/{agent}/{wake}/trace.json` with both ids percent-encoded.
//! The bucket's lifecycle rule on the `agent-wakes/` prefix expires them
//! (see `infra/stacks/agent-harness-service`), so a trace is kept 30 days
//! after its last upload.

use aws_sdk_s3::primitives::ByteStream;
use macro_user_id::user_id::MacroUserIdStr;

use crate::domain::ports::TraceStore;
use crate::domain::trace::WakeTrace;

/// The key prefix every trace is stored under.
pub const TRACE_PREFIX: &str = "agent-wakes/";

/// S3-backed [`TraceStore`].
#[derive(Clone)]
pub struct S3TraceStore {
    client: aws_sdk_s3::Client,
    bucket: String,
}

impl S3TraceStore {
    /// Store traces in `bucket` through `client`.
    #[must_use]
    pub fn new(client: aws_sdk_s3::Client, bucket: String) -> Self {
        Self { client, bucket }
    }
}

/// The object key of a wake's trace.
fn key(agent: &MacroUserIdStr<'static>, wake_id: &str) -> String {
    format!(
        "{TRACE_PREFIX}{}/{}/trace.json",
        urlencoding::encode(agent.as_ref()),
        urlencoding::encode(wake_id)
    )
}

impl TraceStore for S3TraceStore {
    #[tracing::instrument(name = "agent_wakes.s3.put_trace", skip_all, err, fields(bytes))]
    async fn put(
        &self,
        agent: &MacroUserIdStr<'static>,
        wake_id: &str,
        trace: &WakeTrace,
    ) -> Result<(), rootcause::Report> {
        let body = serde_json::to_vec(trace)
            .map_err(|error| rootcause::report!("encode trace: {error}"))?;
        tracing::Span::current().record("bytes", body.len());

        self.client
            .put_object()
            .bucket(&self.bucket)
            .key(key(agent, wake_id))
            .content_type("application/json")
            .body(ByteStream::from(body))
            .send()
            .await
            .map_err(|error| rootcause::report!("put trace: {error:?}"))?;
        Ok(())
    }

    #[tracing::instrument(name = "agent_wakes.s3.get_trace", skip_all, err, fields(bytes))]
    async fn get(
        &self,
        agent: &MacroUserIdStr<'static>,
        wake_id: &str,
    ) -> Result<Option<WakeTrace>, rootcause::Report> {
        let response = match self
            .client
            .get_object()
            .bucket(&self.bucket)
            .key(key(agent, wake_id))
            .send()
            .await
        {
            Ok(response) => response,
            Err(error)
                if error
                    .as_service_error()
                    .is_some_and(|service_error| service_error.is_no_such_key()) =>
            {
                return Ok(None);
            }
            Err(error) => return Err(rootcause::report!("get trace: {error:?}")),
        };

        let bytes = response
            .body
            .collect()
            .await
            .map_err(|error| rootcause::report!("read trace: {error:?}"))?
            .into_bytes();
        tracing::Span::current().record("bytes", bytes.len());

        serde_json::from_slice(&bytes)
            .map(Some)
            .map_err(|error| rootcause::report!("decode trace: {error}"))
    }
}

#[cfg(test)]
mod test {
    use super::*;

    #[test]
    fn keys_encode_both_ids_under_the_prefix() {
        let agent = MacroUserIdStr::parse_from_str("macro|agent@example.com").unwrap();
        assert_eq!(
            key(&agent, "a/b c"),
            "agent-wakes/macro%7Cagent%40example.com/a%2Fb%20c/trace.json"
        );
    }
}
