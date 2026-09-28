//! Rig 0.41's public HTTP extension point. Its completion stream's inner stream
//! is private, and accepted-turn hooks miss invalid-tool recovery. Intercepting
//! each send here also accounts for `GenericEventSource` reconnect executions.
//! No GenAI spans or aggregate analytics are emitted by this adapter.

use std::time::Duration;

use ai_usage::financial::{
    ProviderModel, ProviderOutcome, ProviderRequestId, TrustedTokenUsage, UnresolvedReason,
    UsageEvidence,
};
use bytes::Bytes;
use futures::StreamExt;
use rig_core::http_client::{
    self, HttpClientExt, LazyBody, MultipartForm, Request, Response, StreamingResponse,
};
use serde_json::Value;

use super::metering::{Attempt, MeteringContext, MeteringError, WireProtocol};

#[cfg(test)]
mod test;

/// Maximum time to drain an authorized execution after its consumer disappears.
const EXECUTION_TIMEOUT: Duration = Duration::from_secs(300);
/// Bound transient SSE parsing memory; never retain or journal model content.
const MAX_EVENT_BYTES: usize = 1024 * 1024;

/// HTTP adapter installed when building a Rig provider client. Attribution is
/// obtained from the request scope, never stored on this shared client.
#[derive(Debug, Clone)]
pub struct MeteredHttpClient<H = http_client::ReqwestClient> {
    inner: H,
    provider: String,
    protocol: WireProtocol,
}

// Required by Rig's CompletionModel bounds, even for explicitly built clients.
// An unconfigured default must fail closed for activated traffic.
impl<H: Default> Default for MeteredHttpClient<H> {
    fn default() -> Self {
        Self::new(H::default(), "", WireProtocol::Responses)
    }
}

impl<H> MeteredHttpClient<H> {
    /// Wrap a transport with no hidden execution retries. Rig retries above this
    /// boundary are supported; retries inside `inner` would bypass authorization.
    pub fn new(inner: H, provider: impl Into<String>, protocol: WireProtocol) -> Self {
        Self {
            inner,
            provider: provider.into(),
            protocol,
        }
    }

    async fn prepare(
        &self,
        request: Request<Bytes>,
    ) -> http_client::Result<(Request<Bytes>, Option<Attempt>)> {
        let Some(context) = MeteringContext::current().filter(MeteringContext::activated) else {
            return Ok((request, None));
        };
        let mut body: Value = serde_json::from_slice(request.body())
            .map_err(|_| http_error(MeteringError::Unsupported))?;
        let model = if self.protocol == WireProtocol::Gemini {
            request
                .uri()
                .path()
                .split_once("/models/")
                .and_then(|(_, model)| model.split_once(':').map(|(model, _)| model))
        } else {
            body.get("model").and_then(Value::as_str)
        }
        .ok_or_else(|| http_error(MeteringError::Unsupported))?;
        let model =
            ProviderModel::new(self.provider.clone(), model).map_err(|e| http_error(e.into()))?;
        let attempt = context
            .begin(model, self.protocol, &mut body)
            .await
            .map_err(http_error)?;
        let (parts, _) = request.into_parts();
        let mut request = Request::from_parts(
            parts,
            Bytes::from(
                serde_json::to_vec(&body).map_err(|_| http_error(MeteringError::Unsupported))?,
            ),
        );
        // The adapter changed max tokens; let the transport compute the length.
        request.headers_mut().remove("content-length");
        Ok((request, Some(attempt)))
    }
}

fn http_error(error: MeteringError) -> http_client::Error {
    http_client::Error::Instance(Box::new(error))
}

fn request_id(headers: &http_client::HeaderMap) -> Option<ProviderRequestId> {
    ["request-id", "x-request-id", "x-goog-request-id"]
        .into_iter()
        .find_map(|name| {
            headers
                .get(name)
                .and_then(|id| id.to_str().ok())
                .and_then(|id| ProviderRequestId::new(id).ok())
        })
}

