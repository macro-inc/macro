//! Incremental SSE framing; never interprets EOF as successful cloud completion.

use crate::domain::cloud::{CloudEvent, CloudEventStream};
use std::collections::{HashSet, VecDeque};
use std::time::Duration;

const MAX_EVENT_BYTES: usize = 1024 * 1024;
const MAX_EVENTS: usize = 100_000;
const MAX_ID_BYTES: usize = 512;

#[cfg(test)]
mod test;

#[derive(Default)]
struct Parser {
    line: Vec<u8>,
    data: Vec<u8>,
    seen: HashSet<String>,
    ready: VecDeque<CloudEvent>,
    previous_cr: bool,
}

impl Parser {
    fn push(&mut self, bytes: &[u8]) -> Result<(), rootcause::Report> {
        for &byte in bytes {
            if byte == b'\n' && self.previous_cr {
                self.previous_cr = false;
                continue;
            }
            self.previous_cr = byte == b'\r';
            if byte == b'\n' || byte == b'\r' {
                self.end_line()?;
            } else {
                if self.line.len() + self.data.len() >= MAX_EVENT_BYTES {
                    return Err(rootcause::report!("cloud event exceeds 1 MiB limit"));
                }
                self.line.push(byte);
            }
        }
        Ok(())
    }

    fn end_line(&mut self) -> Result<(), rootcause::Report> {
        let line = std::mem::take(&mut self.line);
        if line.is_empty() {
            if self.data.is_empty() {
                return Ok(());
            }
            let data = std::mem::take(&mut self.data);
            let value: serde_json::Value = serde_json::from_slice(&data)
                .map_err(|_| rootcause::report!("invalid cloud event JSON (body withheld)"))?;
            let id = value
                .get("id")
                .and_then(serde_json::Value::as_str)
                .filter(|id| {
                    !id.is_empty() && id.len() <= MAX_ID_BYTES && !id.chars().any(char::is_control)
                })
                .ok_or_else(|| rootcause::report!("cloud event missing valid replay identity"))?;
            if self.seen.contains(id) {
                return Ok(());
            }
            if self.seen.len() >= MAX_EVENTS {
                return Err(rootcause::report!(
                    "cloud event replay exceeds 100000 identity limit"
                ));
            }
            let event = match value.get("item_type").and_then(serde_json::Value::as_str) {
                Some("thread_event") => {
                    let method = value
                        .pointer("/event/method")
                        .and_then(serde_json::Value::as_str)
                        .filter(|method| !method.is_empty() && method.len() <= 256)
                        .ok_or_else(|| rootcause::report!("cloud thread event missing method"))?;
                    let params = value
                        .pointer("/event/params")
                        .filter(|params| params.is_object())
                        .ok_or_else(|| {
                            rootcause::report!("cloud thread event missing structured params")
                        })?;
                    CloudEvent {
                        id: id.to_owned(),
                        method: method.to_owned(),
                        params: params.clone(),
                    }
                }
                Some("log") => CloudEvent {
                    id: id.to_owned(),
                    method: "log".to_owned(),
                    params: value.clone(),
                },
                _ => return Err(rootcause::report!("unsupported cloud stream record kind")),
            };
            self.seen.insert(id.to_owned());
            self.ready.push_back(event);
        } else if let Some(mut data) = line.strip_prefix(b"data:") {
            if data.first() == Some(&b' ') {
                data = &data[1..];
            }
            self.data.extend_from_slice(data);
            self.data.push(b'\n');
        }
        Ok(())
    }
}

pub(super) fn subscribe(response: reqwest::Response) -> CloudEventStream {
    let state = Some((response, Parser::default()));
    Box::pin(futures::stream::unfold(state, |state| async move {
        let (mut response, mut parser) = state?;
        loop {
            if let Some(event) = parser.ready.pop_front() {
                return Some((Ok(event), Some((response, parser))));
            }
            let chunk = tokio::time::timeout(Duration::from_secs(90), response.chunk()).await;
            match chunk {
                Ok(Ok(Some(bytes))) => {
                    if let Err(error) = parser.push(&bytes) {
                        return Some((Err(error), None));
                    }
                }
                Ok(Ok(None)) => {
                    if !parser.line.is_empty() || !parser.data.is_empty() {
                        return Some((
                            Err(rootcause::report!(
                                "cloud event stream ended mid-record; reconcile remote turn"
                            )),
                            None,
                        ));
                    }
                    return None;
                }
                _ => {
                    return Some((
                        Err(rootcause::report!(
                            "cloud event stream interrupted or idle; reconcile remote turn"
                        )),
                        None,
                    ));
                }
            }
        }
    }))
}
