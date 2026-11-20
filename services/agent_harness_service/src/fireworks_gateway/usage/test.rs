use super::*;

const STREAM: &str = "data: {\"id\":\"cmpl-1\",\"object\":\"chat.completion.chunk\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"content\":\"a \\\"usage\\\" in content\"}}],\"usage\":null}\n\
\n\
data: {\"id\":\"cmpl-1\",\"object\":\"chat.completion.chunk\",\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}],\"usage\":null}\n\
\n\
data: {\"id\":\"cmpl-1\",\"object\":\"chat.completion.chunk\",\"choices\":[],\"usage\":{\"prompt_tokens\":1200,\"completion_tokens\":40,\"total_tokens\":1240,\"prompt_tokens_details\":{\"cached_tokens\":1000}}}\n\
\n\
data: [DONE]\n\
\n";

#[test]
fn a_stream_split_anywhere_yields_its_id_and_final_usage() {
    for split in [1, 7, 64, STREAM.len()] {
        let mut parser = SseUsage::default();
        for piece in STREAM.as_bytes().chunks(split) {
            parser.observe(piece);
        }

        assert_eq!(
            parser.observed(),
            &Observed {
                id: Some("cmpl-1".to_owned()),
                usage: TokenUsage {
                    input: 200,
                    output: 40,
                    cache_read: 1000,
                },
            },
            "split every {split} bytes"
        );
    }
}

#[test]
fn a_json_body_without_cached_tokens_counts_all_prompt_tokens_as_input() {
    let observed = from_json_body(
        br#"{"id":"cmpl-2","choices":[],"usage":{"prompt_tokens":30,"completion_tokens":5,"total_tokens":35}}"#,
    );

    assert_eq!(
        observed,
        Observed {
            id: Some("cmpl-2".to_owned()),
            usage: TokenUsage {
                input: 30,
                output: 5,
                cache_read: 0,
            },
        }
    );
    assert_eq!(
        observed.usage.amount(),
        UsageAmount::Tokens {
            input: 30,
            output: 5,
            cache_read: 0,
            cache_write: 0,
        }
    );
}