impl<H: HttpClientExt + Clone + 'static> HttpClientExt for MeteredHttpClient<H> {
    fn send<T, U>(
        &self,
        request: Request<T>,
    ) -> impl Future<Output = http_client::Result<Response<LazyBody<U>>>> + Send + 'static
    where
        T: Into<Bytes> + Send,
        U: From<Bytes> + Send + 'static,
    {
        let client = self.clone();
        let request = request.map(Into::into);
        let context = MeteringContext::current();
        async move {
            MeteringContext::carry(context, async move {
                let (request, attempt) = client.prepare(request).await?;
                let Some(attempt) = attempt else {
                    return client.inner.send(request).await;
                };
                // Complete the provider/evidence exchange independently of caller
                // cancellation, before Rig can reject tool arguments or JSON.
                tokio::spawn(async move {
                    let result = tokio::time::timeout(EXECUTION_TIMEOUT, async {
                        let response = client.inner.send::<_, Bytes>(request).await?;
                        let (parts, body) = response.into_parts();
                        Ok::<_, http_client::Error>((parts, body.await?))
                    })
                    .await;
                    match result {
                        Ok(Ok((parts, bytes))) => {
                            let mut facts = Facts::new(
                                attempt.support.protocol,
                                attempt.support.zero_usage_is_missing,
                                request_id(&parts.headers),
                            );
                            facts.response(&bytes);
                            attempt
                                .finish(facts.outcome, facts.evidence(), facts.request_id)
                                .await
                                .map_err(http_error)?;
                            let body: LazyBody<U> = Box::pin(async move { Ok(U::from(bytes)) });
                            Ok(Response::from_parts(parts, body))
                        }
                        other => {
                            let error = match other {
                                Ok(Err(error)) => error,
                                _ => http_error(MeteringError::Stopped),
                            };
                            finish_failure(attempt, &error).await?;
                            Err(error)
                        }
                    }
                })
                .await
                .map_err(|_| http_error(MeteringError::Stopped))?
            })
            .await
        }
    }

    fn send_multipart<U>(
        &self,
        request: Request<MultipartForm>,
    ) -> impl Future<Output = http_client::Result<Response<LazyBody<U>>>> + Send + 'static
    where
        U: From<Bytes> + Send + 'static,
    {
        let activated = MeteringContext::current().is_some_and(|c| c.activated());
        let inner = self.inner.clone();
        async move {
            if activated {
                return Err(http_error(MeteringError::Unsupported));
            }
            inner.send_multipart(request).await
        }
    }

    async fn send_streaming<T>(&self, request: Request<T>) -> http_client::Result<StreamingResponse>
    where
        T: Into<Bytes> + Send,
    {
        let (request, attempt) = self.prepare(request.map(Into::into)).await?;
        let Some(attempt) = attempt else {
            return self.inner.send_streaming(request).await;
        };
        let inner = self.inner.clone();
        // Keep connection establishment alive too: a timeout after provider
        // execution is unresolved evidence, not permission to release the hold.
        tokio::spawn(async move {
            let response =
                tokio::time::timeout(EXECUTION_TIMEOUT, inner.send_streaming(request)).await;
            let response = match response {
                Ok(Ok(response)) => response,
                other => {
                    let error = match other {
                        Ok(Err(error)) => error,
                        _ => http_error(MeteringError::Stopped),
                    };
                    finish_failure(attempt, &error).await?;
                    return Err(error);
                }
            };
            let (parts, mut body) = response.into_parts();
            let mut facts = Facts::new(
                attempt.support.protocol,
                attempt.support.zero_usage_is_missing,
                request_id(&parts.headers),
            );
            let (tx, mut rx) = tokio::sync::mpsc::channel(8);
            tokio::spawn(async move {
                let mut attempt = Some(attempt);
                let mut decoder = SseDecoder::default();
                let drain = async {
                    while let Some(chunk) = body.next().await {
                        match &chunk {
                            Ok(bytes) => {
                                decoder.push(bytes, &mut facts);
                                if facts.terminal
                                    && let Some(attempt) = attempt.take()
                                    && let Err(error) = attempt
                                        .finish(
                                            facts.outcome,
                                            facts.evidence(),
                                            facts.request_id.clone(),
                                        )
                                        .await
                                {
                                    let _ = tx.send(Err(http_error(error))).await;
                                    return;
                                }
                            }
                            Err(_) => {
                                let _ = tx.send(chunk).await;
                                break;
                            }
                        }
                        // When Rig rejects an invalid tool call, or the user drops
                        // the stream, continue bounded draining for terminal usage.
                        let _ = tx.send(chunk).await;
                    }
                };
                let _ = tokio::time::timeout(EXECUTION_TIMEOUT, drain).await;
                if let Some(attempt) = attempt {
                    let result = attempt
                        .finish(
                            ProviderOutcome::Unknown,
                            UsageEvidence::Missing(UnresolvedReason::Interrupted),
                            facts.request_id,
                        )
                        .await;
                    if let Err(error) = result {
                        let _ = tx.send(Err(http_error(error))).await;
                    } else {
                        let _ = tx.send(Err(http_error(MeteringError::Stopped))).await;
                    }
                }
            });
            let stream = async_stream::stream! {
                while let Some(chunk) = rx.recv().await { yield chunk; }
            };
            Ok(Response::from_parts(
                parts,
                Box::pin(stream) as http_client::sse::BoxedStream,
            ))
        })
        .await
        .map_err(|_| http_error(MeteringError::Stopped))?
    }
}

