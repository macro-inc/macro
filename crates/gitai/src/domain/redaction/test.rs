//! Secret-shaped test values are assembled at runtime (`concat!`/`repeat`)
//! so the repository's secret scanner does not flag this file.

use serde_json::json;

use super::*;

fn redact(text: &str) -> (String, RedactionHits) {
    let mut hits = RedactionHits::default();
    let redacted = redact_text(text, &mut hits).into_owned();
    (redacted, hits)
}

fn assert_masked(text: &str, secret: &str, rule: RedactionRule) {
    let (redacted, hits) = redact(text);
    assert!(
        !redacted.contains(secret),
        "{rule:?} left {secret} in {redacted}"
    );
    assert!(
        redacted.contains(&format!("[REDACTED:{}]", rule.as_str())),
        "{rule:?}: {redacted}"
    );
    assert_eq!(hits.get(rule), 1, "{rule:?}: {hits:?}");
    assert_eq!(hits.total(), 1, "{rule:?}: {hits:?}");
}

fn assert_untouched(text: &str) {
    let (redacted, hits) = redact(text);
    assert_eq!(redacted, text);
    assert_eq!(hits.total(), 0, "{text}: {hits:?}");
}

#[test]
fn github_tokens_are_masked_in_place() {
    let classic = format!("ghp_{}", "a1B2".repeat(9));
    let (redacted, _) = redact(&format!("export GITHUB_TOKEN={classic} # ci"));
    assert_eq!(redacted, "export GITHUB_TOKEN=[REDACTED:github_token] # ci");

    for prefix in ["gho_", "ghs_", "ghu_", "ghr_"] {
        let token = format!("{prefix}{}", "Zx9".repeat(12));
        assert_masked(
            &format!("token {token}."),
            &token,
            RedactionRule::GithubToken,
        );
    }
    let fine_grained = format!("github_pat_{}", "11ABCDEFG0_".repeat(5));
    assert_masked(&fine_grained, &fine_grained, RedactionRule::GithubToken);

    // The scratch client's hyphenated fake.
    let fake = concat!("ghp_", "FAKE-NOT-A-REAL-TOKEN-1234");
    assert_masked(&format!("token={fake}"), fake, RedactionRule::GithubToken);
}

#[test]
fn github_near_misses_are_kept() {
    assert_untouched("ghp_short");
    assert_untouched(&format!("xghp_{}", "a1B2".repeat(9)));
    assert_untouched("the ghp_ prefix marks a classic token");
}

#[test]
fn anthropic_and_openai_keys_are_told_apart() {
    let anthropic = format!("sk-ant-api03-{}", "Qw3r".repeat(8));
    assert_masked(
        &format!("ANTHROPIC_API_KEY={anthropic}"),
        &anthropic,
        RedactionRule::AnthropicKey,
    );

    let project = format!("sk-proj-{}", "FAKE".repeat(8));
    assert_masked(
        &format!("OPENAI_API_KEY={project}"),
        &project,
        RedactionRule::OpenaiKey,
    );

    let legacy = format!("sk-{}", "T3BlbkFJ".repeat(6));
    assert_masked(&legacy, &legacy, RedactionRule::OpenaiKey);
}

#[test]
fn openai_near_misses_are_kept() {
    assert_untouched("sk-short-key");
    assert_untouched("task-1234567890abcdefghijklmnop");
    assert_untouched("use the risk-assessment-checklist-template doc");
}

#[test]
fn stripe_keys_are_masked() {
    for prefix in ["sk_live_", "sk_test_", "rk_live_", "rk_test_"] {
        let key = format!("{prefix}{}", "4eC39HqLyjWDarjt".repeat(2));
        assert_masked(&format!("stripe {key}"), &key, RedactionRule::StripeKey);
    }
}

#[test]
fn stripe_near_misses_are_kept() {
    assert_untouched("pk_live_publishablekeyisfine123");
    assert_untouched("sk_test_short");
    // What git-ai's own redactor leaves behind.
    assert_untouched("sk_t********p7dc");
}

#[test]
fn slack_tokens_are_masked() {
    for prefix in ["xoxb-", "xoxp-", "xoxa-", "xoxs-"] {
        let token = format!("{prefix}{}", "1234567890-abcdef");
        assert_masked(&token, &token, RedactionRule::SlackToken);
    }
    assert_untouched("xoxb-short");
    assert_untouched("xoxz-1234567890-abcdef");
}

#[test]
fn aws_access_key_ids_are_masked() {
    let access = format!("AKIA{}", "IOSFODNN7EXAMPLE");
    assert_masked(
        &format!("aws_access_key_id={access}"),
        &access,
        RedactionRule::AwsAccessKey,
    );
    let session = format!("ASIA{}", "Y34FZKBOKMUTVV7A");
    assert_masked(&session, &session, RedactionRule::AwsAccessKey);
}

