use super::*;

#[test]
fn anthropic_input_already_excludes_cache_reads_and_writes() {
    let usage = Usage {
        input_tokens: 1_200,
        output_tokens: 300,
        total_tokens: 147_500,
        cached_input_tokens: 140_000,
        cache_creation_input_tokens: 6_000,
        tool_use_prompt_tokens: 0,
        reasoning_tokens: 0,
    };

    assert_eq!(
        usage_amount(WireProtocol::Anthropic, &usage),
        UsageAmount::Tokens {
            input: 1_200,
            output: 300,
            cache_read: 140_000,
            cache_write: 6_000,
        }
    );
}

#[test]
fn openai_responses_input_includes_cached_tokens_so_they_are_split_out() {
    let usage = Usage {
        input_tokens: 150_000,
        output_tokens: 500,
        total_tokens: 150_500,
        cached_input_tokens: 140_000,
        cache_creation_input_tokens: 0,
        tool_use_prompt_tokens: 0,
        reasoning_tokens: 200,
    };

    assert_eq!(
        usage_amount(WireProtocol::Responses, &usage),
        UsageAmount::Tokens {
            input: 10_000,
            output: 500,
            cache_read: 140_000,
            cache_write: 0,
        }
    );
}

#[test]
fn chat_completions_prompt_tokens_include_cached_tokens_so_they_are_split_out() {
    let usage = Usage {
        input_tokens: 8_000,
        output_tokens: 120,
        total_tokens: 8_120,
        cached_input_tokens: 6_000,
        cache_creation_input_tokens: 0,
        tool_use_prompt_tokens: 0,
        reasoning_tokens: 0,
    };

    assert_eq!(
        usage_amount(WireProtocol::ChatCompletions, &usage),
        UsageAmount::Tokens {
            input: 2_000,
            output: 120,
            cache_read: 6_000,
            cache_write: 0,
        }
    );
}

#[test]
fn gemini_prompt_includes_cached_tokens_and_candidates_exclude_thoughts() {
    let usage = Usage {
        input_tokens: 50_000,
        output_tokens: 400,
        total_tokens: 51_400,
        cached_input_tokens: 30_000,
        cache_creation_input_tokens: 0,
        tool_use_prompt_tokens: 0,
        reasoning_tokens: 1_000,
    };

    assert_eq!(
        usage_amount(WireProtocol::Gemini, &usage),
        UsageAmount::Tokens {
            input: 20_000,
            output: 1_400,
            cache_read: 30_000,
            cache_write: 0,
        }
    );
}

#[test]
fn inclusive_input_smaller_than_its_cache_share_does_not_underflow() {
    let usage = Usage {
        input_tokens: 10,
        output_tokens: 5,
        total_tokens: 15,
        cached_input_tokens: 40,
        cache_creation_input_tokens: 0,
        tool_use_prompt_tokens: 0,
        reasoning_tokens: 0,
    };

    assert_eq!(
        usage_amount(WireProtocol::Responses, &usage),
        UsageAmount::Tokens {
            input: 0,
            output: 5,
            cache_read: 40,
            cache_write: 0,
        }
    );
}
