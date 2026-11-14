use slack_fake_server::{FakeSlack, LoginAccount, LoginCaptcha, LoginMagic, LoginWorkspace};

use super::fake_endpoints;
use crate::login::{BrowserReason, EmailLogin, LoginErrorKind, LoginInput, LoginState, LoginStep};
use crate::{Secret, TeamId};

fn workspace(team_id: &str, name: &str, magic: LoginMagic) -> LoginWorkspace {
    LoginWorkspace {
        team_id: team_id.to_owned(),
        name: name.to_owned(),
        domain: name.to_lowercase(),
        token: format!("xoxc-{}-token", team_id.to_lowercase()),
        cookie: format!("xoxd-{}/cookie+", team_id.to_lowercase()),
        magic,
        sso_required: false,
        two_factor_pin: None,
    }
}

/// Serializes the state and reads it back, as a session-service replica
/// handing the login to another would.
fn handed_over(state: LoginState) -> LoginState {
    let stored = serde_json::to_string(&state).expect("state serializes");
    serde_json::from_str(&stored).expect("state deserializes")
}

fn next_state(step: LoginStep) -> LoginState {
    match step {
        LoginStep::Next(state) => state,
        other => panic!("expected another step, got {other:?}"),
    }
}

#[tokio::test]
async fn email_login_with_captcha_resumes_across_replicas() {
    let fake = FakeSlack::start().await.expect("fake starts");
    fake.add_login_account(LoginAccount {
        email: "person@example.com".to_owned(),
        code: "ABC123".to_owned(),
        captcha: Some(LoginCaptcha {
            site_key: "site-key-1".to_owned(),
            solution: "solved".to_owned(),
        }),
        workspaces: vec![
            workspace("T0CODE", "Code", LoginMagic::Code),
            workspace("T0LINK", "Link", LoginMagic::Link),
        ],
    });
    let login = EmailLogin::new(fake_endpoints(&fake)).expect("login client");

    let state = next_state(
        login
            .step(
                LoginState::AwaitingEmail,
                LoginInput::Email("person@example.com".to_owned()),
            )
            .await
            .expect("email accepted"),
    );
    let LoginState::AwaitingCaptcha { site_key, .. } = &state else {
        panic!("expected a captcha, got {state:?}");
    };
    assert_eq!(site_key, "site-key-1");
    assert!(!format!("{state:?}").contains("person@example.com"));

    let rejected = login
        .step(
            handed_over(state),
            LoginInput::CaptchaSolution(Secret::new("wrong".to_owned())),
        )
        .await
        .expect_err("wrong solution");
    assert!(matches!(rejected.kind, LoginErrorKind::CaptchaRejected));
    let state = next_state(
        login
            .step(
                handed_over(rejected.resume_from),
                LoginInput::CaptchaSolution(Secret::new("solved".to_owned())),
            )
            .await
            .expect("captcha accepted"),
    );
    assert!(matches!(state, LoginState::AwaitingEmailCode { .. }));

    let rejected = login
        .step(
            handed_over(state),
            LoginInput::EmailCode(Secret::new("zzz-999".to_owned())),
        )
        .await
        .expect_err("wrong code");
    assert!(matches!(rejected.kind, LoginErrorKind::InvalidCode));
    let state = next_state(
        login
            .step(
                handed_over(rejected.resume_from),
                LoginInput::EmailCode(Secret::new("abc-123".to_owned())),
            )
            .await
            .expect("code accepted"),
    );
    let LoginState::ChoosingWorkspace { workspaces, .. } = &state else {
        panic!("expected a workspace choice, got {state:?}");
    };
    let names: Vec<&str> = workspaces
        .iter()
        .map(|workspace| workspace.name.as_str())
        .collect();
    assert_eq!(names, vec!["Code", "Link"]);

    let LoginStep::Complete {
        workspace,
        credentials,
    } = login
        .step(
            handed_over(state.clone()),
            LoginInput::Workspace(TeamId::new("T0CODE").expect("team")),
        )
        .await
        .expect("magic code sign-in")
    else {
        panic!("expected a session");
    };
    assert_eq!(workspace.team_id.as_str(), "T0CODE");
    assert_eq!(credentials.token.expose(), "xoxc-t0code-token");
    assert_eq!(credentials.cookie.expose(), "xoxd-t0code/cookie+");

    // The magic link page holds no token; the app's /auth endpoint does.
    let LoginStep::Complete { credentials, .. } = login
        .step(
            handed_over(state),
            LoginInput::Workspace(TeamId::new("T0LINK").expect("team")),
        )
        .await
        .expect("magic link sign-in")
    else {
        panic!("expected a session");
    };
    assert_eq!(credentials.token.expose(), "xoxc-t0link-token");
    assert_eq!(credentials.cookie.expose(), "xoxd-t0link/cookie+");
}

#[tokio::test]
async fn two_factor_and_sso_workspaces() {
    let fake = FakeSlack::start().await.expect("fake starts");
    let mut two_factor = workspace("T0TWOFA", "Guarded", LoginMagic::Code);
    two_factor.two_factor_pin = Some("123456".to_owned());
    let mut sso = workspace("T0SSO", "Corp", LoginMagic::Code);
    sso.sso_required = true;
    fake.add_login_account(LoginAccount {
        email: "person@example.com".to_owned(),
        code: "XYZ789".to_owned(),
        captcha: None,
        workspaces: vec![two_factor, sso],
    });
    let login = EmailLogin::new(fake_endpoints(&fake)).expect("login client");

    let state = next_state(
        login
            .step(
                LoginState::AwaitingEmail,
                LoginInput::Email(" person@example.com ".to_owned()),
            )
            .await
            .expect("email accepted"),
    );
    let state = next_state(
        login
            .step(
                handed_over(state),
                LoginInput::EmailCode(Secret::new("xyz789".to_owned())),
            )
            .await
            .expect("code accepted"),
    );

    let LoginStep::BrowserRequired { reason, .. } = login
        .step(
            handed_over(state.clone()),
            LoginInput::Workspace(TeamId::new("T0SSO").expect("team")),
        )
        .await
        .expect("sso answer")
    else {
        panic!("expected a browser hand-off");
    };
    assert_eq!(reason, BrowserReason::SsoRequired);

    let two_factor_state = next_state(
        login
            .step(
                handed_over(state),
                LoginInput::Workspace(TeamId::new("T0TWOFA").expect("team")),
            )
            .await
            .expect("two-factor challenge"),
    );
    assert!(matches!(
        two_factor_state,
        LoginState::AwaitingTwoFactor { .. }
    ));

    let rejected = login
        .step(
            handed_over(two_factor_state),
            LoginInput::TwoFactorCode(Secret::new("000000".to_owned())),
        )
        .await
        .expect_err("wrong pin");
    assert!(matches!(
        rejected.kind,
        LoginErrorKind::InvalidTwoFactorCode
    ));
    let LoginStep::Complete { credentials, .. } = login
        .step(
            handed_over(rejected.resume_from),
            LoginInput::TwoFactorCode(Secret::new("123456".to_owned())),
        )
        .await
        .expect("two-factor sign-in")
    else {
        panic!("expected a session");
    };
    assert_eq!(credentials.token.expose(), "xoxc-t0twofa-token");

    let wrong = login
        .step(
            LoginState::AwaitingEmail,
            LoginInput::Workspace(TeamId::new("T0SSO").expect("team")),
        )
        .await
        .expect_err("input for another step");
    assert!(matches!(wrong.kind, LoginErrorKind::WrongInput));
    assert_eq!(wrong.resume_from, LoginState::AwaitingEmail);
}
