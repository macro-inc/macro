use super::*;

#[test]
fn booking_links_require_a_reply_to_the_proposal_in_chat_and_sessions() {
    for instructions in [INSTRUCTIONS, SESSION_INSTRUCTIONS] {
        for rule in [
            "Booking links use conversational confirmation",
            "never ask for IDs, revisions or JSON",
            "Ask whether to proceed, and end the turn",
            "Only after the user's reply approving",
            "`userConfirmation`",
            "Do not quote the original request or invent approval",
            "Do not use `AskUser` or an elicitation",
            "re-read and reconfirm",
        ] {
            assert!(instructions.contains(rule), "Missing booking rule: {rule}");
        }
    }
}