/// Rig exposes non-success response bodies through this public error variant.
/// Retain reported usage even when HTTP status prevents SDK response parsing.
async fn finish_failure(attempt: Attempt, error: &http_client::Error) -> http_client::Result<()> {
    let mut facts = Facts::new(
        attempt.support.protocol,
        attempt.support.zero_usage_is_missing,
        None,
    );
    let mut outcome = ProviderOutcome::Unknown;
    let mut evidence = UsageEvidence::Missing(UnresolvedReason::Interrupted);
    if let http_client::Error::InvalidStatusCodeWithMessage(_, body) = error {
        facts.response(body.as_bytes());
        outcome = ProviderOutcome::Failed;
        if facts.usage.is_some() {
            evidence = facts.evidence();
        }
    }
    attempt
        .finish(outcome, evidence, facts.request_id)
        .await
        .map_err(http_error)
}

/// Raw provider facts: never use Rig's generic Usage defaults, which replace
/// absent counters with zeros and overlap cache/reasoning totals.
struct Facts {
    protocol: WireProtocol,
    zero_usage_is_missing: bool,
    request_id: Option<ProviderRequestId>,
    usage: Option<Value>,
    terminal: bool,
    invalid: bool,
    outcome: ProviderOutcome,
}

impl Facts {
    fn new(
        protocol: WireProtocol,
        zero_usage_is_missing: bool,
        request_id: Option<ProviderRequestId>,
    ) -> Self {
        Self {
            protocol,
            zero_usage_is_missing,
            request_id,
            usage: None,
            terminal: false,
            invalid: false,
            outcome: ProviderOutcome::Succeeded,
        }
    }

    fn identify(&mut self, value: &Value) {
        if self.request_id.is_none() {
            self.request_id = value
                .get("id")
                .or_else(|| value.get("responseId"))
                .and_then(Value::as_str)
                .and_then(|id| ProviderRequestId::new(id).ok());
        }
    }

    fn response(&mut self, bytes: &[u8]) {
        match serde_json::from_slice::<Value>(bytes) {
            Ok(value) => {
                self.identify(&value);
                self.usage = value
                    .get(if self.protocol == WireProtocol::Gemini {
                        "usageMetadata"
                    } else {
                        "usage"
                    })
                    .cloned();
                if value.get("error").is_some_and(|e| !e.is_null())
                    || value.get("status").is_some_and(|s| s == "failed")
                {
                    self.outcome = ProviderOutcome::Failed;
                }
                self.terminal = true;
            }
            Err(_) => self.invalid = true,
        }
    }

