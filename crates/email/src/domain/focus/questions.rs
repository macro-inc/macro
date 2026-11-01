//! The yes/no questions Jev answers about every thread.
//!
//! The wording was tested against four months of real signal mail; change it
//! only together with a re-run of that comparison. Each question stays under
//! Jev's 500-character limit.

/// One Focus question. [`FocusQuestion::ALL`] fixes the order answers come back in.
///
/// The questions name no role or line of work: the owner's profile, which Jev
/// reads as `recipient`, says what matters to them.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FocusQuestion {
    /// Would the owner want this in a short Focus inbox?
    Focus,
    /// Is it unsolicited outreach from a stranger?
    Outreach,
    /// Is it automated, bulk or templated mail?
    Automated,
    /// Is it a customer, client or user asking for help or giving feedback?
    Customer,
    /// Is it only a calendar invite, update or RSVP?
    CalendarRsvp,
    /// Does it ask for a decision only the owner can make?
    NeedsDecision,
    /// Does the latest message ask the owner something unanswered?
    NeedsResponse,
    /// Is there an open loop the owner should come back to?
    NeedsFollowUp,
}

impl FocusQuestion {
    /// Every question, in the order Jev is asked and answers.
    pub const ALL: [Self; 8] = [
        Self::Focus,
        Self::Outreach,
        Self::Automated,
        Self::Customer,
        Self::CalendarRsvp,
        Self::NeedsDecision,
        Self::NeedsResponse,
        Self::NeedsFollowUp,
    ];

    /// The question as Jev reads it.
    pub const fn text(self) -> &'static str {
        match self {
            Self::Focus => {
                "Would the recipient described in `recipient` want this email in a short Focus inbox that \
                 holds only mail that genuinely matters to them: from people they work with or already \
                 know, warm introductions, customers, clients or users of their work, or anything needing \
                 their decision or action? Answer no for unsolicited outreach, bulk or automated mail, and \
                 anything they would skip."
            }
            Self::Outreach => {
                "Is this unsolicited outreach from someone with no existing relationship with the \
                 recipient: a pitch for a product, service, investment, media, event or partnership, \
                 recruiting, or a job application, even if it is written to look personal?"
            }
            Self::Automated => {
                "Is this automated, bulk or templated mail (newsletter, product announcement, marketing, \
                 notification, receipt, digest, AI meeting notes, or system alert) rather than a message \
                 a person wrote specifically to the recipient?"
            }
            Self::Customer => {
                "Is this from a customer, client or user of the recipient's organization, product or \
                 service asking for help, reporting a problem, or giving feedback?"
            }
            Self::CalendarRsvp => {
                "Is this only a calendar invitation, invitation update, or RSVP notice (accepted, \
                 declined, tentative) with no other personal message?"
            }
            Self::NeedsDecision => {
                "Does this ask the recipient for a decision, approval, signature, payment or answer that \
                 only they can give, within an existing business or working relationship?"
            }
            Self::NeedsResponse => {
                "Looking at the latest message in the thread: does it ask the recipient a direct question \
                 or make a request that expects a written reply from them personally, which they have not \
                 answered yet in this thread? Answer no for mass emails, unsolicited outreach, FYI \
                 updates, automated notices, calendar notices, and threads where their own message is the \
                 latest one."
            }
            Self::NeedsFollowUp => {
                "Is there an open loop on this thread that the recipient should track and come back to \
                 later: something they promised to do or send, a pending decision, deadline, payment, \
                 signature or scheduled next step, or a question they asked that the other side has not \
                 answered yet? Answer no if the thread is resolved, or it is unsolicited outreach, a mass \
                 email, or an automated notice."
            }
        }
    }
}

/// Every question's text, in [`FocusQuestion::ALL`] order.
pub const FOCUS_QUESTIONS: [&str; FocusQuestion::ALL.len()] = {
    let mut texts = [""; FocusQuestion::ALL.len()];
    let mut index = 0;
    while index < FocusQuestion::ALL.len() {
        texts[index] = FocusQuestion::ALL[index].text();
        index += 1;
    }
    texts
};

#[cfg(test)]
mod test;