#[test]
fn aws_access_key_near_misses_are_kept() {
    // Too short, lowercase, embedded, and the scratch client's hyphenated fake
    // (not an AWS key shape).
    assert_untouched(&format!("AKIA{}", "IOSFODNN7EXAMP"));
    assert_untouched(&format!("akia{}", "iosfodnn7example"));
    assert_untouched(&format!("XAKIA{}", "IOSFODNN7EXAMPLE"));
    assert_untouched(concat!("AKIA", "-FAKE-NOT-A-REAL-KEY"));
}

#[test]
fn aws_secret_assignments_keep_the_name() {
    let secret = format!("wJalrXUtnFEMI/K7MDENG/{}", "bPxRfiCYEXAMPLEKEY");
    let (redacted, hits) = redact(&format!("aws_secret_access_key = {secret}"));
    assert_eq!(redacted, "aws_secret_access_key = [REDACTED:aws_secret]");
    assert_eq!(hits.get(RedactionRule::AwsSecret), 1);

    let (redacted, _) = redact(&format!("AWS_SESSION_TOKEN=\"{secret}\""));
    assert_eq!(redacted, "AWS_SESSION_TOKEN=\"[REDACTED:aws_secret]\"");

    assert_untouched("aws_secret_access_key = short");
    assert_untouched("set aws_secret_access_key from the vault");
}

#[test]
fn bearer_tokens_keep_the_scheme() {
    let token = format!("eyJhbGciOiJIUzI1NiJ9.{}", "eyJzdWIiOiIxMjM0In0");
    let (redacted, hits) = redact(&format!("Authorization: Bearer {token}"));
    assert_eq!(redacted, "Authorization: Bearer [REDACTED:bearer_token]");
    assert_eq!(hits.get(RedactionRule::BearerToken), 1);

    assert_untouched("the bearer of bad news");
    assert_untouched("Bearer short");
}

#[test]
fn a_typed_token_after_bearer_counts_once_under_its_type() {
    let token = format!("ghp_{}", "a1B2".repeat(9));
    let (redacted, hits) = redact(&format!("Authorization: Bearer {token}"));
    assert_eq!(redacted, "Authorization: Bearer [REDACTED:github_token]");
    assert_eq!(hits.total(), 1);
}

#[test]
fn private_key_blocks_are_masked_whole() {
    let block = concat!(
        "-----BEGIN RSA PRIVATE ",
        "KEY-----\nMIIEowIBAAKCAQEA\nabc\n-----END RSA PRIVATE KEY-----"
    );
    let (redacted, hits) = redact(&format!("key:\n{block}\ndone"));
    assert_eq!(redacted, "key:\n[REDACTED:private_key]\ndone");
    assert_eq!(hits.get(RedactionRule::PrivateKey), 1);

    let truncated = concat!("-----BEGIN OPENSSH PRIVATE ", "KEY-----\nb3BlbnNzaC1rZXk");
    assert_masked(truncated, "b3BlbnNzaC1rZXk", RedactionRule::PrivateKey);

    assert_untouched("-----BEGIN PUBLIC KEY-----\nMFkwEwYH\n-----END PUBLIC KEY-----");
}

#[test]
fn password_and_secret_assignments_keep_the_name() {
    let cases = [
        (
            "password=hunter2-fake-pw please",
            "password=[REDACTED:password_assignment] please",
        ),
        (
            "password=hunter2-fake-pw. Next",
            "password=[REDACTED:password_assignment]. Next",
        ),
        (
            "PASSWD = 'letmein'",
            "PASSWD = '[REDACTED:password_assignment]'",
        ),
        (
            "client_secret=abc123",
            "client_secret=[REDACTED:password_assignment]",
        ),
        (
            r#"{"password": "correct horse"}"#,
            r#"{"password": "[REDACTED:password_assignment]"}"#,
        ),
        (
            "db?user=a&pwd=s3cr3t&x=1",
            "db?user=a&pwd=[REDACTED:password_assignment]&x=1",
        ),
    ];
    for (text, expected) in cases {
        let (redacted, hits) = redact(text);
        assert_eq!(redacted, expected);
        assert_eq!(hits.get(RedactionRule::PasswordAssignment), 1, "{text}");
    }
}

#[test]
fn unquoted_colon_assignments_are_masked() {
    let cases = [
        (
            "password: hunter2-fake-pw",
            "password: [REDACTED:password_assignment]",
        ),
        (
            "  db_secret: 'letmein'\n",
            "  db_secret: '[REDACTED:password_assignment]'\n",
        ),
        (
            "The password: correcthorse. Then",
            "The password: [REDACTED:password_assignment]. Then",
        ),
    ];
    for (text, expected) in cases {
        let (redacted, hits) = redact(text);
        assert_eq!(redacted, expected);
        assert_eq!(hits.get(RedactionRule::PasswordAssignment), 1, "{text}");
    }
}

