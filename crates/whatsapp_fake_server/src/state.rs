//! The server's world: users and their devices, groups, connections, and
//! how stanzas are routed between devices.
//!
//! Everything here is synchronous and runs under one lock; connections and
//! phones hand nodes in and get nodes queued for delivery.

use std::collections::{BTreeMap, HashMap, VecDeque};

use tokio::sync::{mpsc, oneshot};
use whatsmeow::binary::{AttributeValue, Node, NodeContent};
use whatsmeow::types::{DEFAULT_USER_SERVER, GROUP_SERVER, HIDDEN_USER_SERVER, Jid, SERVER_JID};
use whatsmeow::util::keys::KeyPair;

use crate::stanza::{attr_jid, attr_string, bytes, children, jid, node, now, text};

/// A user's device, by phone number and device number.
#[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub(crate) struct DeviceAddress {
    pub(crate) phone: String,
    pub(crate) device: u16,
}

/// What a connection's writer task should do next.
#[derive(Debug)]
pub(crate) enum Outbound {
    /// Encrypt and send a node.
    Node(Node),
    /// Close the websocket.
    Close,
}

/// The keys a device uploaded, for prekey bundles.
#[derive(Clone, Debug)]
pub(crate) struct DeviceKeys {
    pub(crate) registration_id: u32,
    pub(crate) identity: [u8; 32],
    pub(crate) signed_pre_key: (u32, [u8; 32], [u8; 64]),
    pub(crate) pre_keys: VecDeque<(u32, [u8; 32])>,
}

pub(crate) enum DeviceKind {
    /// The user's phone, played in process by a [`crate::FakePhone`]; nodes
    /// for it go to its inbox.
    Phone(mpsc::UnboundedSender<Node>),
    /// A linked device: a real client that connects over the websocket.
    Linked { noise_key: [u8; 32] },
}

pub(crate) struct DeviceRecord {
    pub(crate) kind: DeviceKind,
    pub(crate) keys: Option<DeviceKeys>,
    /// The connection the device is logged in on.
    pub(crate) connection: Option<u64>,
    /// Nodes waiting for the device to log in.
    pub(crate) offline: VecDeque<Node>,
    /// Messages sent on the current connection that the device hasn't
    /// acked yet; they go back to `offline` if the connection drops.
    pub(crate) unacked: Vec<(String, Node)>,
}

pub(crate) struct User {
    pub(crate) phone: String,
    pub(crate) lid: String,
    pub(crate) push_name: String,
    /// The account key: the phone's identity key, which signs linked devices.
    pub(crate) account: KeyPair,
    pub(crate) devices: BTreeMap<u16, DeviceRecord>,
    pub(crate) next_device: u16,
}

pub(crate) struct Group {
    pub(crate) id: String,
    pub(crate) subject: String,
    pub(crate) creator: String,
    pub(crate) created: u64,
    /// Members by phone number, in join order.
    pub(crate) members: Vec<String>,
}

/// A connection that is pairing a new device.
pub(crate) struct Pairing {
    pub(crate) refs: Vec<String>,
}

pub(crate) struct ConnectionEntry {
    pub(crate) outbound: mpsc::UnboundedSender<Outbound>,
    pub(crate) device: Option<DeviceAddress>,
    pub(crate) pairing: Option<Pairing>,
}

/// A pair-success the server sent, waiting for the client to sign it.
pub(crate) struct PendingPair {
    pub(crate) connection: u64,
    pub(crate) address: DeviceAddress,
    pub(crate) noise_key: [u8; 32],
    pub(crate) identity_key: [u8; 32],
    pub(crate) account_public: [u8; 32],
    pub(crate) details: Vec<u8>,
    pub(crate) reply: oneshot::Sender<Result<Jid, crate::PairError>>,
}

