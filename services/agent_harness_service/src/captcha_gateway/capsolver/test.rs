//! The adapter against the real CapSolver. Ignored: it spends real credits,
//! and runs only with `CAPSOLVER_API_KEY` in the process environment:
//!
//! ```sh
//! CAPSOLVER_API_KEY=... cargo test -p agent_harness_service \
//!   capsolver_live_contract -- --ignored --nocapture
//! ```

use std::sync::Arc;

use ai_usage::{UsageEvent, UsageRecorder};
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use uuid::Uuid;

use super::Capsolver;
use crate::anthropic_gateway::brain::BrainCaller;
use crate::captcha_gateway::solves::{CaptchaTask, Challenge, SolveLimits, SolveOutcome, Solves};
use crate::config::CapsolverApiKey;

/// Google's and Cloudflare's published always-pass test site keys, on a page
/// that doesn't exist: the vendor needs no real page for them.
const TURNSTILE_TEST_KEY: &str = "1x00000000000000000000AA";
const RECAPTCHA_V2_TEST_KEY: &str = "6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI";
const FIXTURE_PAGE: &str = "http://127.0.0.1/captcha-fixture";

struct NoUsage;

impl UsageRecorder for NoUsage {
    fn record(&self, _event: UsageEvent) {}
}

#[tokio::test]
#[ignore = "calls the real CapSolver and spends credits; needs CAPSOLVER_API_KEY"]
async fn capsolver_live_contract() {
    let Some(key) = CapsolverApiKey::new()
        .as_ref()
        .and_then(CapsolverApiKey::value)
        .map(|key| key.trim().to_owned())
        .filter(|key| !key.is_empty())
    else {
        eprintln!("CAPSOLVER_API_KEY is unset: nothing sent");
        return;
    };
    let base_url = macro_service_urls::CapsolverApiUrl::new().unwrap();
    let solves = Arc::new(Solves::new(
        Some(Capsolver::new(&key, base_url.as_str()).unwrap()),
        Arc::new(NoUsage),
        SolveLimits::default(),
    ));
    let agent = BrainCaller {
        user_id: MacroUserIdStr::parse_from_str("macro|live-contract@agents.macro.invalid")
            .unwrap()
            .into_owned(),
        team_id: Uuid::now_v7(),
    };

    let challenges = [
        (
            "turnstile",
            Challenge::Turnstile {
                page_url: FIXTURE_PAGE.to_owned(),
                site_key: TURNSTILE_TEST_KEY.to_owned(),
                action: None,
                cdata: None,
            },
        ),
        (
            "recaptchaV2",
            Challenge::RecaptchaV2 {
                page_url: FIXTURE_PAGE.to_owned(),
                site_key: RECAPTCHA_V2_TEST_KEY.to_owned(),
                invisible: false,
                enterprise: false,
                data_s: None,
                action: None,
            },
        ),
    ];
    let mut outcomes = Vec::new();
    for (name, challenge) in challenges {
        let outcome = solves
            .solve(
                &agent,
                Uuid::now_v7(),
                CaptchaTask::new(challenge).unwrap(),
                &tracing::Span::none(),
            )
            .await
            .unwrap();
        // The token's Debug is redacted; a vendor error shows its kind.
        eprintln!("{name}: {outcome:?}");
        outcomes.push((name, outcome));
    }

    for (name, outcome) in outcomes {
        match outcome {
            SolveOutcome::Solved { token, .. } => {
                let token = serde_json::to_value(&token).unwrap();
                assert!(
                    token.as_str().is_some_and(|token| !token.is_empty()),
                    "{name} came back with no token"
                );
            }
            other => panic!("{name} was not solved: {other:?}"),
        }
    }
}
