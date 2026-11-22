//! The one table of what each caller may do per category. `test.rs` pins
//! every cell as one literal grid built from every caller and category, so
//! neither can be added without deciding its row and column.

#[cfg(test)]
mod test;

use std::sync::Arc;

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
    Clone,
    Copy,
    Debug,
    PartialEq,
    Eq,
    serde::Serialize,
    utoipa::ToSchema,
    strum::Display,
    strum::IntoStaticStr,
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
    /// Macro couldn't tell who sent the request.
    NoCaller,
}

impl Refusal {
    /// What the caller is told.
    pub fn message(&self) -> String {
        let action = self.category.action();
        match self.code {
            RefusalCode::InternalOnly => format!("Only Macro's own services can {action}."),
            RefusalCode::NoCaller => NO_CALLER_MESSAGE.to_owned(),
            RefusalCode::OutOfScope => format!("This session can't {action}."),
            RefusalCode::SignInRequired => format!(
                "This credential can't {action}. The person must sign in to Macro and do it there."
            ),
            RefusalCode::PersonOnly => {
                let (subject, owner) = match self.caller {
                    Caller::AccountManager => ("An account manager", "the account holder"),
                    Caller::Bot => ("A bot", "the person"),
                    Caller::Harness => ("An agent on a computer", "the person"),
                    Caller::Person
                    | Caller::ApiCredential
                    | Caller::Program
                    | Caller::ScopedNoSend
                    | Caller::ScopedGeneration
                    | Caller::ScopedDryRun
                    | Caller::ScopedUnknown
                    | Caller::ChannelMention
                    | Caller::Internal => ("An agent's program", "the person"),
                };
                format!("{subject} can't {action}. Ask {owner} to do it themselves in Macro.")
            }
        }
    }
}

/// What a request whose caller can't be told is answered.
pub const NO_CALLER_MESSAGE: &str =
    "Macro couldn't tell who sent this request. Sign in and try again.";

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
            Caller::ScopedNoSend | Caller::ChannelMention => {
                (!matches!(category, C::Read | C::Suggest | C::Write | C::Public))
                    .then_some(RefusalCode::OutOfScope)
            }
            Caller::ScopedGeneration => (!matches!(category, C::Read | C::Suggest | C::Public))
                .then_some(RefusalCode::OutOfScope),
            Caller::ScopedDryRun | Caller::ScopedUnknown => {
                (!matches!(category, C::Read | C::Public)).then_some(RefusalCode::OutOfScope)
            }
        }
    };
    let Some(code) = code else {
        return Ok(());
    };
    let enforced_from_the_start =
        caller.is_program() && (PERSON_ONLY.contains(&category) || category == C::Internal);
    let enforcement = if enforced_from_the_start {
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

/// The caller a service resolved for a request, put in its extensions
/// before routing.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ResolvedCaller(pub Caller);

/// The rollout a service applies, put in a request's extensions beside its
/// [`ResolvedCaller`]. With none, observed refusals stay observed.
#[derive(Clone)]
pub struct ActiveRollout(pub Arc<dyn Rollout>);

/// Which categories' observed refusals the rollout enforces for a caller:
/// the rollout flag, applied wherever a route is decided.
pub trait Rollout: Send + Sync {
    /// The categories whose observed refusals are enforced for `caller`.
    fn enforced(&self, caller: Caller) -> CategorySet;
}

/// The rollout before any flag: observed refusals stay observed.
#[derive(Clone, Copy, Debug, Default)]
pub struct NoRollout;

impl Rollout for NoRollout {
    fn enforced(&self, _caller: Caller) -> CategorySet {
        CategorySet::default()
    }
}

/// A set of categories.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct CategorySet(u32);

/// A set holds one bit per category.
const _: () = assert!(<Category as strum::EnumCount>::COUNT <= u32::BITS as usize);

impl CategorySet {
    /// The set with `category` added.
    #[must_use]
    pub fn with(self, category: Category) -> Self {
        Self(self.0 | Self::bit(category))
    }

    /// Whether the set holds `category`.
    pub fn contains(self, category: Category) -> bool {
        self.0 & Self::bit(category) != 0
    }

    fn bit(category: Category) -> u32 {
        1 << category as u32
    }
}

/// What the route policy did with one request: kept in its extensions for
/// the authorization extractors, and in the response's for the request span.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RouteDecision {
    /// The route's declared category.
    pub category: Category,
    /// What was decided.
    pub verdict: Verdict,
}