#[derive(Default)]
pub(crate) struct State {
    pub(crate) users: BTreeMap<String, User>,
    /// LID user → phone number.
    pub(crate) lids: HashMap<String, String>,
    pub(crate) groups: BTreeMap<String, Group>,
    pub(crate) connections: HashMap<u64, ConnectionEntry>,
    /// Pairing ref → connection.
    pub(crate) pairing_refs: HashMap<String, u64>,
    /// Pair-success IQ ID → the pairing waiting for the client.
    pub(crate) pending_pairs: HashMap<String, PendingPair>,
    pub(crate) next_connection: u64,
    pub(crate) next_number: u64,
    /// Uploaded media by path.
    pub(crate) media: HashMap<String, Vec<u8>>,
    /// Every message stanza delivered to a linked device, as (device, id).
    pub(crate) delivered: Vec<(DeviceAddress, String)>,
    /// `host:port` of the media HTTP server.
    pub(crate) media_host: String,
    /// Every message stanza a linked device submitted, as (device, id).
    pub(crate) submitted: Vec<(DeviceAddress, String)>,
    /// Devices whose submitted messages are routed but never acked.
    pub(crate) withheld_acks: std::collections::HashSet<DeviceAddress>,
}

/// A device JID in the phone-number or LID domain.
pub(crate) fn device_jid(user: &str, device: u16, lid: bool) -> Jid {
    Jid {
        user: user.to_owned(),
        raw_agent: 0,
        device,
        integrator: 0,
        server: if lid {
            HIDDEN_USER_SERVER
        } else {
            DEFAULT_USER_SERVER
        }
        .to_owned(),
    }
}

/// A group JID.
pub(crate) fn group_jid(id: &str) -> Jid {
    Jid {
        user: id.to_owned(),
        server: GROUP_SERVER.to_owned(),
        ..Jid::default()
    }
}

impl State {
    /// A fresh number for LIDs and group IDs.
    pub(crate) fn number(&mut self) -> u64 {
        self.next_number += 1;
        self.next_number
    }

    /// The phone number of a user JID in either domain.
    pub(crate) fn phone_of(&self, user: &Jid) -> Option<String> {
        match user.server.as_str() {
            DEFAULT_USER_SERVER => self
                .users
                .contains_key(&user.user)
                .then(|| user.user.clone()),
            HIDDEN_USER_SERVER => self.lids.get(&user.user).cloned(),
            _ => None,
        }
    }

    /// The device a device JID in either domain names.
    pub(crate) fn resolve(&self, device: &Jid) -> Option<DeviceAddress> {
        let phone = self.phone_of(device)?;
        self.users
            .get(&phone)?
            .devices
            .contains_key(&device.device)
            .then_some(DeviceAddress {
                phone,
                device: device.device,
            })
    }

    /// The device's JID in the given domain.
    pub(crate) fn jid_of(&self, address: &DeviceAddress, lid: bool) -> Jid {
        match (lid, self.users.get(&address.phone)) {
            (true, Some(user)) => device_jid(&user.lid, address.device, true),
            _ => device_jid(&address.phone, address.device, false),
        }
    }

    pub(crate) fn device_mut(&mut self, address: &DeviceAddress) -> Option<&mut DeviceRecord> {
        self.users
            .get_mut(&address.phone)?
            .devices
            .get_mut(&address.device)
    }

    pub(crate) fn device(&self, address: &DeviceAddress) -> Option<&DeviceRecord> {
        self.users.get(&address.phone)?.devices.get(&address.device)
    }

    /// Sends a node on a connection.
    pub(crate) fn send(&self, connection: u64, node: Node) {
        if let Some(entry) = self.connections.get(&connection) {
            let _ = entry.outbound.send(Outbound::Node(node));
        }
    }

    /// Closes a connection's websocket.
    pub(crate) fn close(&self, connection: u64) {
        if let Some(entry) = self.connections.get(&connection) {
            let _ = entry.outbound.send(Outbound::Close);
        }
    }

    /// Delivers a node to a device: a phone gets it now, a linked device on
    /// its connection, or when it next logs in.
    pub(crate) fn deliver(&mut self, target: &DeviceAddress, node: Node) {
        let Some(device) = self.device_mut(target) else {
            return;
        };
        match &device.kind {
            DeviceKind::Phone(inbox) => {
                let _ = inbox.send(node);
            }
            DeviceKind::Linked { .. } => match device.connection {
                Some(connection) => {
                    if node.tag == "message" {
                        device
                            .unacked
                            .push((attr_string(&node, "id"), node.clone()));
                        self.delivered
                            .push((target.clone(), attr_string(&node, "id")));
                    }
                    self.send(connection, node);
                }
                None => device.offline.push_back(node),
            },
        }
    }

