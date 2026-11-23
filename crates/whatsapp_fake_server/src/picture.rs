//! Profile pictures of users and groups: the `w:profile:picture` IQ and the
//! `picture` notifications WhatsApp sends when one changes. Images are
//! served by the media host at `/pps/{file}` with their content type.

use whatsmeow::binary::Node;
use whatsmeow::types::{GROUP_SERVER, Jid};

use crate::FakeWhatsApp;
use crate::stanza::{attr_jid, attr_string, children, jid, node, now, random_id, text};
use crate::state::{DeviceAddress, State, iq_error, iq_result};

/// Whose picture: a user by phone number, or a group by id.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub(crate) enum PictureTarget {
    Person(String),
    Group(String),
}

pub(crate) struct Picture {
    pub(crate) id: String,
    /// Key of the image in [`State::picture_files`].
    pub(crate) file: String,
    /// The privacy setting refuses everyone else (401).
    pub(crate) hidden: bool,
}

impl State {
    fn picture_target(&self, target: &Jid) -> Option<PictureTarget> {
        if target.server == GROUP_SERVER {
            return Some(PictureTarget::Group(target.user.clone()));
        }
        self.phone_of(target).map(PictureTarget::Person)
    }

    /// Answers `<iq xmlns="w:profile:picture" target=…><picture type id?/>`:
    /// 304 (no `<picture>`) for the id the client already has, 401 when
    /// hidden, 404 when unset, 429 while picture queries are rate limited.
    pub(crate) fn profile_picture(&mut self, from: &DeviceAddress, iq: &Node) -> Node {
        self.picture_queries += 1;
        if self.pictures_rate_limited {
            return iq_error(iq, 429, "rate-overlimit");
        }
        let existing = attr_string(iq.get_child_by_tag(&["picture"]), "id");
        let picture = attr_jid(iq, "target")
            .and_then(|target| self.picture_target(&target))
            .and_then(|target| self.pictures.get(&target).map(|picture| (target, picture)));
        let Some((target, picture)) = picture else {
            return iq_error(iq, 404, "item-not-found");
        };
        let own = target == PictureTarget::Person(from.phone.clone());
        if picture.hidden && !own {
            return iq_error(iq, 401, "not-authorized");
        }
        if picture.id == existing {
            return iq_result(iq, vec![]);
        }
        let direct_path = format!("/pps/{}", picture.file);
        iq_result(
            iq,
            vec![node(
                "picture",
                vec![
                    ("id", text(&picture.id)),
                    ("type", text("preview")),
                    ("direct_path", text(&direct_path)),
                    (
                        "url",
                        text(format!("http://{}{direct_path}", self.media_host)),
                    ),
                ],
                None,
            )],
        )
    }

    /// Sends `<notification type="picture"><set|delete jid id?/>` to the
    /// devices of everyone who shares a group with the target (a group's
    /// members, for a group), the target's own devices excepted.
    fn notify_picture(&mut self, target: &Jid, change: Node) {
        let subject = self.picture_target(target);
        let mut phones: Vec<String> = self
            .groups
            .values()
            .filter(|group| match &subject {
                Some(PictureTarget::Group(id)) => &group.id == id,
                Some(PictureTarget::Person(phone)) => group.members.contains(phone),
                None => false,
            })
            .flat_map(|group| group.members.iter().cloned())
            .filter(|phone| subject != Some(PictureTarget::Person(phone.clone())))
            .collect();
        phones.sort();
        phones.dedup();
        let notification = node(
            "notification",
            vec![
                ("from", jid(target)),
                ("id", text(random_id())),
                ("t", now()),
                ("type", text("picture")),
            ],
            children(vec![change]),
        );
        let targets: Vec<DeviceAddress> = phones
            .iter()
            .filter_map(|phone| self.users.get(phone))
            .flat_map(|user| {
                user.devices.keys().map(|device| DeviceAddress {
                    phone: user.phone.clone(),
                    device: *device,
                })
            })
            .collect();
        for address in targets {
            self.deliver(&address, notification.clone());
        }
    }
}

impl FakeWhatsApp {
    /// Sets a user's (by phone-number or LID JID) or group's picture to an
    /// image of this type, notifies who can see it, and returns its new id.
    pub fn set_picture(&self, target: &Jid, bytes: Vec<u8>, mime: &str) -> String {
        let mut state = self.shared.lock();
        let Some(key) = state.picture_target(target) else {
            return String::new();
        };
        let id = state.number().to_string();
        let file = random_id();
        state
            .picture_files
            .insert(file.clone(), (mime.to_owned(), bytes));
        let hidden = state
            .pictures
            .get(&key)
            .is_some_and(|picture| picture.hidden);
        state.pictures.insert(
            key,
            Picture {
                id: id.clone(),
                file,
                hidden,
            },
        );
        let change = node("set", vec![("jid", jid(target)), ("id", text(&id))], None);
        state.notify_picture(target, change);
        drop(state);
        self.shared.changed();
        id
    }

    /// Hides a picture from everyone but its owner (WhatsApp's "My contacts"
    /// or "Nobody" privacy setting), or shows it again. No notification.
    pub fn hide_picture(&self, target: &Jid, hidden: bool) {
        let mut state = self.shared.lock();
        if let Some(key) = state.picture_target(target)
            && let Some(picture) = state.pictures.get_mut(&key)
        {
            picture.hidden = hidden;
        }
        drop(state);
        self.shared.changed();
    }

    /// Removes a picture and notifies who could see it.
    pub fn remove_picture(&self, target: &Jid) {
        let mut state = self.shared.lock();
        if let Some(key) = state.picture_target(target)
            && state.pictures.remove(&key).is_some()
        {
            state.notify_picture(target, node("delete", vec![("jid", jid(target))], None));
        }
        drop(state);
        self.shared.changed();
    }

    /// While on, every picture query is answered 429 (`rate-overlimit`).
    pub fn rate_limit_pictures(&self, limited: bool) {
        self.shared.lock().pictures_rate_limited = limited;
        self.shared.changed();
    }

    /// Picture queries answered so far, rate-limited ones included.
    pub fn picture_queries(&self) -> usize {
        self.shared.lock().picture_queries
    }
}
