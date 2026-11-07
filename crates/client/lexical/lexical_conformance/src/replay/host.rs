//! Captured host capabilities consumed by high-level headless model operations.
use super::*;
use std::{collections::VecDeque, sync::Arc};
#[derive(Default)]
pub(super) struct HostTape {
    events: VecDeque<Value>,
    error: Option<String>,
    active: bool,
}
impl HostTape {
    fn take(&mut self, source: &str) -> Option<Value> {
        // Performance reads belong to scheduling, rather than node constructors.
        while self
            .events
            .front()
            .is_some_and(|event| event["src"] == "perf" || event["op"] == "log")
        {
            self.events.pop_front();
        }
        let next = self.events.pop_front();
        if next.as_ref().is_none_or(|event| event["src"] != source) {
            self.error = Some(format!(
                "host capability {source}: unexpected event {next:?}"
            ));
            return None;
        }
        next
    }
}
impl Replayer {
    pub(super) fn prepare_host_call(
        &mut self,
        trace: &[Value],
        index: usize,
    ) -> Result<Option<usize>> {
        let op = &trace[index];
        if self
            .host_tape
            .lock()
            .map_err(|_| fail("host tape poisoned"))?
            .active
        {
            return Ok(None);
        }
        if op["op"] != "update"
            && (op["op"] != "call"
                || !op["fn"].as_str().is_some_and(|name| {
                    (name == "LexicalEditor.parseEditorState")
                        || name.starts_with("@macro-inc/lexical-core/")
                            && matches!(
                                name.rsplit('.').next(),
                                Some(
                                    "markdownToSerializedEditorStateWithIds"
                                        | "serializedEditorStateToMarkdown"
                                        | "extractChannelMentionsFromMarkdown"
                                        | "extractExplicitReply"
                                        | "composeImageMarkdown"
                                        | "$createDocumentMentionNode"
                                        | "$createSnapshotNode"
                                        | "$createAwaitNode"
                                        | "$convertCardToMention"
                                        | "composeAgentChatReply"
                                        | "composeAgentSessionAnnouncement"
                                        | "composeAgentConnectionPrompt"
                                        | "composeAgentContextPrompt"
                                        | "notionMarkdownToSerializedEditorState"
                                )
                            )
                }))
        {
            return Ok(None);
        }
        let end = trace[index + 1..]
            .iter()
            .position(|op| !matches!(op["op"].as_str(), Some("entropy" | "clock" | "log")))
            .map_or(trace.len(), |offset| index + 1 + offset);
        let mut tape = self
            .host_tape
            .lock()
            .map_err(|_| fail("host tape poisoned"))?;
        if !tape.events.is_empty() || tape.error.is_some() {
            return Err(fail("unconsumed previous host capability tape"));
        }
        tape.active = true;
        for event in &trace[index + 1..end] {
            if event["op"] == "log" {
                if !matches!(event["level"].as_str(), Some("warn" | "error"))
                    || !event["message"].is_string()
                {
                    return Err(fail("invalid advisory log"));
                }
            } else if event["src"] == "perf" {
                let value = event["t"]
                    .as_f64()
                    .filter(|value| value.is_finite() && *value >= self.clock)
                    .ok_or_else(|| fail("invalid performance clock"))?;
                self.clock = value;
            } else if event["src"] == "random" {
                event["v"]
                    .as_f64()
                    .filter(|value| *value >= 0.0 && *value < 1.0)
                    .ok_or_else(|| fail("invalid editor random draw"))?;
            } else if event["src"] == "date" {
                integer(&event["t"])?;
            } else if event["src"] != "getRandomValues" {
                return Err(fail("unsupported host capability"));
            }
            tape.events.push_back(event.clone());
        }
        Ok(Some(end))
    }
    pub(super) fn finish_host_call(&self) -> Result<()> {
        let mut tape = self
            .host_tape
            .lock()
            .map_err(|_| fail("host tape poisoned"))?;
        while tape
            .events
            .front()
            .is_some_and(|event| event["src"] == "perf" || event["op"] == "log")
        {
            tape.events.pop_front();
        }
        tape.active = false;
        if let Some(error) = tape.error.take() {
            return Err(fail(error));
        }
        if !tape.events.is_empty() {
            return Err(fail(format!(
                "unconsumed host capability events: {:?}",
                tape.events
            )));
        }
        Ok(())
    }
    pub(crate) fn model_clock(&self) -> macro_document_model::NodeClock {
        let host = self.host_tape.clone();
        let fallback = self.node_clock.clone();
        macro_document_model::NodeClock(Arc::new(move || {
            if let Ok(mut tape) = host.lock() {
                while tape
                    .events
                    .front()
                    .is_some_and(|event| event["src"] == "perf" || event["op"] == "log")
                {
                    tape.events.pop_front();
                }
                if tape.active {
                    return tape
                        .take("date")
                        .and_then(|event| event["t"].as_u64())
                        .unwrap_or(0);
                }
            }
            fallback.load(std::sync::atomic::Ordering::Relaxed)
        }))
    }
    pub(crate) fn document_context(&self) -> macro_document_model::DocumentContext {
        let random = self.host_tape.clone();
        let clock = self.host_tape.clone();
        let editor = self.host_tape.clone();
        macro_document_model::DocumentContext {
            keys: KeySource::Shared(self.key_counter.clone()),
            host: macro_document_model::NodeHost::default(),
            editor_created: Some(Arc::new(move || {
                if let Ok(mut tape) = editor.lock() {
                    while tape
                        .events
                        .front()
                        .is_some_and(|event| event["src"] == "perf" || event["op"] == "log")
                    {
                        tape.events.pop_front();
                    }
                    if tape
                        .events
                        .front()
                        .is_some_and(|event| event["src"] == "random")
                    {
                        tape.take("random");
                        tape.take("random");
                    }
                }
            })),
            clock: macro_document_model::NodeClock(Arc::new(move || {
                clock
                    .lock()
                    .ok()
                    .and_then(|mut tape| tape.take("date"))
                    .and_then(|event| event["t"].as_u64())
                    .unwrap_or(0)
            })),
            random: macro_document_model::NodeRandom(Arc::new(move |length| {
                let Ok(mut tape) = random.lock() else {
                    return Vec::new();
                };
                let Some(event) = tape.take("getRandomValues") else {
                    return Vec::new();
                };
                let bytes = event["v"].as_array().and_then(|values| {
                    values
                        .iter()
                        .map(|value| value.as_u64().and_then(|byte| u8::try_from(byte).ok()))
                        .collect::<Option<Vec<_>>>()
                });
                if bytes.as_ref().is_none_or(|bytes| bytes.len() != length) {
                    tape.error = Some("cryptographic entropy byte count/type mismatch".into());
                    return Vec::new();
                }
                bytes.unwrap_or_default()
            })),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn constructor_clock_skips_scheduling_and_advisory_events_before_its_date() -> Result<()> {
        let replay = Replayer::default();
        {
            let mut tape = replay
                .host_tape
                .lock()
                .map_err(|_| fail("host tape poisoned"))?;
            tape.events = [
                json!({"op":"clock","src":"perf","t":2}),
                json!({"op":"log","level":"error","message":"invalid prior payload"}),
                json!({"op":"clock","src":"date","t":1730900000000u64}),
            ]
            .into();
            tape.active = true;
        }
        assert_eq!((replay.model_clock().0)(), 1730900000000);
        replay.finish_host_call()
    }
}

#[cfg(test)]
mod strict_clock_tests {
    use super::*;
    #[test]
    fn active_host_tape_rejects_an_extra_date_read() -> Result<()> {
        let replay = Replayer::default();
        replay
            .host_tape
            .lock()
            .map_err(|_| fail("host tape poisoned"))?
            .active = true;
        (replay.model_clock().0)();
        assert!(
            replay
                .finish_host_call()
                .expect_err("must reject an unrecorded clock read")
                .to_string()
                .contains("host capability date")
        );
        Ok(())
    }
}
