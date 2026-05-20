use std::collections::HashSet;

use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use super::{
    CALL_NAME_MAX_CHARS, NULL_SUMMARY_SENTINEL, UNTITLED_CALL_SENTINEL,
    parse_custom_speaker_results, parse_summary, sanitize_call_name,
};

#[test]
fn parse_summary_returns_none_for_null_sentinel() {
    assert_eq!(parse_summary(NULL_SUMMARY_SENTINEL), None);
    assert_eq!(parse_summary("null"), None);
    assert_eq!(parse_summary("  NULL  "), None);
    assert_eq!(parse_summary("\"NULL\""), None);
    assert_eq!(parse_summary("`null`"), None);
}

#[test]
fn parse_summary_returns_none_for_empty_input() {
    assert_eq!(parse_summary(""), None);
    assert_eq!(parse_summary("   \n\t"), None);
    assert_eq!(parse_summary("\"\""), None);
}

#[test]
fn parse_summary_strips_surrounding_quotes_and_whitespace() {
    assert_eq!(
        parse_summary("  \"Alex and Priya reviewed Q3 spend.\"  ").as_deref(),
        Some("Alex and Priya reviewed Q3 spend.")
    );
}

#[test]
fn parse_summary_preserves_real_summary_text() {
    let input = "Alex and Priya reviewed Q3 marketing spend and agreed to cut paid \
                 search by 20% next quarter.";
    assert_eq!(parse_summary(input).as_deref(), Some(input));
}

#[test]
fn parse_summary_does_not_mistake_substring_for_sentinel() {
    // Real summary that happens to contain the word "null" — must not be
    // suppressed.
    let input = "Discussed handling of null fields in the API response.";
    assert_eq!(parse_summary(input).as_deref(), Some(input));
}

#[test]
fn sanitize_strips_quotes_and_whitespace() {
    assert_eq!(
        sanitize_call_name("  \"Q4 Planning Sync\"  ").as_deref(),
        Some("Q4 Planning Sync")
    );
    assert_eq!(
        sanitize_call_name("'Standup Prep'").as_deref(),
        Some("Standup Prep")
    );
    assert_eq!(
        sanitize_call_name("`Rocket Launch`").as_deref(),
        Some("Rocket Launch")
    );
}

#[test]
fn sanitize_returns_none_for_empty_or_quote_only_input() {
    assert_eq!(sanitize_call_name(""), None);
    assert_eq!(sanitize_call_name("   "), None);
    assert_eq!(sanitize_call_name("\"\""), None);
}

#[test]
fn sanitize_returns_none_for_untitled_sentinel() {
    assert_eq!(sanitize_call_name(UNTITLED_CALL_SENTINEL), None);
    assert_eq!(sanitize_call_name("untitled_call"), None);
    assert_eq!(sanitize_call_name("  \"UNTITLED_CALL\"  "), None);
}

#[test]
fn sanitize_collapses_internal_unicode_whitespace() {
    assert_eq!(
        sanitize_call_name("  \"Weekly\nPlanning\tSync\u{00a0}Notes\"  ").as_deref(),
        Some("Weekly Planning Sync Notes")
    );
}

#[test]
fn sanitize_truncates_to_word_boundary_under_cap() {
    let input = "Quarterly Goals Sync ".repeat(20);
    let out = sanitize_call_name(&input).expect("non-empty input should sanitize to Some");
    assert!(out.chars().count() <= CALL_NAME_MAX_CHARS);
    assert!(!out.ends_with(' '));
    assert!(out.starts_with("Quarterly Goals Sync"));
}

#[test]
fn sanitize_preserves_short_titles_verbatim() {
    let input = "Rocket Launch Postmortem";
    assert_eq!(sanitize_call_name(input).as_deref(), Some(input));
}

#[test]
fn parse_custom_speaker_results_accepts_json_array() {
    let transcript_id = Uuid::from_u128(0xaaaaaaaa_aaaa_aaaa_aaaa_aaaaaaaaaaaa);
    let valid_transcript_ids = HashSet::from([transcript_id]);
    let candidate_user_ids = HashSet::from(["macro|alice@example.com".to_string()]);

    let results = parse_custom_speaker_results(
        r#"[{"call_transcript_id":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","custom_speaker":"macro|alice@example.com"}]"#,
        &valid_transcript_ids,
        &candidate_user_ids,
    )
    .expect("valid result should parse");

    assert_eq!(results.len(), 1);
    assert_eq!(results[0].call_transcript_id, transcript_id);
    assert_eq!(results[0].custom_speaker, "macro|alice@example.com");
}

#[test]
fn parse_custom_speaker_results_accepts_fenced_json_and_camel_case() {
    let transcript_id = Uuid::from_u128(0xbbbbbbbb_bbbb_bbbb_bbbb_bbbbbbbbbbbb);
    let valid_transcript_ids = HashSet::from([transcript_id]);
    let candidate_user_ids = HashSet::from(["macro|bob@example.com".to_string()]);

    let results = parse_custom_speaker_results(
        "```json\n[{\"callTranscriptId\":\"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb\",\"customSpeaker\":\"macro|bob@example.com\"}]\n```",
        &valid_transcript_ids,
        &candidate_user_ids,
    )
    .expect("fenced json should parse");

    assert_eq!(results.len(), 1);
    assert_eq!(results[0].call_transcript_id, transcript_id);
    assert_eq!(results[0].custom_speaker, "macro|bob@example.com");
}

#[test]
fn parse_custom_speaker_results_filters_unknown_invalid_and_duplicate_entries() {
    let transcript_id = Uuid::from_u128(0xcccccccc_cccc_cccc_cccc_cccccccccccc);
    let unknown_id = Uuid::from_u128(0xdddddddd_dddd_dddd_dddd_dddddddddddd);
    let valid_transcript_ids = HashSet::from([transcript_id]);
    let candidate_user_ids = HashSet::from(["macro|carol@example.com".to_string()]);

    let raw = format!(
        r#"[
            {{"call_transcript_id":"{transcript_id}","custom_speaker":"macro|carol@example.com"}},
            {{"call_transcript_id":"{transcript_id}","custom_speaker":"macro|carol@example.com"}},
            {{"call_transcript_id":"{unknown_id}","custom_speaker":"macro|carol@example.com"}},
            {{"call_transcript_id":"{transcript_id}","custom_speaker":"macro|mallory@example.com"}},
            {{"call_transcript_id":"{transcript_id}","custom_speaker":"not-a-user"}}
        ]"#
    );

    let results = parse_custom_speaker_results(&raw, &valid_transcript_ids, &candidate_user_ids)
        .expect("json should parse");

    assert_eq!(results.len(), 1);
    assert_eq!(results[0].call_transcript_id, transcript_id);
    assert_eq!(results[0].custom_speaker, "macro|carol@example.com");
}

#[test]
fn parse_custom_speaker_results_normalizes_candidate_user_ids() {
    let transcript_id = Uuid::from_u128(0xeeeeeeee_eeee_eeee_eeee_eeeeeeeeeeee);
    let valid_transcript_ids = HashSet::from([transcript_id]);
    let candidate = MacroUserIdStr::parse_from_str("macro|dana@example.com").unwrap();
    let candidate_user_ids = HashSet::from([candidate.as_ref().to_string()]);

    let results = parse_custom_speaker_results(
        r#"[{"call_transcript_id":"eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee","custom_speaker":"macro|DANA@example.com"}]"#,
        &valid_transcript_ids,
        &candidate_user_ids,
    )
    .expect("valid result should parse");

    assert_eq!(results.len(), 1);
    assert_eq!(results[0].custom_speaker, "macro|dana@example.com");
}
