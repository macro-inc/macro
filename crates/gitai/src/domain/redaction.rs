//! The server's redaction pass. git-ai's own redactor is entropy-based and
//! misses low-entropy and well-known secret shapes, so every string of a kept
//! event goes through these pattern rules before anything is written or
//! logged. A match keeps its line: only the secret is replaced, by
//! `[REDACTED:<rule>]`.

use std::borrow::Cow;
use std::collections::BTreeMap;
use std::sync::LazyLock;

use lazy_regex::regex;
use regex::{Captures, Regex};
use serde_json::Value;

#[cfg(test)]
mod test;

/// One kind of secret. The name is the `rule` attribute of
/// `gitai.redaction.hits` and the tag in the mask.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, strum::IntoStaticStr)]
#[strum(serialize_all = "snake_case")]
pub enum RedactionRule {
    /// `-----BEGIN … PRIVATE KEY-----` blocks.
    PrivateKey,
    /// `ghp_`, `gho_`, `ghs_`, `ghu_`, `ghr_` and `github_pat_` tokens.
    GithubToken,
    /// `sk-ant-` keys.
    AnthropicKey,
    /// `sk-`, `sk-proj-` keys.
    OpenaiKey,
    /// `sk_live_`, `sk_test_`, `rk_live_`, `rk_test_` keys.
    StripeKey,
    /// `xoxb-`, `xoxp-`, … tokens.
    SlackToken,
    /// `AKIA…`/`ASIA…` access key ids.
    AwsAccessKey,
    /// Values assigned to AWS secret key or session token names.
    AwsSecret,
    /// Doppler service, personal, CLI, service account and SCIM tokens
    /// (`dp.st.`, `dp.pt.`, `dp.ct.`, `dp.sa.`, `dp.scim.`).
    DopplerToken,
    /// JSON Web Tokens (`eyJ….eyJ….…`), with or without `Bearer`.
    Jwt,
    /// `Bearer <token>`.
    BearerToken,
    /// The password in a URL's userinfo (`scheme://user:password@host`).
    UrlCredential,
    /// Values assigned to `password`, `passwd`, `pwd` or `*secret` names,
    /// with `=` or `:`.
    PasswordAssignment,
    /// Luhn-valid card numbers with a card network prefix.
    CardNumber,
}

impl RedactionRule {
    /// Snake-case name.
    pub fn as_str(self) -> &'static str {
        self.into()
    }

    fn mask(self) -> String {
        format!("[REDACTED:{}]", self.as_str())
    }
}

/// Matches per rule, summed over everything redacted with it.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RedactionHits(BTreeMap<RedactionRule, u64>);

impl RedactionHits {
    fn add(&mut self, rule: RedactionRule) {
        *self.0.entry(rule).or_default() += 1;
    }

    /// Matches of one rule.
    pub fn get(&self, rule: RedactionRule) -> u64 {
        self.0.get(&rule).copied().unwrap_or_default()
    }

    /// Matches of every rule.
    pub fn total(&self) -> u64 {
        self.0.values().sum()
    }

    /// Each rule that matched, with its count.
    pub fn iter(&self) -> impl Iterator<Item = (RedactionRule, u64)> + '_ {
        self.0.iter().map(|(rule, count)| (*rule, *count))
    }

    /// Adds another tally to this one.
    pub fn merge(&mut self, other: &RedactionHits) {
        for (rule, count) in other.iter() {
            *self.0.entry(rule).or_default() += count;
        }
    }
}

