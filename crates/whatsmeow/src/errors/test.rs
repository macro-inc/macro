// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

//! Error messages reach logs and spans through `#[tracing::instrument(err)]`,
//! so none of them may name a JID, even when the error carries one.

use std::sync::Arc;

use super::*;
use crate::binary::{AttributeValue, Attrs, NodeContent};
use crate::prekeys::node_to_pre_key_bundle;
use crate::store::{LidStore, MemoryStore};
use crate::types::parse_jid;

const USER: &str = "1234:5@s.whatsapp.net";
const LID: &str = "9876:5@lid";
const GROUP: &str = "120363000000000000@g.us";

fn jid(value: &str) -> AttributeValue {
    parse_jid(value).unwrap().into()
}

fn node(tag: &str, attrs: Vec<(&str, AttributeValue)>, children: Vec<Node>) -> Node {
    Node {
        tag: tag.to_owned(),
        attrs: attrs
            .into_iter()
            .map(|(key, value)| (key.to_owned(), value))
            .collect::<Attrs>(),
        content: (!children.is_empty()).then_some(NodeContent::Nodes(children)),
    }
}

/// An IQ response naming a user, a LID and a group, with `error` as its
/// only child when given.
fn response(error: Option<Node>) -> Node {
    node(
        "iq",
        vec![
            ("from", jid(GROUP)),
            ("participant", jid(USER)),
            ("type", AttributeValue::from("error")),
        ],
        error.into_iter().collect(),
    )
}

fn error_node(code: Option<&str>) -> Node {
    let mut attrs = vec![
        ("jid", jid(LID)),
        ("text", AttributeValue::from("forbidden")),
    ];
    if let Some(code) = code {
        attrs.push(("code", AttributeValue::from(code)));
    }
    node(
        "error",
        attrs,
        vec![node("item", vec![("jid", jid(USER))], vec![])],
    )
}

fn assert_no_jid(message: &str) {
    for jid_part in ["@s.whatsapp.net", "@lid", "@g.us", "1234", "9876", "120363"] {
        assert!(!message.contains(jid_part), "{message:?} names a JID");
    }
}

#[tokio::test]
async fn error_messages_never_name_jids() {
    let unknown_iq = parse_iq_error(&response(Some(error_node(None))));
    let coded_iq = parse_iq_error(&response(Some(error_node(Some("403")))));
    let unexpected_iq = IqError {
        raw_node: Some(response(None)),
        ..IqError::default()
    };
    assert_eq!(
        unknown_iq.to_string(),
        "info query returned unknown error: <error>"
    );
    assert_eq!(
        unexpected_iq.to_string(),
        "info query returned unexpected response: <iq>"
    );
    // The detail stays reachable.
    assert!(format!("{unknown_iq:?}").contains("lid"));
    assert!(unknown_iq.raw_node.is_some());

    let store = Arc::new(MemoryStore::default());
    let lid_error = store
        .put_lid_mapping(&parse_jid(USER).unwrap(), &parse_jid(LID).unwrap())
        .await
        .unwrap_err();
    let pn_error = store
        .get_pn_for_lid(&parse_jid(USER).unwrap())
        .await
        .unwrap_err();
    let prekey_error = node_to_pre_key_bundle(
        5,
        &node(
            "user",
            vec![("jid", jid(USER))],
            vec![error_node(Some("406"))],
        ),
    )
    .unwrap_err();

    let errors: Vec<ClientError> = vec![
        unknown_iq.clone().into(),
        coded_iq.into(),
        unexpected_iq.into(),
        ClientError::from(unknown_iq.clone()).wrap("failed to update group participants"),
        wrap_iq_error(
            ClientError::GroupNotFound,
            ClientError::from(unknown_iq.clone()),
        ),
        DisconnectedError {
            action: "info query".to_owned(),
            node: Some(response(None)),
        }
        .into(),
        prekey_error,
        ClientError::Signal(SignalError::Internal(
            rootcause::report!("session with {USER} not found").into_dynamic(),
        )),
        ClientError::Store(StoreError::Internal(
            rootcause::report!("invalid value {LID}").into_dynamic(),
        )),
        ClientError::Store(lid_error).wrap("failed to store LID mapping"),
        ClientError::Store(pn_error),
    ];
    for error in &errors {
        let message = error.to_string();
        assert_no_jid(&message);
        let mut source = std::error::Error::source(error);
        while let Some(inner) = source {
            assert_no_jid(&inner.to_string());
            source = inner.source();
        }
    }
}
