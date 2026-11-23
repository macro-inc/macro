use super::*;

const STREAM: &str = "event: message_start\n\
data: {\"type\":\"message_start\",\"message\":{\"id\":\"msg_1\",\"type\":\"message\",\"role\":\"assistant\",\"model\":\"claude-sonnet-5\",\"content\":[],\"stop_reason\":null,\"usage\":{\"input_tokens\":25,\"cache_creation_input_tokens\":100,\"cache_read_input_tokens\":4000,\"output_tokens\":1}}}\n\
\n\
event: content_block_start\n\
data: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"text\",\"text\":\"\"}}\n\
\n\
event: ping\n\
data: {\"type\": \"ping\"}\n\
\n\
event: content_block_delta\n\
data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"a \\\"message_delta\\\" in content\"}}\n\
\n\
event: content_block_stop\n\
data: {\"type\":\"content_block_stop\",\"index\":0}\n\
\n\
event: message_delta\n\
data: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\",\"stop_sequence\":null},\"usage\":{\"output_tokens\":15}}\n\
\n\
event: message_stop\n\
data: {\"type\":\"message_stop\"}\n\
\n";

#[test]
fn stream_usage_combines_message_start_and_final_delta() {
    let mut parser = SseUsage::default();
    parser.observe(STREAM.as_bytes());

    assert_eq!(
        parser.usage(),
        TokenUsage {
            input: 25,
            output: 15,
            cache_read: 4000,
            cache_write: 100,
        }
    );
}

#[test]
fn stream_usage_is_the_same_whatever_the_chunk_boundaries() {
    for chunk_size in [1, 2, 7, 64, 333] {
        let mut parser = SseUsage::default();
        for chunk in STREAM.as_bytes().chunks(chunk_size) {
            parser.observe(chunk);
        }

        assert_eq!(
            parser.usage(),
            TokenUsage {
                input: 25,
                output: 15,
                cache_read: 4000,
                cache_write: 100,
            },
            "chunk size {chunk_size}"
        );
    }
}

#[test]
fn crlf_lines_and_cumulative_delta_input_are_read() {
    let stream = "event: message_start\r\n\
data: {\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":10,\"output_tokens\":1}}}\r\n\
\r\n\
event: message_delta\r\n\
data: {\"type\":\"message_delta\",\"delta\":{},\"usage\":{\"input_tokens\":12,\"cache_read_input_tokens\":3,\"output_tokens\":40}}\r\n\
\r\n";
    let mut parser = SseUsage::default();
    parser.observe(stream.as_bytes());

    assert_eq!(
        parser.usage(),
        TokenUsage {
            input: 12,
            output: 40,
            cache_read: 3,
            cache_write: 0,
        }
    );
}

#[test]
fn an_oversized_event_is_skipped_without_losing_later_usage() {
    let long_text = "x".repeat(MAX_EVENT_BYTES.get() + 10);
    let stream = format!(
        "event: content_block_delta\ndata: {{\"type\":\"content_block_delta\",\"delta\":{{\"text\":\"{long_text}\"}}}}\n\n\
event: message_delta\ndata: {{\"type\":\"message_delta\",\"usage\":{{\"output_tokens\":7}}}}\n\n"
    );
    let mut parser = SseUsage::default();
    for chunk in stream.as_bytes().chunks(4096) {
        parser.observe(chunk);
    }

    assert_eq!(
        parser.usage(),
        TokenUsage {
            input: 0,
            output: 7,
            cache_read: 0,
            cache_write: 0,
        }
    );
}

#[test]
fn a_stream_cut_before_any_usage_reports_none() {
    let mut parser = SseUsage::default();
    parser.observe(b"event: message_start\ndata: {\"type\":\"message_st");

    assert!(parser.usage().is_empty());
}

#[test]
fn json_body_usage_is_read() {
    let body = br#"{"id":"msg_1","type":"message","role":"assistant","model":"claude-haiku-4-5-20251001","content":[{"type":"text","text":"hi"}],"stop_reason":"end_turn","usage":{"input_tokens":9,"cache_creation_input_tokens":0,"cache_read_input_tokens":2,"output_tokens":5}}"#;

    assert_eq!(
        from_json_body(body),
        Some(TokenUsage {
            input: 9,
            output: 5,
            cache_read: 2,
            cache_write: 0,
        })
    );
}

#[test]
fn json_error_body_has_no_usage() {
    let body = br#"{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}"#;

    assert_eq!(from_json_body(body), None);
}
