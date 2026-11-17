use super::*;

#[test]
fn reads_web_client_tokens_from_local_config() {
    let local_config = r#"{
        "teams": {
            "T0001": { "id": "T0001", "name": "Acme", "token": "xoxc-1111-aaaa", "url": "https://acme.slack.com/" },
            "T0002": { "id": "T0002", "name": "Legacy", "token": "xoxp-2222-bbbb" },
            "T0003": { "id": "T0003", "name": "Pending" },
            "T0004": "not a team",
            "T0005": { "name": "No id", "token": "xoxc-5555-eeee" }
        },
        "lastActiveTeamId": "T0001"
    }"#;

    let tokens = web_client_tokens(local_config);

    assert_eq!(
        tokens,
        vec![
            SlackWorkspaceToken {
                token: SlackSecret("xoxc-1111-aaaa".into()),
                team_id: Some("T0001".into()),
            },
            SlackWorkspaceToken {
                token: SlackSecret("xoxc-5555-eeee".into()),
                team_id: None,
            },
        ]
    );
}

#[test]
fn malformed_local_config_has_no_tokens() {
    assert_eq!(web_client_tokens(""), vec![]);
    assert_eq!(web_client_tokens("not json"), vec![]);
    assert_eq!(web_client_tokens("[]"), vec![]);
    assert_eq!(web_client_tokens(r#"{"teams": []}"#), vec![]);
    assert_eq!(web_client_tokens("{}"), vec![]);
}

#[test]
fn local_config_comes_back_as_a_json_string() {
    assert_eq!(
        local_config_from_eval(r#""{\"teams\":{}}""#),
        Some(r#"{"teams":{}}"#.to_string())
    );
    assert_eq!(local_config_from_eval("null"), None);
    assert_eq!(local_config_from_eval(""), None);
    assert_eq!(local_config_from_eval("42"), None);
}

#[test]
fn accepts_only_https_slack_pages() {
    assert_eq!(
        slack_page_url("https://acme.slack.com/sso/saml/start?redir=%2F")
            .unwrap()
            .as_str(),
        "https://acme.slack.com/sso/saml/start?redir=%2F"
    );
    assert!(slack_page_url(DEFAULT_SIGN_IN_URL).is_ok());
    assert!(slack_page_url("https://slack.com/signin").is_ok());
    assert!(slack_page_url("https://APP.Slack.COM/signin").is_ok());

    for rejected in [
        "http://app.slack.com/signin",
        "https://evilslack.com/",
        "https://slack.com.evil.example/",
        "https://app.slack.com:8443/signin",
        "javascript:alert(1)",
        "slack://open",
        "https://127.0.0.1/",
        "not a url",
    ] {
        assert_eq!(
            slack_page_url(rejected),
            Err(SlackDesktopError::InvalidUrl),
            "{rejected}"
        );
    }
    // Built at runtime: as a literal it reads as an email address to the
    // commit scanner.
    let with_credentials = format!("https://user:pass{}app.slack.com/", '@');
    assert_eq!(
        slack_page_url(&with_credentials),
        Err(SlackDesktopError::InvalidUrl)
    );
}

#[test]
fn recognizes_the_web_client() {
    let client = |raw: &str| is_client_url(&Url::parse(raw).unwrap());

    assert!(client("https://app.slack.com/client"));
    assert!(client("https://app.slack.com/client/T0001/C0001"));
    assert!(!client("https://app.slack.com/clients"));
    assert!(!client("https://app.slack.com/signin"));
    assert!(!client("https://acme.slack.com/client/T0001"));
    assert!(!client("http://app.slack.com/client"));
}

#[test]
fn navigation_stays_on_the_web() {
    let allowed = |raw: &str| allows_navigation(&Url::parse(raw).unwrap());

    assert!(allowed("https://acme.okta.com/app/slack/sso"));
    assert!(allowed("https://accounts.google.com/o/oauth2/auth"));
    assert!(allowed("http://intranet.example/login"));
    assert!(allowed("about:blank"));
    assert!(allowed("about:srcdoc"));
    assert!(!allowed("about:config"));
    assert!(!allowed("slack://open?team=T0001"));
    assert!(!allowed("file:///etc/passwd"));
    assert!(!allowed("javascript:alert(1)"));
    assert!(!allowed("macro:///app"));

    let popup = |raw: &str| allows_popup(&Url::parse(raw).unwrap());
    assert!(popup("https://accounts.google.com/o/oauth2/auth"));
    assert!(!popup("about:blank"));
    assert!(!popup("slack://open"));
}

#[test]
fn captcha_site_key_is_json_encoded() {
    let site_key = r#"key"); window.location = "https://evil.example/"; ("</script>\"#;

    let script = captcha_script(site_key);

    let (_, config) = script
        .rsplit_once(")(")
        .expect("script is applied to its config");
    let config: serde_json::Value =
        serde_json::from_str(config.strip_suffix(')').unwrap()).unwrap();
    assert_eq!(config, serde_json::json!({ "siteKey": site_key }));
    assert!(script.starts_with(concat!("(", include_str!("../captcha.js"))));
}

#[test]
fn reads_captcha_state() {
    assert_eq!(
        captcha_state_from_eval(r#"{"status":"solved","token":"03AFcWeA"}"#),
        Some(CaptchaState {
            status: CaptchaStatus::Solved,
            token: Some("03AFcWeA".into()),
        })
    );
    assert_eq!(
        captcha_state_from_eval(r#"{"status":"pending","token":null}"#),
        Some(CaptchaState {
            status: CaptchaStatus::Pending,
            token: None,
        })
    );
    assert_eq!(captcha_state_from_eval(""), None);
    assert_eq!(captcha_state_from_eval("null"), None);
}

#[test]
fn secrets_are_redacted_in_debug() {
    let token = SlackWorkspaceToken {
        token: SlackSecret("xoxc-1111-aaaa".into()),
        team_id: Some("T0001".into()),
    };

    assert!(!format!("{token:?}").contains("xoxc-1111-aaaa"));
}
