//! The yes/no questions Jev answers about every thread.
//!
//! The wording was tested against four months of real signal mail; change it
//! only together with a re-run of that comparison. Each question stays under
//! Jev's 500-character limit.

/// One Focus question. [`FocusQuestion::ALL`] fixes the order answers come back in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FocusQuestion {
    /// Would the owner want this in a short Focus inbox?
    Focus,
    /// Is it an unsolicited pitch from a stranger?
    ColdPitch,
    /// Is it automated, bulk or templated mail?
    Automated,
    /// Is it an unsolicited job application?
    JobApplication,
    /// Is it a customer or user asking for help or giving feedback?
    Customer,
    /// Is it a specific, credible vulnerability report?
    SecurityReport,
    /// Does the mail itself show an existing relationship?
    ExistingRelationship,
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
    pub const ALL: [Self; 11] = [
        Self::Focus,
        Self::ColdPitch,
        Self::Automated,
        Self::JobApplication,
        Self::Customer,
        Self::SecurityReport,
        Self::ExistingRelationship,
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
                 holds only mail that genuinely matters to them: from their team, investors, lawyers, \
                 customers and users, vendors they already work with, people they know, warm \
                 introductions, or anything needing their decision? Answer no for cold pitches, bulk or \
                 automated mail, and anything they would skip."
            }
            Self::ColdPitch => {
                "Is this an unsolicited pitch (selling a product, service, agency, outsourcing, recruiting, \
                 lead generation, investment, media, award, event or partnership) from someone with no \
                 existing relationship with the recipient, even if it is written to look personal?"
            }
            Self::Automated => {
                "Is this automated, bulk or templated mail (newsletter, product announcement, marketing, \
                 notification, receipt, digest, AI meeting notes, or system alert) rather than a message \
                 a person wrote specifically to the recipient?"
            }
            Self::JobApplication => {
                "Is this an unsolicited job application, resume, or request for a job or internship at \
                 the recipient's company?"
            }
            Self::Customer => {
                "Is this from a customer or user of the recipient's company or product asking for help, \
                 reporting a bug or account problem, or giving product feedback?"
            }
            Self::SecurityReport => {
                "Is this a specific, credible report of a security vulnerability in the recipient's \
                 company's own systems, with technical details?"
            }
            Self::ExistingRelationship => {
                "Does the email itself show an existing relationship with the recipient: a reply in a \
                 conversation they took part in, a follow-up to a real meeting, a colleague, investor, \
                 board member, lawyer, an existing vendor or customer, or an introduction from a real \
                 mutual contact?"
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
                 answered yet in this thread? Answer no for mass emails, cold pitches, FYI updates, \
                 automated notices, calendar notices, and threads where their own message is the latest one."
            }
            Self::NeedsFollowUp => {
                "Is there an open loop on this thread that the recipient should track and come back to \
                 later: something they promised to do or send, a pending decision, deadline, payment, \
                 signature or scheduled next step, or a question they asked that the other side has not \
                 answered yet? Answer no if the thread is resolved, or it is a cold pitch, mass email, or \
                 automated notice."
            }
        }
    }
}

/// Every question's text, in [`FocusQuestion::ALL`] order.
pub const FOCUS_QUESTIONS: [&str; 11] = {
    let mut texts = [""; 11];
    let mut index = 0;
    while index < FocusQuestion::ALL.len() {
        texts[index] = FocusQuestion::ALL[index].text();
        index += 1;
    }
    texts
};

#[cfg(test)]
mod test;
