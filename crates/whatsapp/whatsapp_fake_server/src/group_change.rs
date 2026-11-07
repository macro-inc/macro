//! Changes to a group's members and metadata, and the `w:gp2` notifications
//! WhatsApp sends its members' devices about them.

use whatsmeow::binary::Node;
use whatsmeow::types::Jid;

use crate::stanza::{bytes, children, jid, node, now, random_id, text};
use crate::state::{DeviceAddress, State, device_jid};
use crate::{FakePhone, FakeWhatsApp};

/// One change to a group.
pub enum GroupChange<'phone> {
    /// Adds a user to the group.
    Add(&'phone FakePhone),
    /// Removes a user from the group; a user removing themselves left.
    Remove(&'phone FakePhone),
    /// Sets the subject.
    Subject(String),
    /// Sets the description.
    Description(String),
    /// Makes a member an admin.
    Promote(&'phone FakePhone),
    /// Removes a member as admin.
    Demote(&'phone FakePhone),
    /// Turns disappearing messages on with a timer in seconds, or off.
    Disappearing(Option<u32>),
}

impl FakeWhatsApp {
    /// Applies a change to a group and notifies the members' devices (and an
    /// added or removed user's). `by` is who made it, named on the
    /// notification as WhatsApp does; `None` for a change WhatsApp made.
    pub fn change_group(&self, group: &Jid, by: Option<&FakePhone>, change: GroupChange<'_>) {
        let mut state = self.shared.lock();
        let Some(stored) = state.groups.get(&group.user) else {
            return;
        };
        let mut notified = stored.members.clone();
        let mut members = stored.members.clone();
        let mut admins = stored.admins.clone();
        let mut subject = stored.subject.clone();
        let mut description = stored.description.clone();
        let mut disappearing = stored.disappearing;
        let actor = by
            .and_then(|phone| state.users.get(phone.phone()))
            .map(|user| {
                (
                    device_jid(&user.lid, 0, true),
                    device_jid(&user.phone, 0, false),
                )
            });
        let at = now();
        let change = match change {
            GroupChange::Add(phone) => {
                if !members.iter().any(|member| member == phone.phone()) {
                    members.push(phone.phone().to_owned());
                    notified.push(phone.phone().to_owned());
                }
                participants_node("add", &state, phone)
            }
            GroupChange::Remove(phone) => {
                members.retain(|member| member != phone.phone());
                admins.retain(|admin| admin != phone.phone());
                participants_node("remove", &state, phone)
            }
            GroupChange::Subject(new_subject) => {
                let mut attrs = vec![("subject", text(&new_subject)), ("s_t", at.clone())];
                if let Some((lid, phone)) = &actor {
                    attrs.push(("s_o", jid(lid)));
                    attrs.push(("s_o_pn", jid(phone)));
                }
                subject = new_subject;
                node("subject", attrs, None)
            }
            GroupChange::Description(new_description) => {
                let change = node(
                    "description",
                    vec![("id", text(random_id()))],
                    children(vec![node(
                        "body",
                        vec![],
                        bytes(new_description.as_bytes()),
                    )]),
                );
                description = Some(new_description);
                change
            }
            GroupChange::Promote(phone) => {
                admins.push(phone.phone().to_owned());
                participants_node("promote", &state, phone)
            }
            GroupChange::Demote(phone) => {
                admins.retain(|admin| admin != phone.phone());
                participants_node("demote", &state, phone)
            }
            GroupChange::Disappearing(timer) => {
                disappearing = timer.or(disappearing.map(|_| 0));
                match timer {
                    Some(seconds) => node(
                        "ephemeral",
                        vec![("expiration", text(seconds.to_string()))],
                        None,
                    ),
                    None => node("not_ephemeral", vec![], None),
                }
            }
        };
        let mut attrs = vec![
            ("from", jid(group)),
            ("id", text(random_id())),
            ("t", at),
            ("type", text("w:gp2")),
        ];
        if let Some((lid, phone)) = &actor {
            attrs.push(("participant", jid(lid)));
            attrs.push(("participant_pn", jid(phone)));
        }
        let notification = node("notification", attrs, children(vec![change]));
        if let Some(stored) = state.groups.get_mut(&group.user) {
            stored.members = members;
            stored.admins = admins;
            stored.subject = subject;
            stored.description = description;
            stored.disappearing = disappearing;
        }
        let targets: Vec<DeviceAddress> = notified
            .iter()
            .filter_map(|member| state.users.get(member))
            .flat_map(|user| {
                user.devices.keys().map(|device| DeviceAddress {
                    phone: user.phone.clone(),
                    device: *device,
                })
            })
            .collect();
        for target in targets {
            state.deliver(&target, notification.clone());
        }
        drop(state);
        self.shared.changed();
    }

    /// Renames a group, as WhatsApp does without naming who.
    pub fn rename_group(&self, group: &Jid, subject: &str) {
        self.change_group(group, None, GroupChange::Subject(subject.to_owned()));
    }

    /// Removes a phone's user from a group, as WhatsApp does without naming
    /// who.
    pub fn remove_from_group(&self, group: &Jid, phone: &FakePhone) {
        self.change_group(group, None, GroupChange::Remove(phone));
    }
}

/// `<tag><participant jid=LID phone_number=PN/></tag>` for one user.
fn participants_node(tag: &str, state: &State, phone: &FakePhone) -> Node {
    let participant = state
        .users
        .get(phone.phone())
        .map(|user| {
            node(
                "participant",
                vec![
                    ("jid", jid(&device_jid(&user.lid, 0, true))),
                    ("phone_number", jid(&device_jid(&user.phone, 0, false))),
                ],
                None,
            )
        })
        .into_iter()
        .collect();
    node(tag, vec![], children(participant))
}
