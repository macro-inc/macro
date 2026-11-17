//! The WhatsApp channels DSS and other replicas `NOTIFY`, and the fleet
//! signal each becomes; `session_fleet::listener` listens.

use session_fleet::listener::Channels;
use session_fleet::supervisor::FleetSignal;
use uuid::Uuid;
use whatsapp_linked::signals::{
    ACCOUNT_CHANGED, ACCOUNT_RELEASED, GROUPS_REQUESTED, HISTORY_REQUESTED, LOOKUP_REQUESTED,
    PAIRING_REQUESTED, SEND_REQUESTED,
};

use crate::domain::ports::AccountSignal;

const NAMES: [&str; 7] = [
    ACCOUNT_RELEASED,
    PAIRING_REQUESTED,
    SEND_REQUESTED,
    GROUPS_REQUESTED,
    LOOKUP_REQUESTED,
    HISTORY_REQUESTED,
    ACCOUNT_CHANGED,
];

/// What the WhatsApp fleet listens to.
pub fn channels() -> Channels<AccountSignal> {
    Channels {
        fleet: "whatsapp",
        names: &NAMES,
        parse,
        resync: AccountSignal::Resync,
    }
}

/// Maps one notification to a fleet signal; `None` for unknown channels.
pub fn parse(channel: &str, id: Uuid) -> Option<FleetSignal<AccountSignal>> {
    let account = |signal, take| FleetSignal::Account {
        account: id,
        signal,
        take,
    };
    match channel {
        ACCOUNT_RELEASED => Some(FleetSignal::Released(id)),
        PAIRING_REQUESTED => Some(FleetSignal::Keyed {
            key: id,
            signal: AccountSignal::Pairing(id),
        }),
        SEND_REQUESTED => Some(account(AccountSignal::Send, false)),
        GROUPS_REQUESTED => Some(account(AccountSignal::Groups, false)),
        LOOKUP_REQUESTED => Some(account(AccountSignal::Lookup, false)),
        HISTORY_REQUESTED => Some(account(AccountSignal::History, false)),
        ACCOUNT_CHANGED => Some(account(AccountSignal::Changed, true)),
        _ => None,
    }
}
