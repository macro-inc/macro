use harness_id::HarnessId;
use macro_uuid::Uuid;

use super::{RuntimeBypassFacts, RuntimeBypassOffer, SessionPermissionChoice, offer};

const HARNESS: Uuid = Uuid::from_u128(0x0190_0000_0000_7000_8000_0000_0000_0001);

#[test]
fn an_agent_that_asks_on_a_runtime_that_forbids_bypass_gets_both_changes() {
    assert_eq!(
        offer(
            SessionPermissionChoice::Agent,
            RuntimeBypassFacts {
                harness: HarnessId::new_from_uuid(HARNESS),
                runtime_allows_bypass: false,
                caller_manages_runtime: true,
                agent_auto_accepts: false,
                caller_manages_agent: true,
            },
        ),
        Some(RuntimeBypassOffer {
            harness: HarnessId::new_from_uuid(HARNESS),
            enables_agent_auto_accept: true,
        })
    );
}

#[test]
fn an_agent_already_set_to_bypass_needs_only_the_runtime() {
    assert_eq!(
        offer(
            SessionPermissionChoice::Agent,
            RuntimeBypassFacts {
                harness: HarnessId::new_from_uuid(HARNESS),
                runtime_allows_bypass: false,
                caller_manages_runtime: true,
                agent_auto_accepts: true,
                caller_manages_agent: false,
            },
        ),
        Some(RuntimeBypassOffer {
            harness: HarnessId::new_from_uuid(HARNESS),
            enables_agent_auto_accept: false,
        })
    );
}

#[test]
fn an_agent_that_asks_is_not_offered_to_someone_who_cannot_change_it() {
    assert_eq!(
        offer(
            SessionPermissionChoice::Agent,
            RuntimeBypassFacts {
                harness: HarnessId::new_from_uuid(HARNESS),
                runtime_allows_bypass: false,
                caller_manages_runtime: true,
                agent_auto_accepts: false,
                caller_manages_agent: false,
            },
        ),
        None
    );
}

#[test]
fn a_runtime_the_caller_does_not_manage_is_never_offered() {
    assert_eq!(
        offer(
            SessionPermissionChoice::Agent,
            RuntimeBypassFacts {
                harness: HarnessId::new_from_uuid(HARNESS),
                runtime_allows_bypass: false,
                caller_manages_runtime: false,
                agent_auto_accepts: true,
                caller_manages_agent: true,
            },
        ),
        None
    );
}

#[test]
fn a_runtime_that_already_allows_bypass_is_not_offered() {
    assert_eq!(
        offer(
            SessionPermissionChoice::Agent,
            RuntimeBypassFacts {
                harness: HarnessId::new_from_uuid(HARNESS),
                runtime_allows_bypass: true,
                caller_manages_runtime: true,
                agent_auto_accepts: false,
                caller_manages_agent: true,
            },
        ),
        None
    );
}

#[test]
fn a_conversation_that_adopted_bypass_needs_only_the_runtime() {
    assert_eq!(
        offer(
            SessionPermissionChoice::Pinned { auto_accepts: true },
            RuntimeBypassFacts {
                harness: HarnessId::new_from_uuid(HARNESS),
                runtime_allows_bypass: false,
                caller_manages_runtime: true,
                agent_auto_accepts: false,
                caller_manages_agent: true,
            },
        ),
        Some(RuntimeBypassOffer {
            harness: HarnessId::new_from_uuid(HARNESS),
            enables_agent_auto_accept: false,
        })
    );
}

#[test]
fn a_conversation_that_adopted_asking_keeps_asking_whatever_changes() {
    assert_eq!(
        offer(
            SessionPermissionChoice::Pinned {
                auto_accepts: false
            },
            RuntimeBypassFacts {
                harness: HarnessId::new_from_uuid(HARNESS),
                runtime_allows_bypass: false,
                caller_manages_runtime: true,
                agent_auto_accepts: true,
                caller_manages_agent: true,
            },
        ),
        None
    );
}