/// What the route policy decided for a request.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Verdict {
    /// The service resolved no caller on a route that needs one: refused, the
    /// handler doesn't run.
    Unresolved,
    /// A route that takes no caller: a public route, or a CORS preflight.
    Public,
    /// The caller may make the request.
    Allowed(Caller),
    /// Refused; the handler doesn't run.
    Refused(Refusal),
    /// Would be refused; the request goes on while the refusal is observed.
    Observed(Refusal),
}

impl RouteDecision {
    /// The decision for a request to a route of `category` from `caller`,
    /// with the categories `rollout` enforces for it. `safe_method` says
    /// whether the request's method only reads (`GET`, `HEAD`, `OPTIONS`).
    pub fn new(
        caller: Option<Caller>,
        category: Category,
        safe_method: bool,
        method_is_preflight: bool,
        rollout: &dyn Rollout,
    ) -> Self {
        let verdict = match caller {
            None if category == Category::Public => Verdict::Public,
            // A CORS preflight carries no credentials by design, so it is
            // never refused for having no caller; it reads nothing.
            None if method_is_preflight => Verdict::Public,
            None => Verdict::Unresolved,
            // An unknown scope reads by method only, as its scope is held in
            // `agent_correlation`: a POST is refused even on a read route.
            Some(Caller::ScopedUnknown) if !safe_method && category != Category::Public => {
                Verdict::Refused(Refusal {
                    code: RefusalCode::OutOfScope,
                    category,
                    caller: Caller::ScopedUnknown,
                    enforcement: Enforcement::Enforced,
                })
            }
            Some(caller) => match decide(caller, category) {
                Ok(()) => Verdict::Allowed(caller),
                Err(refusal)
                    if refusal.enforcement == Enforcement::Enforced
                        || rollout.enforced(caller).contains(category) =>
                {
                    Verdict::Refused(Refusal {
                        enforcement: Enforcement::Enforced,
                        ..refusal
                    })
                }
                Err(refusal) => Verdict::Observed(refusal),
            },
        };
        Self { category, verdict }
    }
}

/// The decision a request's route is held to, shared between the route policy
/// layer and the extractors that decide again once they know more (an account
/// manager's key is told apart only after its lookup). The layer reads it back
/// after the handler runs, so the response and the request span describe the
/// decision that refused the request, not the first one.
#[derive(Clone, Debug)]
pub struct DecisionSlot(std::sync::Arc<std::sync::Mutex<RouteDecision>>);

impl DecisionSlot {
    /// A slot holding `decision`.
    pub fn new(decision: RouteDecision) -> Self {
        Self(std::sync::Arc::new(std::sync::Mutex::new(decision)))
    }

    /// The decision now held.
    pub fn get(&self) -> RouteDecision {
        *self
            .0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    /// Replace the decision held.
    pub fn set(&self, decision: RouteDecision) {
        *self
            .0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = decision;
    }
}

impl Verdict {
    /// Who called, when resolved.
    pub fn caller(self) -> Option<Caller> {
        match self {
            Self::Unresolved | Self::Public => None,
            Self::Allowed(caller) => Some(caller),
            Self::Refused(refusal) | Self::Observed(refusal) => Some(refusal.caller),
        }
    }

    /// Its name in span fields.
    pub fn name(self) -> &'static str {
        match self {
            Self::Unresolved => "unresolved",
            Self::Public => "public",
            Self::Allowed(_) => "allowed",
            Self::Refused(_) => "refused",
            Self::Observed(_) => "observed",
        }
    }
}
