//! Provider responses that mean Macro's account with an AI provider can no
//! longer serve anyone: the account is suspended, or it is out of credit or
//! past its spending limit. Every request fails the same way until someone
//! fixes billing, so each one is logged as `ai provider account unavailable`,
//! which a Datadog monitor (infra/stacks/monitoring/monitors/ai-providers.ts)
//! alerts on. That log line and its `provider`, `http_status` and `reason` fields
//! are the monitor's contract.
//!
//! Rate limits are not account failures: they clear on their own. Gemini says
//! "exceeded your current quota" for its per-minute limits too, so that text
//! is not matched; OpenAI's billing error is matched by its `insufficient_quota`
//! code instead.

#[cfg(test)]
mod test;

/// Why a provider refused to serve Macro's account.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
#[strum(serialize_all = "snake_case")]
pub enum AccountUnavailable {
    /// The provider suspended, deactivated or disabled the account, e.g.
    /// Fireworks' `412 Precondition Failed: Account … is suspended`. The body
    /// decides, not the 412: other preconditions fail with 412 too.
    Suspended,
    /// The account ran out of prepaid credit or reached its spending limit.
    OutOfCredit,
}

/// Body text, lowercased, that marks a suspended account.
const SUSPENDED: &[&str] = &[
    // Fireworks (412), Gemini (403 `CONSUMER_SUSPENDED`).
    "is suspended",
    "has been suspended",
    // OpenAI (401).
    "account_deactivated",
    // Anthropic (403): "This organization has been disabled."
    "organization has been disabled",
];

/// Body text, lowercased, that marks an account out of credit.
const OUT_OF_CREDIT: &[&str] = &[
    // Anthropic (400).
    "credit balance is too low",
    // Anthropic (400): "You have reached your specified API usage limits."
    "specified api usage limits",
    // OpenAI (429).
    "insufficient_quota",
    "billing_hard_limit_reached",
    // Gemini (403 `BILLING_DISABLED`).
    "billing_disabled",
    "spending limit",
];

/// Classify a provider's error response. `status` is the HTTP status when the
/// client kept it; `body` is the error body or message.
pub fn account_unavailable(status: Option<u16>, body: &str) -> Option<AccountUnavailable> {
    if status.is_some_and(|status| !(400..500).contains(&status)) {
        return None;
    }

    if status == Some(402) {
        return Some(AccountUnavailable::OutOfCredit);
    }

    let body = body.to_lowercase();
    if SUSPENDED.iter().any(|text| body.contains(text)) {
        return Some(AccountUnavailable::Suspended);
    }

    if OUT_OF_CREDIT.iter().any(|text| body.contains(text)) {
        return Some(AccountUnavailable::OutOfCredit);
    }

    None
}

/// Log `ai provider account unavailable` when a response from `provider`
/// (`anthropic`, `fireworks`, …) means Macro's account there is unusable.
/// Only call it for requests made with Macro's own key: an agent's own key
/// failing is that agent owner's billing, not an outage.
pub fn report_provider_error(provider: &str, status: Option<u16>, body: &str) {
    if let Some(reason) = account_unavailable(status, body) {
        let reason: &'static str = reason.into();
        tracing::error!(
            provider,
            http_status = status,
            reason,
            "ai provider account unavailable"
        );
    }
}
