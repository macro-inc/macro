use super::*;

const URL_SCREEN: &[u8] = include_bytes!("../testdata/setup-token-screen1.raw");
const REJECTED_SCREEN: &[u8] = include_bytes!("../testdata/setup-token-screen2.raw");
const CAPTURED_URL: &str = "https://claude.com/cai/oauth/authorize?code=true&client_id=9d1c250a-e61b-44d9-88ed-5944d1962f5e&response_type=code&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback&scope=user%3Ainference&code_challenge=zZqnXHwmWP2UOUEYKGrntM8pcw0_jmCn9Eg8xlA3iRQ&code_challenge_method=S256&state=Vgqcx2pGwkM1iRLxEkOLbdnGn4V2ILZyKhQUhu0rvQE";

#[test]
fn the_url_is_joined_from_its_wrapped_rows() {
    // The capture is 200 columns wide, where the URL wraps onto two rows.
    let mut parser = vt100::Parser::new(60, 200, 0);
    parser.process(URL_SCREEN);
    let rows: Vec<String> = parser.screen().rows(0, 200).collect();

    assert_eq!(sign_in_url(&rows), Some(CAPTURED_URL.to_owned()));
    assert_eq!(code_outcome(&rows), None);
}

#[test]
fn no_url_before_the_code_prompt_is_drawn() {
    let prompt = URL_SCREEN
        .windows(5)
        .position(|window| window == b"Paste")
        .expect("the capture shows the prompt");
    let mut parser = vt100::Parser::new(60, 200, 0);
    parser.process(&URL_SCREEN[..prompt]);
    let rows: Vec<String> = parser.screen().rows(0, 200).collect();

    assert_eq!(sign_in_url(&rows), None);
}

#[test]
fn a_rejected_code_reads_as_rejected() {
    let mut parser = vt100::Parser::new(60, 200, 0);
    parser.process(URL_SCREEN);
    parser.process(REJECTED_SCREEN);
    let rows: Vec<String> = parser.screen().rows(0, 200).collect();

    assert_eq!(code_outcome(&rows), Some(CodeOutcome::Rejected));
}

#[test]
fn a_created_token_is_read_with_its_lifetime() {
    let rows: Vec<String> = [
        "",
        " ✓ Long-lived authentication token created successfully!",
        "",
        " Your OAuth token (valid for 1 year):",
        "",
        " sk-ant-oat01-TESTTOKEN-abcdefghijklmnopqrstuvwxyz0123456789",
        "",
        " Store this token securely. You won't be able to see it again.",
        "",
        " Use this token by setting: export CLAUDE_CODE_OAUTH_TOKEN=<token>",
    ]
    .map(str::to_owned)
    .to_vec();

    assert_eq!(
        code_outcome(&rows),
        Some(CodeOutcome::Created {
            token: "sk-ant-oat01-TESTTOKEN-abcdefghijklmnopqrstuvwxyz0123456789".to_owned(),
            valid_for: Some(Validity::Years(1)),
        })
    );
}

#[test]
fn a_token_drawn_without_the_rows_after_it_is_not_read_yet() {
    let rows: Vec<String> = [
        " ✓ Long-lived authentication token created successfully!",
        " Your OAuth token (valid for 1 year):",
        " sk-ant-oat01-TESTTOK",
    ]
    .map(str::to_owned)
    .to_vec();

    assert_eq!(code_outcome(&rows), None);
}
