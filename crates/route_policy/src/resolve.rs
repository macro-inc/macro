//! Who sent a request, from what its verified credentials sign.

#[cfg(test)]
mod test;

use crate::Caller;

/// What a request's credentials say about who sent it. Only signed claims
/// and verified credentials go in, except `code_execution`, which only
/// narrows.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CallerEvidence {
    /// The credential the request authenticates with.
    pub authenticated: Authenticated,
    /// Some verified token in the request signs an agent or a routine, or
    /// carries an agent correlation.
    pub program: bool,
    /// The narrowest scope any verified token in the request is held to.
    pub scope: ScopeEvidence,
    /// Some verified token is a channel mention's. No token carries that claim
    /// yet; the mention PR sets it, and a mention never resolves as `Program`.
    pub channel_mention: bool,
    /// The request carries the code-execution header. A program can drop
    /// it, so it may only narrow.
    pub code_execution: bool,
}

/// The credential a request authenticates with.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Authenticated {
    /// Nothing that verifies.
    Nothing,
    /// A person's session token.
    Session,
    /// A Macro API token, or a user API key: a credential the person holds
    /// outside the app. A manager's key is told apart only where it is
    /// looked up.
    ApiCredential,
    /// A bot token.
    Bot,
    /// A harness token.
    Harness,
    /// The internal API key, when no user token rides beside it.
    Internal,
}

/// The narrowest scope a request is held to.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord)]
pub enum ScopeEvidence {
    /// No scope.
    #[default]
    Unscoped,
    /// A run that sends nothing.
    NoSend,
    /// A suggestion generation session.
    Generation,
    /// A routine step's dry run: reads, by declared category.
    DryRun,
    /// A scope this build doesn't know: reads by method only. The narrowest.
    Unknown,
}

impl ScopeEvidence {
    /// The narrower of two scopes.
    #[must_use]
    pub fn narrowest(self, other: Self) -> Self {
        self.max(other)
    }
}

/// Who sent a request, narrowest reading winning: any scope, else any
/// program, else the credential that authenticates. `None` when nothing
/// verifies and nothing is signed.
pub fn resolve_caller(evidence: CallerEvidence) -> Option<Caller> {
    match evidence.scope {
        ScopeEvidence::NoSend => return Some(Caller::ScopedNoSend),
        ScopeEvidence::Generation => return Some(Caller::ScopedGeneration),
        ScopeEvidence::DryRun => return Some(Caller::ScopedDryRun),
        ScopeEvidence::Unknown => return Some(Caller::ScopedUnknown),
        ScopeEvidence::Unscoped => {}
    }

    if evidence.channel_mention {
        return Some(Caller::ChannelMention);
    }

    if evidence.program {
        return Some(Caller::Program);
    }

    let caller = match evidence.authenticated {
        Authenticated::Nothing => return None,
        Authenticated::Session => Caller::Person,
        Authenticated::ApiCredential => Caller::ApiCredential,
        Authenticated::Bot => Caller::Bot,
        Authenticated::Harness => Caller::Harness,
        Authenticated::Internal => Caller::Internal,
    };

    let narrowed_by_header =
        evidence.code_execution && matches!(caller, Caller::Person | Caller::ApiCredential);
    Some(if narrowed_by_header {
        Caller::Program
    } else {
        caller
    })
}
