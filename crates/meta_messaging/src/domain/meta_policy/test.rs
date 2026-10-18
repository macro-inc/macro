use super::*;
use crate::domain::models::{DeliveryState, Provenance};

#[test]
fn boundary_is_checked_at_dispatch_and_api_cannot_bypass() {
    let now = DateTime::from_timestamp(1_791_288_000, 0).unwrap();
    let mut window = ReplyWindow {
        provider: Provider::Whatsapp,
        connected: true,
        last_customer_message_at: Some(now - Duration::hours(24)),
        human_agent_approved: false,
    };
    assert_eq!(
        authorize_send(&window, SendAuthority::Human, ReplyMode::FreeForm, now),
        Err(MessagingError::TemplateRequired)
    );
    assert!(
        authorize_send(
            &window,
            SendAuthority::Human,
            ReplyMode::ApprovedTemplate,
            now
        )
        .is_ok()
    );
    window.last_customer_message_at = Some(now - Duration::hours(24) + Duration::seconds(1));
    assert!(authorize_send(&window, SendAuthority::Human, ReplyMode::FreeForm, now).is_ok());
    assert_eq!(
        authorize_send(
            &window,
            SendAuthority::Human,
            ReplyMode::FreeForm,
            now + Duration::seconds(1)
        ),
        Err(MessagingError::TemplateRequired)
    );
    window.connected = false;
    assert_eq!(
        authorize_send(
            &window,
            SendAuthority::Human,
            ReplyMode::ApprovedTemplate,
            now
        ),
        Err(MessagingError::Disconnected)
    );
}

#[test]
fn instagram_human_tag_is_never_an_automation_escape() {
    let now = Utc::now();
    let mut window = ReplyWindow {
        provider: Provider::Instagram,
        connected: true,
        last_customer_message_at: Some(now - Duration::days(2)),
        human_agent_approved: true,
    };
    assert!(authorize_send(&window, SendAuthority::Human, ReplyMode::HumanSupport, now).is_ok());
    assert_eq!(
        authorize_send(
            &window,
            SendAuthority::DraftOnly,
            ReplyMode::HumanSupport,
            now
        ),
        Err(MessagingError::Forbidden)
    );
    window.human_agent_approved = false;
    assert_eq!(
        authorize_send(&window, SendAuthority::Human, ReplyMode::HumanSupport, now),
        Err(MessagingError::HumanSupportRequired)
    );
    window.human_agent_approved = true;
    window.last_customer_message_at = Some(now - Duration::days(7));
    assert_eq!(
        authorize_send(&window, SendAuthority::Human, ReplyMode::HumanSupport, now),
        Err(MessagingError::ReplyWindowClosed)
    );
}

#[test]
fn only_new_customer_provenance_opens_windows() {
    for provenance in [
        Provenance::MacroReply,
        Provenance::PhoneEcho,
        Provenance::OnboardingHistory,
    ] {
        assert!(!provenance.is_new_customer_message());
    }
    assert!(Provenance::Customer.is_new_customer_message());
}

#[test]
fn delivery_reconciliation_preserves_evidence_under_reordering() {
    use DeliveryState::*;
    for state in [
        Pending, Sending, Unknown, Accepted, Sent, Delivered, Read, Failed,
    ] {
        assert_eq!(Read.reconcile(state), Read);
        assert_eq!(state.reconcile(Read), Read);
    }
    assert_eq!(Delivered.reconcile(Failed), Delivered);
    assert_eq!(Failed.reconcile(Delivered), Delivered);
    assert_eq!(Sent.reconcile(Accepted), Sent);
    assert_eq!(Unknown.reconcile(Pending), Unknown);
}