/// What a match replaces.
enum Mask {
    /// The whole match.
    Whole,
    /// Only the named capture group, so the assigned name stays readable.
    Group(&'static str),
}

struct Pattern {
    rule: RedactionRule,
    regex: &'static Regex,
    mask: Mask,
}

/// Applied in order. Token shapes come before the generic `Bearer` and
/// assignment rules, so a token is tagged by its kind; a masked value starts
/// with `[`, which the later rules do not match. `regex!` checks each pattern
/// at compile time.
static PATTERNS: LazyLock<[Pattern; 13]> = LazyLock::new(|| {
    [
        Pattern {
            rule: RedactionRule::PrivateKey,
            // An unterminated block (a truncated paste) is masked to the end.
            regex: regex!(
                r"-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----(?s:.*?-----END [A-Z0-9 ]*PRIVATE KEY-----|.*)"
            ),
            mask: Mask::Whole,
        },
        Pattern {
            rule: RedactionRule::GithubToken,
            // Real tokens are alphanumeric; `-` is allowed too because the
            // prefix alone is distinctive and hyphenated fakes should not leak.
            regex: regex!(r"\b(?:gh[pousr]_[A-Za-z0-9_-]{20,255}|github_pat_[A-Za-z0-9_]{20,255})"),
            mask: Mask::Whole,
        },
        Pattern {
            rule: RedactionRule::AnthropicKey,
            regex: regex!(r"\bsk-ant-[A-Za-z0-9_-]{20,}"),
            mask: Mask::Whole,
        },
        Pattern {
            rule: RedactionRule::OpenaiKey,
            regex: regex!(r"\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}"),
            mask: Mask::Whole,
        },
        Pattern {
            rule: RedactionRule::StripeKey,
            regex: regex!(r"\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{10,}"),
            mask: Mask::Whole,
        },
        Pattern {
            rule: RedactionRule::SlackToken,
            regex: regex!(r"\bxox[abposr]-[A-Za-z0-9-]{10,}"),
            mask: Mask::Whole,
        },
        Pattern {
            rule: RedactionRule::AwsAccessKey,
            regex: regex!(r"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b"),
            mask: Mask::Whole,
        },
        Pattern {
            rule: RedactionRule::AwsSecret,
            regex: regex!(
                r#"(?i)\baws_?(?:secret_?(?:access_?)?key|session_?token)["']?\s*[:=]\s*["']?(?P<value>[A-Za-z0-9/+=]{20,})"#
            ),
            mask: Mask::Group("value"),
        },
        Pattern {
            rule: RedactionRule::DopplerToken,
            regex: regex!(r"\bdp\.(?:st|pt|ct|sa|scim)\.[A-Za-z0-9_.-]{20,}"),
            mask: Mask::Whole,
        },
        Pattern {
            rule: RedactionRule::Jwt,
            // Header and payload are base64url JSON objects, so both start
            // with `eyJ` (`{"`).
            regex: regex!(r"\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}"),
            mask: Mask::Whole,
        },
        Pattern {
            rule: RedactionRule::BearerToken,
            regex: regex!(r"(?i)\bbearer\s+(?P<value>[A-Za-z0-9\-._~+/]{16,}=*)"),
            mask: Mask::Group("value"),
        },
        Pattern {
            rule: RedactionRule::UrlCredential,
            regex: regex!(r"(?i)\b[a-z][a-z0-9+.-]*://[^\s:/@\[\]]+:(?P<value>[^\s/@\[\]]+)@"),
            mask: Mask::Group("value"),
        },
        Pattern {
            rule: RedactionRule::PasswordAssignment,
            // `password=x`, `client_secret = "x"`, YAML or prose
            // `password: x`, and JSON `"password": "x"`. An unquoted value
            // does not take a sentence's closing period; `name::` (a path)
            // is not an assignment.
            regex: regex!(
                r#"(?i)(?:\b(?:password|passwd|pwd|[a-z0-9_]*secret)\s*[=:]\s*["']?(?P<value>[^\s"'`,;&\[\]().:](?:[^\s"'`,;&\[\]()]*[^\s"'`,;&\[\]().:])?)|"(?:password|passwd|pwd|[a-z0-9_]*secret)"\s*:\s*"(?P<quoted>[^"\[\]][^"]*)")"#
            ),
            mask: Mask::Group("value"),
        },
    ]
});

/// Digit runs that could be a card number: 13-19 contiguous digits, or
/// 4-4-4-4 / 4-6-5 groups split by a space or dash, not touching other word
/// characters (so hex SHAs and ids never match).
fn card_candidates() -> &'static Regex {
    regex!(r"\b(?:\d{13,19}|\d{4}(?:[ -]\d{4}){3}|\d{4}[ -]\d{6}[ -]\d{5})\b")
}

/// Redacts every string inside `value`, and numbers that are card numbers
/// (object keys are left alone).
pub fn redact_json(value: &mut Value, hits: &mut RedactionHits) {
    match value {
        Value::Number(number) => {
            let is_card = number
                .as_u64()
                .is_some_and(|digits| is_card_number(&digits.to_string()));
            if is_card {
                hits.add(RedactionRule::CardNumber);
                *value = Value::String(RedactionRule::CardNumber.mask());
            }
        }
        Value::String(text) => {
            if let Cow::Owned(redacted) = redact_text(text, hits) {
                *text = redacted;
            }
        }
        Value::Array(items) => {
            for item in items {
                redact_json(item, hits);
            }
        }
        Value::Object(map) => {
            for item in map.values_mut() {
                redact_json(item, hits);
            }
        }
        Value::Null | Value::Bool(_) => {}
    }
}

