//! Incremental SSE framing. Interpretation belongs after durable journal append.

use crate::domain::cloud::{CloudEventStream, NativeRecord};
use std::collections::VecDeque;
use std::time::Duration;

const MAX_EVENT_BYTES: usize = 1024 * 1024;
const MAX_EVENTS: usize = 100_000;

#[cfg(test)]
mod test;

#[derive(Default)]
struct Parser {
    line: Vec<u8>,
    data: Vec<u8>,
    event: String,
    id: Option<String>,
    count: usize,
    ready: VecDeque<NativeRecord>,
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
                if self.line.len()
                    + self.data.len()
                    + self.event.len()
                    + self.id.as_ref().map_or(0, String::len)
                    >= MAX_EVENT_BYTES
                {
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
            if !self.data.is_empty() {
                if self.count >= MAX_EVENTS {
                    return Err(rootcause::report!(
                        "cloud stream exceeds 100000 record limit"
                    ));
                }
                self.count += 1;
                let mut data = std::mem::take(&mut self.data);
                data.pop(); // SSE joins data lines without a final newline.
                self.ready.push_back(NativeRecord {
                    event: std::mem::take(&mut self.event),
                    id: self.id.take(),
                    data: String::from_utf8(data)
                        .map_err(|_| rootcause::report!("cloud SSE data was not UTF-8"))?,
                });
            }
            self.event.clear();
            self.id = None;
            return Ok(());
        }
        if line.starts_with(b":") {
            return Ok(());
        }
        let split = line
            .iter()
            .position(|byte| *byte == b':')
            .unwrap_or(line.len());
        let field = &line[..split];
        let mut value = line.get(split + 1..).unwrap_or_default();
        if value.first() == Some(&b' ') {
            value = &value[1..];
        }
        match field {
            b"data" => {
                self.data.extend_from_slice(value);
                self.data.push(b'\n');
            }
            b"event" => {
                self.event = String::from_utf8(value.to_vec())
                    .map_err(|_| rootcause::report!("cloud SSE event was not UTF-8"))?
            }
            b"id" if !value.contains(&0) => {
                self.id = Some(
                    String::from_utf8(value.to_vec())
                        .map_err(|_| rootcause::report!("cloud SSE id was not UTF-8"))?,
                )
            }
            _ => {}
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