    /// A device acked (or receipted) a message.
    pub(crate) fn acked(&mut self, address: &DeviceAddress, id: &str) {
        if let Some(device) = self.device_mut(address) {
            device.unacked.retain(|(unacked, _)| unacked != id);
        }
    }

    /// Detaches a device from its connection; unacked messages are queued
    /// again, ahead of anything queued since.
    pub(crate) fn detach(&mut self, address: &DeviceAddress) {
        if let Some(device) = self.device_mut(address) {
            device.connection = None;
            for (_, node) in device.unacked.drain(..).rev() {
                device.offline.push_front(node);
            }
        }
    }

    /// The group node of a group info or list response.
    pub(crate) fn group_node(&self, group: &Group) -> Node {
        let participants = group
            .members
            .iter()
            .filter_map(|phone| self.users.get(phone))
            .map(|user| {
                let mut attrs = vec![
                    ("jid", jid(&device_jid(&user.lid, 0, true))),
                    ("phone_number", jid(&device_jid(&user.phone, 0, false))),
                ];
                if user.phone == group.creator {
                    attrs.push(("type", text("superadmin")));
                }
                node("participant", attrs, None)
            })
            .collect();
        let creator_lid = self
            .users
            .get(&group.creator)
            .map(|user| device_jid(&user.lid, 0, true))
            .unwrap_or_default();
        node(
            "group",
            vec![
                ("id", text(&group.id)),
                ("subject", text(&group.subject)),
                ("s_t", text(group.created.to_string())),
                ("s_o", jid(&creator_lid)),
                ("creation", text(group.created.to_string())),
                ("creator", jid(&creator_lid)),
                ("creator_pn", jid(&device_jid(&group.creator, 0, false))),
                ("addressing_mode", text("lid")),
                ("size", text(group.members.len().to_string())),
            ],
            children(participants),
        )
    }