    fn event(&mut self, data: &[u8]) {
        if self.terminal {
            return;
        }
        if data == b"[DONE]" {
            // Only a usage-only Chat Completions event is a reliable final
            // snapshot. Earlier per-chunk counters may be incomplete.
            self.usage = None;
            self.terminal = true;
            return;
        }
        let Ok(value) = serde_json::from_slice::<Value>(data) else {
            self.invalid = true;
            return;
        };
        match self.protocol {
            WireProtocol::Anthropic => match value.get("type").and_then(Value::as_str) {
                Some("message_start") => {
                    self.identify(&value["message"]);
                    self.usage = value.pointer("/message/usage").cloned();
                    if let Some(usage) = self.usage.as_mut().and_then(Value::as_object_mut) {
                        // message_start output is provisional, not final usage.
                        usage.remove("output_tokens");
                    }
                }
                Some("message_delta") => {
                    // Cumulative counters, not deltas. Some endpoints include
                    // zero input/cache placeholders here: preserve start counts.
                    if let Some(update) = value.get("usage").and_then(Value::as_object)
                        && let Some(usage) = self.usage.as_mut().and_then(Value::as_object_mut)
                    {
                        for (key, value) in update {
                            if key == "output_tokens" || value.as_u64() != Some(0) {
                                usage.insert(key.clone(), value.clone());
                            }
                        }
                    }
                }
                Some("message_stop") => self.terminal = true,
                Some("error") => {
                    self.outcome = ProviderOutcome::Failed;
                    self.usage = None;
                    self.terminal = true;
                }
                _ => {}
            },
            WireProtocol::Responses => {
                if let Some(response) = value.get("response") {
                    self.identify(response);
                }
                if matches!(
                    value.get("type").and_then(Value::as_str),
                    Some("response.completed" | "response.incomplete" | "response.failed")
                ) {
                    self.usage = value.pointer("/response/usage").cloned();
                    self.terminal = true;
                    if value["type"] == "response.failed" {
                        self.outcome = ProviderOutcome::Failed;
                    }
                }
            }
            WireProtocol::ChatCompletions => {
                self.identify(&value);
                // The include_usage event is a cumulative, final snapshot. A
                // repeated snapshot is never added a second time.
                if value.get("usage").is_some_and(Value::is_object) {
                    self.usage = value.get("usage").cloned();
                    self.terminal = value
                        .get("choices")
                        .and_then(Value::as_array)
                        .is_some_and(Vec::is_empty);
                }
            }
            WireProtocol::Gemini => {
                self.identify(&value);
                if let Some(usage) = value.get("usageMetadata") {
                    self.usage = Some(usage.clone());
                }
                if value.pointer("/candidates/0/finishReason").is_some() {
                    // Earlier chunks are cumulative but not necessarily complete.
                    self.usage = value.get("usageMetadata").cloned();
                    self.terminal = true;
                }
            }
        }
    }

    fn evidence(&self) -> UsageEvidence {
        if self.invalid {
            return UsageEvidence::Missing(UnresolvedReason::UnsupportedDimensions);
        }
        if !self.terminal {
            return UsageEvidence::Missing(UnresolvedReason::Interrupted);
        }
        let Some(usage) = &self.usage else {
            return UsageEvidence::Missing(UnresolvedReason::UsageNotReported);
        };
        match normalize(self.protocol, usage) {
            Some(tokens)
                if !(self.zero_usage_is_missing
                    && tokens == TrustedTokenUsage::from_disjoint(0, 0, 0, 0, 0)) =>
            {
                UsageEvidence::Reported(tokens)
            }
            _ => UsageEvidence::Missing(UnresolvedReason::UnsupportedDimensions),
        }
    }
}

fn count(value: &Value, key: &str) -> Option<u64> {
    value.get(key)?.as_u64()
}

// Omitted optional counters have zero semantics only for reviewed profiles.
// Required totals always retain absence, including SDK zero-default sentinels.
fn optional_count(value: &Value, key: &str) -> Option<u64> {
    match value.as_object()?.get(key) {
        None => Some(0),
        Some(value) => value.as_u64(),
    }
}

