use super::*;

const LINK: Uuid = Uuid::from_u128(0x1);

fn removal(deletion_reason: DeletionReason) -> LinkManagerMessage {
    LinkManagerMessage::DeleteLink {
        link_id: LINK,
        deletion_reason,
    }
}

#[test]
fn watch_refreshes_go_to_maintenance() {
    let refresh = LinkManagerMessage::Refresh { link_id: LINK };

    assert_eq!(
        refresh.lane(LinkManagerSender::Sweep),
        LinkManagerLane::Maintenance
    );
}

#[test]
fn the_sweeps_health_polls_go_to_maintenance_and_a_health_check_a_person_asked_for_stays() {
    let probe = LinkManagerMessage::HealthCheck { link_id: LINK };

    assert_eq!(
        probe.lane(LinkManagerSender::Sweep),
        LinkManagerLane::Maintenance
    );
    assert_eq!(
        probe.lane(LinkManagerSender::Event),
        LinkManagerLane::Interactive
    );
}

#[test]
fn removals_go_to_the_lane_of_their_reason_and_the_purge_follows_the_sweep() {
    for (reason, sweep, event) in [
        // The lifecycle publisher sends the purge of a sweep removal as an event.
        (
            DeletionReason::Unused,
            LinkManagerLane::Maintenance,
            LinkManagerLane::Maintenance,
        ),
        (
            DeletionReason::Inactive,
            LinkManagerLane::Maintenance,
            LinkManagerLane::Maintenance,
        ),
        // An ownerless link's purge reads like an account deletion's.
        (
            DeletionReason::UserDeleted,
            LinkManagerLane::Maintenance,
            LinkManagerLane::Interactive,
        ),
        (
            DeletionReason::ManuallyDisabled,
            LinkManagerLane::Interactive,
            LinkManagerLane::Interactive,
        ),
        (
            DeletionReason::AccessRevoked,
            LinkManagerLane::Interactive,
            LinkManagerLane::Interactive,
        ),
    ] {
        assert_eq!(
            removal(reason).lane(LinkManagerSender::Sweep),
            sweep,
            "{reason:?} from the sweep"
        );
        assert_eq!(
            removal(reason).lane(LinkManagerSender::Event),
            event,
            "{reason:?} from an event"
        );
    }
}

#[test]
fn account_deletions_stay_interactive() {
    let deletion = LinkManagerMessage::DeleteUser {
        fusionauth_user_id: "deleted-account".to_string(),
    };

    assert_eq!(
        deletion.lane(LinkManagerSender::Event),
        LinkManagerLane::Interactive
    );
}

#[test]
fn reauth_notices_stay_interactive() {
    let notice = LinkManagerMessage::NotifyReauthRequired { link_id: LINK };

    assert_eq!(
        notice.lane(LinkManagerSender::Event),
        LinkManagerLane::Interactive
    );
}
