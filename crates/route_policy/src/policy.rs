//! The one table of what each caller may do per category. `test.rs` pins
//! every cell as one literal grid built from every caller and category, so
//! neither can be added without deciding its row and column.

#[cfg(test)]
mod test;

use crate::{Caller, Category};

/// Why `decide` refused a request, for the answer, the logs and the rollout.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Refusal {
    /// The rule that refused.
    pub code: RefusalCode,
    /// The route's category.
    pub category: Category,
    /// Who was refused.
    pub caller: Caller,
    /// Whether the refusal is answered now or only recorded.
    pub enforcement: Enforcement,
}

/// Whether a refusal is answered or only recorded.
#[derive(
    Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, strum::Display, strum::IntoStaticStr,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum Enforcement {
    /// Answered with a refusal; the handler doesn't run.
    Enforced,
    /// Recorded as a would-be refusal; the request goes on. A rollout flag
    /// may enforce it.
    Observed,
}

/// Why a request was refused, as the answer's `code` names it: what has to
/// happen instead.
#[derive(
    Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, strum::Display, strum::IntoStaticStr,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum RefusalCode {
    /// Only the person may do this, in Macro: not a program, a bot, a
    /// computer or another account's manager.
    PersonOnly,
    /// The person may do this signed in to Macro, but not with a credential
    /// held outside it.
    SignInRequired,
    /// The session's scope doesn't include this.
    OutOfScope,
    /// Only another Macro service may call this route.
    InternalOnly,
}

impl Refusal {
    /// What the caller is told.
    pub fn message(&self) -> String {
        let action = self.category.action();
        match self.code {
            RefusalCode::InternalOnly => format!("Only Macro's own services can {action}."),
            RefusalCode::OutOfScope => format!("This session can't {action}."),
            RefusalCode::SignInRequired => format!(
                "This credential can't {action}. The person must sign in to Macro and do it there."
            ),
            RefusalCode::PersonOnly => {
                let (subject, owner) = match self.caller {
                    Caller::AccountManager => ("An account manager", "the account holder"),
                    Caller::Bot => ("A bot", "the person"),
                    Caller::Harness => ("An agent on a computer", "the person"),
                    _ => ("An agent's program", "the person"),
                };
                format!("{subject} can't {action}. Ask {owner} to do it themselves in Macro.")
            }
        }
    }
}

/// What only the person may do: each returns or changes something that
/// outlives the request (a credential, a linked account, who can sign in, a
/// gate a person must decide).
const PERSON_ONLY: &[Category] = &[
    Category::CredentialMint,
    Category::Connect,
    Category::AuthChange,
    Category::ApprovalGate,
];

/// Whether `caller` may make a request to a route of `category`. `Err` names
/// the refusal; an [`Enforcement::Observed`] one lets the request go on.
pub fn decide(caller: Caller, category: Category) -> Result<(), Refusal> {
    use Category as C;
    let code = if category == C::Internal {
        (caller != Caller::Internal).then_some(RefusalCode::InternalOnly)
    } else {
        match caller {
            Caller::Person | Caller::Internal => None,
            Caller::ApiCredential => PERSON_ONLY
                .contains(&category)
                .then_some(RefusalCode::SignInRequired),
            Caller::AccountManager => PERSON_ONLY
                .contains(&category)
                .then_some(RefusalCode::PersonOnly),
            Caller::Bot | Caller::Harness => (PERSON_ONLY.contains(&category)
                || category == C::ShareOutside)
                .then_some(RefusalCode::PersonOnly),
            Caller::Program => (!matches!(
                category,
                C::Read
                    | C::Suggest
                    | C::Write
                    | C::Send
                    | C::Delegate
                    | C::ShareMember
                    | C::Public
            ))
            .then_some(RefusalCode::PersonOnly),
            Caller::ScopedNoSend => {
                (!matches!(category, C::Read | C::Suggest | C::Write | C::Public))
                    .then_some(RefusalCode::OutOfScope)
            }
            Caller::ScopedGeneration => (!matches!(category, C::Read | C::Suggest | C::Public))
                .then_some(RefusalCode::OutOfScope),
            Caller::ScopedUnknown => {
                (!matches!(category, C::Read | C::Public)).then_some(RefusalCode::OutOfScope)
            }
        }
    };
    let Some(code) = code else {
        return Ok(());
    };
    let program = matches!(
        caller,
        Caller::Program
            | Caller::ScopedNoSend
            | Caller::ScopedGeneration
            | Caller::ScopedUnknown
            | Caller::AccountManager
    );
    let enforcement = if program && (PERSON_ONLY.contains(&category) || category == C::Internal) {
        Enforcement::Enforced
    } else {
        Enforcement::Observed
    };
    Err(Refusal {
        code,
        category,
        caller,
        enforcement,
    })
}