fn normalize(protocol: WireProtocol, usage: &Value) -> Option<TrustedTokenUsage> {
    let tokens = match protocol {
        WireProtocol::Anthropic => {
            // Anthropic input excludes cache reads/writes; output already bills
            // thinking at the output rate without a separate reasoning counter.
            if let Some(cache) = usage.get("cache_creation")
                && optional_count(cache, "ephemeral_1h_input_tokens")? != 0
            {
                return None;
            }
            Some(TrustedTokenUsage::from_disjoint(
                count(usage, "input_tokens")?,
                count(usage, "output_tokens")?,
                optional_count(usage, "cache_read_input_tokens")?,
                optional_count(usage, "cache_creation_input_tokens")?,
                0,
            ))
        }
        WireProtocol::Responses | WireProtocol::ChatCompletions => {
            let (input, output, input_details, output_details) =
                if protocol == WireProtocol::Responses {
                    (
                        "input_tokens",
                        "output_tokens",
                        "input_tokens_details",
                        "output_tokens_details",
                    )
                } else {
                    (
                        "prompt_tokens",
                        "completion_tokens",
                        "prompt_tokens_details",
                        "completion_tokens_details",
                    )
                };
            let cached = usage
                .get(input_details)
                .map_or(Some(0), |v| optional_count(v, "cached_tokens"))?;
            let reasoning = usage
                .get(output_details)
                .map_or(Some(0), |v| optional_count(v, "reasoning_tokens"))?;
            // Audio and prediction tokens need different rate provenance.
            for details in [input_details, output_details] {
                if let Some(object) = usage.get(details).and_then(Value::as_object)
                    && object.iter().any(|(key, value)| {
                        key != "cached_tokens"
                            && key != "reasoning_tokens"
                            && value.as_u64() != Some(0)
                    })
                {
                    return None;
                }
            }
            TrustedTokenUsage::from_inclusive_totals(
                count(usage, input)?,
                count(usage, output)?,
                cached,
                0,
                reasoning,
            )
            .ok()
        }
        WireProtocol::Gemini => {
            // Gemini candidates EXCLUDE thoughts; prompt INCLUDES cache reads.
            // Server tool-use tokens do not belong to this token-only profile.
            if optional_count(usage, "toolUsePromptTokenCount")? != 0 {
                return None;
            }
            let cached = optional_count(usage, "cachedContentTokenCount")?;
            Some(TrustedTokenUsage::from_disjoint(
                count(usage, "promptTokenCount")?.checked_sub(cached)?,
                count(usage, "candidatesTokenCount")?,
                cached,
                0,
                optional_count(usage, "thoughtsTokenCount")?,
            ))
        }
    }?;
    let total_key = if protocol == WireProtocol::Gemini {
        "totalTokenCount"
    } else {
        "total_tokens"
    };
    if let Some(total) = usage.get(total_key) {
        let total = total.as_u64()?;
        // Some APIs/SDKs use zero for an absent total. Never replace explicit
        // dimensions with that sentinel, or invent a missing dimension from it.
        let disjoint_total = [
            tokens.input(),
            tokens.output(),
            tokens.cache_read(),
            tokens.cache_write(),
            tokens.reasoning(),
        ]
        .into_iter()
        .try_fold(0_u64, u64::checked_add)?;
        if total != 0 && total != disjoint_total {
            return None;
        }
    }
    Some(tokens)
}

#[derive(Default)]
struct SseDecoder {
    line: Vec<u8>,
    data: Vec<u8>,
    oversized: bool,
}

impl SseDecoder {
    fn push(&mut self, bytes: &[u8], facts: &mut Facts) {
        if self.oversized || facts.terminal {
            return;
        }
        for byte in bytes {
            if self.line.len() + self.data.len() >= MAX_EVENT_BYTES {
                self.oversized = true;
                facts.invalid = true;
                self.line.clear();
                self.data.clear();
                return;
            }
            if *byte != b'\n' {
                self.line.push(*byte);
                continue;
            }
            if self.line.last() == Some(&b'\r') {
                self.line.pop();
            }
            if self.line.is_empty() {
                if !self.data.is_empty() {
                    if self.data.last() == Some(&b'\n') {
                        self.data.pop();
                    }
                    facts.event(&self.data);
                }
                self.data.clear();
                if facts.terminal {
                    return;
                }
            } else if let Some(data) = self.line.strip_prefix(b"data:") {
                let data = data.strip_prefix(b" ").unwrap_or(data);
                self.data.extend_from_slice(data);
                self.data.push(b'\n');
            }
            self.line.clear();
        }
    }
}