    /// Routes a `<message>` stanza a device sent. Returns the server ack for
    /// the sender.
    pub(crate) fn route_message(&mut self, sender: &DeviceAddress, stanza: &Node) -> Node {
        let id = attr_string(stanza, "id");
        let to = attr_jid(stanza, "to").unwrap_or_default();
        let timestamp = now();
        let ack = node(
            "ack",
            vec![
                ("class", text("message")),
                ("id", text(&id)),
                ("from", jid(&to)),
                ("t", timestamp.clone()),
            ],
            None,
        );
        let push_name = self
            .users
            .get(&sender.phone)
            .map(|user| user.push_name.clone())
            .unwrap_or_default();
        let direct: Vec<(Jid, Node)> = stanza
            .get_optional_child_by_tag(&["participants"])
            .map(|participants| {
                participants
                    .get_children()
                    .iter()
                    .filter(|child| child.tag == "to")
                    .filter_map(|child| {
                        let target = attr_jid(child, "jid")?;
                        let enc = child.get_optional_child_by_tag(&["enc"])?.clone();
                        Some((target, enc))
                    })
                    .collect()
            })
            .unwrap_or_default();
        let device_identity = stanza
            .get_optional_child_by_tag(&["device-identity"])
            .cloned();
        let with_identity = |mut content: Vec<Node>| {
            let pre_key = content
                .iter()
                .any(|enc| attr_string(enc, "type") == "pkmsg");
            if pre_key && let Some(identity) = &device_identity {
                content.push(identity.clone());
            }
            content
        };
        let message_type = attr_string(stanza, "type");

        if to.server == GROUP_SERVER {
            let Some(group) = self.groups.get(&to.user) else {
                return with_error(ack, 404);
            };
            if !group.members.contains(&sender.phone) {
                return with_error(ack, 403);
            }
            let sender_key = stanza
                .get_children()
                .iter()
                .find(|child| child.tag == "enc" && attr_string(child, "type") == "skmsg")
                .cloned();
            let mut targets = Vec::new();
            for member in &group.members {
                if let Some(user) = self.users.get(member) {
                    for device in user.devices.keys() {
                        targets.push(DeviceAddress {
                            phone: member.clone(),
                            device: *device,
                        });
                    }
                }
            }
            let participant = self.jid_of(sender, true);
            let participant_pn = device_jid(&sender.phone, 0, false);
            for target in targets.into_iter().filter(|target| target != sender) {
                let mut content: Vec<Node> = direct
                    .iter()
                    .filter(|(jid, _)| self.resolve(jid).as_ref() == Some(&target))
                    .map(|(_, enc)| enc.clone())
                    .collect();
                content = with_identity(content);
                content.extend(sender_key.clone());
                if content.is_empty() {
                    continue;
                }
                let delivery = node(
                    "message",
                    vec![
                        ("from", jid(&to)),
                        ("participant", jid(&participant)),
                        ("participant_pn", jid(&participant_pn)),
                        ("addressing_mode", text("lid")),
                        ("id", text(&id)),
                        ("t", timestamp.clone()),
                        ("type", text(&message_type)),
                        ("notify", text(&push_name)),
                    ],
                    children(content),
                );
                self.deliver(&target, delivery);
            }
            return ack;
        }

        let Some(_) = self.phone_of(&to) else {
            return with_error(ack, 404);
        };
        for (target_jid, enc) in direct {
            let Some(target) = self.resolve(&target_jid) else {
                continue;
            };
            if &target == sender {
                continue;
            }
            let lid = target_jid.server == HIDDEN_USER_SERVER;
            let from = self.jid_of(sender, lid);
            let mut attrs = vec![
                ("from", jid(&from)),
                ("id", text(&id)),
                ("t", timestamp.clone()),
                ("type", text(&message_type)),
                ("notify", text(&push_name)),
            ];
            if target.phone == sender.phone {
                attrs.push(("recipient", jid(&to)));
                if let Some(pn) = stanza.attrs.get("peer_recipient_pn") {
                    attrs.push(("peer_recipient_pn", pn.clone()));
                }
            } else if lid {
                attrs.push(("sender_pn", jid(&device_jid(&sender.phone, 0, false))));
            } else if let Some(user) = self.users.get(&sender.phone) {
                attrs.push(("sender_lid", jid(&device_jid(&user.lid, 0, true))));
            }
            let delivery = node("message", attrs, children(with_identity(vec![enc])));
            self.deliver(&target, delivery);
        }
        ack
    }

    /// Routes a `<receipt>` a device sent to the device it is about.
    pub(crate) fn route_receipt(&mut self, sender: &DeviceAddress, receipt: &Node) {
        let Some(to) = attr_jid(receipt, "to") else {
            return;
        };
        let (target, from, participant) = if to.server == GROUP_SERVER {
            let Some(target) = attr_jid(receipt, "participant").and_then(|jid| self.resolve(&jid))
            else {
                return;
            };
            (target, to.clone(), Some(self.jid_of(sender, true)))
        } else {
            let Some(target) = self.resolve(&to) else {
                return;
            };
            let lid = to.server == HIDDEN_USER_SERVER;
            (target, self.jid_of(sender, lid), None)
        };
        let mut attrs = vec![
            ("from", jid(&from)),
            ("id", text(attr_string(receipt, "id"))),
            ("t", now()),
        ];
        if let Some(participant) = &participant {
            attrs.push(("participant", jid(participant)));
        }
        let receipt_type = attr_string(receipt, "type");
        if !receipt_type.is_empty() {
            attrs.push(("type", text(receipt_type)));
        }
        if let Some(recipient) = receipt.attrs.get("recipient") {
            attrs.push(("recipient", recipient.clone()));
        }
        let content = receipt.content.clone();
        let mut delivery = node("receipt", attrs, None);
        delivery.content = content;
        self.deliver(&target, delivery);
    }