/// `text` with every secret masked; borrowed when nothing matched.
pub fn redact_text<'a>(text: &'a str, hits: &mut RedactionHits) -> Cow<'a, str> {
    let mut current = Cow::Borrowed(text);

    for pattern in PATTERNS.iter() {
        if !pattern.regex.is_match(&current) {
            continue;
        }
        let replaced = pattern
            .regex
            .replace_all(&current, |captures: &Captures| {
                if names_a_type(pattern, captures) {
                    return captures.get(0).map_or("", |m| m.as_str()).to_owned();
                }
                hits.add(pattern.rule);
                masked(pattern, captures)
            })
            .into_owned();
        current = Cow::Owned(replaced);
    }

    if card_candidates().is_match(&current) {
        let replaced = card_candidates()
            .replace_all(&current, |captures: &Captures| {
                let candidate = captures.get(0).map_or("", |m| m.as_str());
                if is_card_number(candidate) {
                    hits.add(RedactionRule::CardNumber);
                    RedactionRule::CardNumber.mask()
                } else {
                    candidate.to_owned()
                }
            })
            .into_owned();
        if replaced != current {
            current = Cow::Owned(replaced);
        }
    }

    current
}

/// Type names that follow `password:` in code (`password: string;`), which
/// are not secrets.
const TYPE_NAMES: &[&str] = &[
    "any",
    "bool",
    "boolean",
    "null",
    "number",
    "option",
    "str",
    "string",
    "undefined",
    "unknown",
];

/// Whether an assignment match is a type annotation rather than a value.
fn names_a_type(pattern: &Pattern, captures: &Captures) -> bool {
    pattern.rule == RedactionRule::PasswordAssignment
        && captures.name("value").is_some_and(|value| {
            // `&str`, `Option<String>`: the type before any reference or
            // generic arguments.
            let value = value.as_str().trim_start_matches('&');
            let value = value.split('<').next().unwrap_or(value);
            TYPE_NAMES
                .iter()
                .any(|name| value.eq_ignore_ascii_case(name))
        })
}

/// The match with its secret part replaced by the rule's mask.
fn masked(pattern: &Pattern, captures: &Captures) -> String {
    let whole = captures.get(0).map_or("", |m| m.as_str());
    let Mask::Group(group) = pattern.mask else {
        return pattern.rule.mask();
    };

    // The assignment rule has two alternatives, each with its own group.
    let secret = captures.name(group).or_else(|| captures.name("quoted"));
    let Some(secret) = secret else {
        return pattern.rule.mask();
    };
    let start = secret.start() - captures.get(0).map_or(0, |m| m.start());
    let end = start + secret.len();
    format!(
        "{}{}{}",
        whole.get(..start).unwrap_or(""),
        pattern.rule.mask(),
        whole.get(end..).unwrap_or("")
    )
}

/// A card network prefix (Visa, Mastercard, Amex, Discover, JCB, Diners) and
/// a valid Luhn checksum. The prefix check keeps millisecond and nanosecond
/// timestamps, which start with `1`, from matching.
fn is_card_number(candidate: &str) -> bool {
    let digits: Vec<u32> = candidate.chars().filter_map(|c| c.to_digit(10)).collect();
    if !(13..=19).contains(&digits.len()) {
        return false;
    }

    let prefix2 = digits.iter().take(2).fold(0, |acc, d| acc * 10 + d);
    let prefix4 = digits.iter().take(4).fold(0, |acc, d| acc * 10 + d);
    let network = digits.first() == Some(&4)
        || (51..=55).contains(&prefix2)
        || (2221..=2720).contains(&prefix4)
        || prefix2 == 34
        || prefix2 == 37
        || prefix2 == 36
        || prefix2 == 38
        || prefix2 == 65
        || prefix4 == 6011
        || (3528..=3589).contains(&prefix4);
    network && luhn_valid(&digits)
}

fn luhn_valid(digits: &[u32]) -> bool {
    let sum: u32 = digits
        .iter()
        .rev()
        .enumerate()
        .map(|(index, digit)| {
            if index % 2 == 1 {
                let doubled = digit * 2;
                if doubled > 9 { doubled - 9 } else { doubled }
            } else {
                *digit
            }
        })
        .sum();
    sum.is_multiple_of(10)
}