#[test]
fn password_near_misses_are_kept() {
    assert_untouched("reset your password in settings");
    assert_untouched("password: string;");
    assert_untouched("fn login(password: &str, secret: Option<String>)");
    assert_untouched("client_secret::load()");
    assert_untouched(r#"{"password": {"type": "string"}}"#);
    assert_untouched(r#"{"password": ""}"#);
    assert_untouched("passwords=");
}

#[test]
fn luhn_valid_card_numbers_are_masked() {
    for card in [
        concat!("4242", "424242424242"),
        concat!("4242 4242", " 4242 4242"),
        concat!("5555-5555", "-5555-4444"),
        concat!("3782 822463", " 10005"),
        concat!("6011", "111111111117"),
    ] {
        assert_masked(
            &format!("card {card} exp 12/34"),
            card,
            RedactionRule::CardNumber,
        );
    }
}

#[test]
fn card_near_misses_are_kept() {
    // Luhn-invalid, no network prefix (timestamps), too short, inside hex.
    assert_untouched(concat!("4242", "424242424241"));
    assert_untouched("1794543965103");
    assert_untouched("1794543965103776748");
    assert_untouched("424242424242");
    assert_untouched(concat!("a4242", "424242424242b"));
    assert_untouched("9237c8c1cdf2a07152059eaa8a61592efe1d1d86");
}

#[test]
fn json_strings_are_redacted_at_every_depth_and_keys_are_kept() {
    let token = format!("ghp_{}", "a1B2".repeat(9));
    let mut value = json!({
        "a": {"1": "https://github.com/macro-inc/macro"},
        "v": {"0": {
            "message": {"content": [{"text": format!("use {token}")}]},
            "password": "x",
            "count": 4242424242424242_u64,
        }},
    });
    let mut hits = RedactionHits::default();
    redact_json(&mut value, &mut hits);

    assert_eq!(
        value["v"]["0"]["message"]["content"][0]["text"],
        "use [REDACTED:github_token]"
    );
    assert_eq!(value["a"]["1"], "https://github.com/macro-inc/macro");
    // A number that is a card number is replaced by the mask.
    assert_eq!(value["v"]["0"]["count"], "[REDACTED:card_number]");
    assert_eq!(hits.total(), 2);
}

#[test]
fn numbers_that_are_not_card_numbers_are_kept() {
    let mut value = json!({"t": 1_794_543_965_103_u64, "n": 4242424242424241_u64, "f": 1.5});
    let before = value.clone();
    let mut hits = RedactionHits::default();
    redact_json(&mut value, &mut hits);

    assert_eq!(value, before);
    assert_eq!(hits.total(), 0);
}

#[test]
fn jwts_are_masked_without_bearer() {
    let jwt = concat!(
        "eyJhbGciOiJIUzI1NiJ9",
        ".eyJzdWIiOiIxMjM0NTY3ODkwIn0",
        ".dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U"
    );
    assert_masked(&format!("cookie session={jwt};"), jwt, RedactionRule::Jwt);
    assert_masked(&format!("token {jwt}"), jwt, RedactionRule::Jwt);
}

#[test]
fn jwt_near_misses_are_kept() {
    assert_untouched("eyJhbGciOiJIUzI1NiJ9");
    assert_untouched("eyJhbGciOiJIUzI1NiJ9.not-a-payload.x");
}

#[test]
fn url_credentials_are_masked_and_the_url_kept() {
    // `@` is joined at runtime so the PII scanner does not read an address.
    let (redacted, hits) = redact(&format!(
        "DATABASE_URL=postgres://app:s3cr3t-pw{}db.internal:5432/app",
        '@'
    ));
    assert_eq!(
        redacted,
        "DATABASE_URL=postgres://app:[REDACTED:url_credential]@db.internal:5432/app"
    );
    assert_eq!(hits.get(RedactionRule::UrlCredential), 1);

    assert_masked(
        &format!(
            "git clone https://x-access-token:abc123def{}github.com/o/r",
            '@'
        ),
        "abc123def",
        RedactionRule::UrlCredential,
    );
}

#[test]
fn url_near_misses_are_kept() {
    assert_untouched("https://github.com/macro-inc/macro");
    assert_untouched("http://localhost:8080/gitai");
    assert_untouched(&format!("ssh://git{}github.com/o/r", '@'));
    assert_untouched(&format!("mailto:dev{}example.com", '@'));
}

#[test]
fn doppler_tokens_are_masked() {
    for prefix in ["dp.st.prd.", "dp.pt.", "dp.ct.", "dp.sa.", "dp.scim."] {
        let token = format!("{prefix}{}", "Ab3dE".repeat(9));
        assert_masked(
            &format!("DOPPLER_TOKEN={token} doppler run"),
            &token,
            RedactionRule::DopplerToken,
        );
    }
}

#[test]
fn doppler_near_misses_are_kept() {
    assert_untouched("dp.st.short");
    assert_untouched("the dp.pt. prefix marks a personal token");
}