    /// Answers an IQ from a logged-in device.
    pub(crate) fn handle_iq(&mut self, from: &DeviceAddress, iq: &Node) -> Node {
        let xmlns = attr_string(iq, "xmlns");
        let iq_type = attr_string(iq, "type");
        let first_child = iq.get_children().first().map(|child| child.tag.clone());
        match (xmlns.as_str(), iq_type.as_str(), first_child.as_deref()) {
            ("encrypt", "get", Some("count")) => {
                let count = self
                    .device(from)
                    .and_then(|device| device.keys.as_ref())
                    .map_or(0, |keys| keys.pre_keys.len());
                iq_result(
                    iq,
                    vec![node(
                        "count",
                        vec![("value", text(count.to_string()))],
                        None,
                    )],
                )
            }
            ("encrypt", "set", _) => match parse_upload(iq) {
                Some(uploaded) => {
                    if let Some(device) = self.device_mut(from) {
                        match &mut device.keys {
                            Some(keys) if keys.identity == uploaded.identity => {
                                keys.registration_id = uploaded.registration_id;
                                keys.signed_pre_key = uploaded.signed_pre_key;
                                keys.pre_keys.extend(uploaded.pre_keys);
                            }
                            keys => *keys = Some(uploaded),
                        }
                    }
                    iq_result(iq, vec![])
                }
                None => iq_error(iq, 400, "bad-request"),
            },
            ("encrypt", "get", Some("key")) => {
                let users = iq
                    .get_child_by_tag(&["key"])
                    .get_children()
                    .iter()
                    .filter_map(|user| attr_jid(user, "jid"))
                    .map(|target| self.pre_key_bundle_node(&target))
                    .collect();
                iq_result(iq, vec![node("list", vec![], children(users))])
            }
            ("usync", "get", _) => self.usync(iq),
            ("w:g2", "get", Some("query")) => {
                let group = attr_jid(iq, "to")
                    .and_then(|to| self.groups.get(&to.user))
                    .filter(|group| group.members.contains(&from.phone));
                match group {
                    Some(group) => iq_result(iq, vec![self.group_node(group)]),
                    None => iq_error(iq, 404, "item-not-found"),
                }
            }
            ("w:g2", "get", Some("participating")) => {
                let groups = self
                    .groups
                    .values()
                    .filter(|group| group.members.contains(&from.phone))
                    .map(|group| self.group_node(group))
                    .collect();
                iq_result(iq, vec![node("groups", vec![], children(groups))])
            }
            ("w:m", "set", Some("media_conn")) => iq_result(
                iq,
                vec![node(
                    "media_conn",
                    vec![
                        ("auth", text("fake-media-auth")),
                        ("ttl", text("300")),
                        ("auth_ttl", text("21600")),
                        ("max_buckets", text("12")),
                    ],
                    children(vec![node(
                        "host",
                        vec![("hostname", text(&self.media_host))],
                        None,
                    )]),
                )],
            ),
            _ => iq_result(iq, vec![]),
        }
    }

    /// `<user>` with a prekey bundle, consuming one one-time prekey.
    pub(crate) fn pre_key_bundle_node(&mut self, target: &Jid) -> Node {
        let address = self.resolve(target);
        let keys = address
            .as_ref()
            .and_then(|address| self.device_mut(address))
            .and_then(|device| device.keys.as_mut());
        let Some(keys) = keys else {
            return node(
                "user",
                vec![("jid", jid(target))],
                children(vec![node(
                    "error",
                    vec![("code", text("404")), ("text", text("item-not-found"))],
                    None,
                )]),
            );
        };
        let mut content = vec![
            node(
                "registration",
                vec![],
                bytes(keys.registration_id.to_be_bytes()),
            ),
            node("type", vec![], bytes([whatsmeow::signal::DJB_TYPE])),
            node("identity", vec![], bytes(keys.identity)),
        ];
        let (signed_id, signed_public, signature) = keys.signed_pre_key;
        content.push(node(
            "skey",
            vec![],
            children(vec![
                node("id", vec![], bytes(&signed_id.to_be_bytes()[1..])),
                node("value", vec![], bytes(signed_public)),
                node("signature", vec![], bytes(signature)),
            ]),
        ));
        if let Some((id, public)) = keys.pre_keys.pop_front() {
            content.push(node(
                "key",
                vec![],
                children(vec![
                    node("id", vec![], bytes(&id.to_be_bytes()[1..])),
                    node("value", vec![], bytes(public)),
                ]),
            ));
        }
        node("user", vec![("jid", jid(target))], children(content))
    }

    fn usync(&self, iq: &Node) -> Node {
        let usync = iq.get_child_by_tag(&["usync"]);
        let query: Vec<String> = usync
            .get_child_by_tag(&["query"])
            .get_children()
            .iter()
            .map(|child| child.tag.clone())
            .collect();
        let users = usync
            .get_child_by_tag(&["list"])
            .get_children()
            .iter()
            .filter_map(|user| {
                let requested = attr_jid(user, "jid")?;
                let phone = self.phone_of(&requested)?;
                let record = self.users.get(&phone)?;
                let lid = requested.server == HIDDEN_USER_SERVER;
                let mut content = Vec::new();
                for tag in &query {
                    match tag.as_str() {
                        "devices" => {
                            let devices = record
                                .devices
                                .keys()
                                .map(|device| {
                                    let mut attrs = vec![("id", text(device.to_string()))];
                                    if *device != 0 {
                                        attrs.push(("key-index", text(device.to_string())));
                                    }
                                    node("device", attrs, None)
                                })
                                .collect();
                            content.push(node(
                                "devices",
                                vec![],
                                children(vec![
                                    node("device-list", vec![], children(devices)),
                                    node("key-index-list", vec![("ts", now())], None),
                                ]),
                            ));
                        }
                        "lid" => content.push(node(
                            "lid",
                            vec![("val", jid(&device_jid(&record.lid, 0, true)))],
                            None,
                        )),
                        "contact" => {
                            content.push(node("contact", vec![("type", text("in"))], None));
                        }
                        other => content.push(node(other, vec![], None)),
                    }
                }
                let user_jid = device_jid(if lid { &record.lid } else { &record.phone }, 0, lid);
                Some(node(
                    "user",
                    vec![("jid", jid(&user_jid))],
                    children(content),
                ))
            })
            .collect();
        let mut attrs = vec![];
        for key in ["sid", "mode", "context", "index", "last"] {
            if let Some(value) = usync.attrs.get(key) {
                attrs.push((key, value.clone()));
            }
        }
        iq_result(
            iq,
            vec![node(
                "usync",
                attrs,
                children(vec![node("list", vec![], children(users))]),
            )],
        )
    }
}

fn with_error(mut ack: Node, code: u16) -> Node {
    ack.attrs
        .insert("error".to_owned(), AttributeValue::String(code.to_string()));
    ack
}

/// An `<iq type="result">` answering a request.
pub(crate) fn iq_result(request: &Node, content: Vec<Node>) -> Node {
    let mut attrs = vec![("type", text("result")), ("from", jid(&SERVER_JID))];
    if let Some(to) = attr_jid(request, "to")
        && to != *SERVER_JID
    {
        attrs[1] = ("from", jid(&to));
    }
    if let Some(id) = request.attrs.get("id") {
        attrs.push(("id", id.clone()));
    }
    let content = (!content.is_empty()).then_some(NodeContent::Nodes(content));
    node("iq", attrs, content)
}

/// An `<iq type="error">` answering a request.
pub(crate) fn iq_error(request: &Node, code: u16, message: &str) -> Node {
    let mut response = iq_result(request, vec![]);
    response.attrs.insert("type".to_owned(), text("error"));
    response.content = children(vec![node(
        "error",
        vec![("code", text(code.to_string())), ("text", text(message))],
        None,
    )]);
    response
}

fn parse_upload(iq: &Node) -> Option<DeviceKeys> {
    use crate::stanza::child_bytes;
    let registration_id = u32::from_be_bytes(child_bytes(iq, "registration")?.try_into().ok()?);
    let identity: [u8; 32] = child_bytes(iq, "identity")?.try_into().ok()?;
    let signed =
        whatsmeow::prekeys::node_to_pre_key(iq.get_optional_child_by_tag(&["skey"])?).ok()?;
    let pre_keys = iq
        .get_optional_child_by_tag(&["list"])?
        .get_children()
        .iter()
        .filter_map(|key| whatsmeow::prekeys::node_to_pre_key(key).ok())
        .map(|key| (key.key_id, key.public))
        .collect();
    Some(DeviceKeys {
        registration_id,
        identity,
        signed_pre_key: (signed.key_id, signed.public, signed.signature?),
        pre_keys,
    })
}
