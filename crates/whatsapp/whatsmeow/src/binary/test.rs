// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

//! whatsmeow has no tests for the binary package. The expected bytes and XML
//! strings below were produced by whatsmeow's Go code at the pinned revision
//! (`binary.Marshal` and `Node.String`), so these tests check the port
//! against the original byte for byte.

use super::*;
use crate::types::{
    DEFAULT_USER_SERVER, GROUP_SERVER, HIDDEN_USER_SERVER, HOSTED_LID_SERVER, HOSTED_SERVER,
    INTEROP_SERVER, Jid, MESSENGER_SERVER, SERVER_JID, new_jid,
};

fn hex_bytes(text: &str) -> Vec<u8> {
    hex::decode(text).expect("test vectors are valid hex")
}

fn node_with_attribute(tag: &str, key: &str, value: AttributeValue) -> Node {
    Node {
        tag: tag.to_owned(),
        attrs: Attrs::from([(key.to_owned(), value)]),
        content: None,
    }
}

#[test]
fn marshal_matches_go_for_attribute_encodings() {
    let cases = [
        (
            Node {
                tag: "iq".to_owned(),
                ..Node::default()
            },
            "00f80119",
        ),
        (
            node_with_attribute("iq", "type", "result".into()),
            "00f803190414",
        ),
        (
            node_with_attribute("receipt", "class", "read-self".into()),
            "00f8030715ec00",
        ),
        (
            node_with_attribute("iq", "id", "1234-56.789".into()),
            "00f8031908ff861234a56b789f",
        ),
        (
            node_with_attribute("iq", "id", "123".into()),
            "00f8031908ff82123f",
        ),
        (
            node_with_attribute("iq", "id", "3EB0ABCDEF12".into()),
            "00f8031908fb063eb0abcdef12",
        ),
        (
            node_with_attribute("iq", "id", "hello world".into()),
            "00f8031908fc0b68656c6c6f20776f726c64",
        ),
        (
            node_with_attribute("iq", "t", 1_700_000_000_i64.into()),
            "00f803191aff051700000000",
        ),
        (
            node_with_attribute("iq", "x", true.into()),
            "00f80319fc01789b",
        ),
        (node_with_attribute("iq", "x", "".into()), "00f80119"),
        (
            Node {
                tag: "frobnicate".to_owned(),
                ..Node::default()
            },
            "00f801fc0a66726f626e6963617465",
        ),
        (
            Node {
                tag: "0".to_owned(),
                ..Node::default()
            },
            "00f800",
        ),
    ];
    for (node, expected) in cases {
        assert_eq!(hex::encode(marshal(&node).unwrap()), expected, "{node}");
    }
}

#[test]
fn marshal_matches_go_for_jid_encodings() {
    let cases = [
        (
            new_jid("1234567890", DEFAULT_USER_SERVER),
            "00f8031311faff05123456789003",
        ),
        (SERVER_JID.clone(), "00f8031911fa0003"),
        (
            Jid {
                user: "1234567890".to_owned(),
                device: 12,
                server: DEFAULT_USER_SERVER.to_owned(),
                ..Jid::default()
            },
            "00f8031311f7000cff051234567890",
        ),
        (
            Jid {
                user: "98765432101234".to_owned(),
                device: 3,
                server: HIDDEN_USER_SERVER.to_owned(),
                ..Jid::default()
            },
            "00f8031311f70103ff0798765432101234",
        ),
        (
            Jid {
                user: "1234567890".to_owned(),
                device: 99,
                server: HOSTED_SERVER.to_owned(),
                ..Jid::default()
            },
            "00f8031311f78063ff051234567890",
        ),
        (
            Jid {
                user: "98765432101234".to_owned(),
                device: 99,
                server: HOSTED_LID_SERVER.to_owned(),
                ..Jid::default()
            },
            "00f8031311f78163ff0798765432101234",
        ),
        (
            new_jid("98765432101234", HIDDEN_USER_SERVER),
            "00f8031311faff079876543210123476",
        ),
        (
            Jid {
                user: "100001234567890".to_owned(),
                device: 7,
                server: MESSENGER_SERVER.to_owned(),
                ..Jid::default()
            },
            "00f8031311f6ff88100001234567890f0007cc",
        ),
        (
            Jid {
                user: "1234567890".to_owned(),
                device: 2,
                integrator: 300,
                server: INTEROP_SERVER.to_owned(),
                ..Jid::default()
            },
            "00f8031311f5ff0512345678900002012cfc07696e7465726f70",
        ),
        (
            new_jid("120363012345678901", GROUP_SERVER),
            "00f8031311faff091203630123456789011c",
        ),
    ];
    for (jid, expected) in cases {
        let tag = if jid == *SERVER_JID { "iq" } else { "message" };
        let node = node_with_attribute(tag, "to", jid.clone().into());
        let encoded = marshal(&node).unwrap();
        assert_eq!(hex::encode(&encoded), expected, "{jid}");
        assert_eq!(unmarshal(&encoded[1..]).unwrap(), node, "{jid}");
    }
}

#[test]
fn marshal_matches_go_for_content_encodings() {
    let cases = [
        (
            Node {
                tag: "enc".to_owned(),
                attrs: Attrs::new(),
                content: Some(NodeContent::Bytes(vec![0, 1, 2, 3, 0xff])),
            },
            "00f8021dfc0500010203ff",
        ),
        (
            Node {
                tag: "body".to_owned(),
                attrs: Attrs::new(),
                content: Some(NodeContent::String("plain text".to_owned())),
            },
            "00f802ed75fc0a706c61696e2074657874",
        ),
        (
            Node {
                tag: "body".to_owned(),
                attrs: Attrs::new(),
                content: Some(NodeContent::String("notification".to_owned())),
            },
            "00f802ed7509",
        ),
        (
            Node {
                tag: "body".to_owned(),
                attrs: Attrs::new(),
                content: Some(NodeContent::Jid(new_jid("1234567890", DEFAULT_USER_SERVER))),
            },
            "00f802ed75faff05123456789003",
        ),
        (
            Node {
                tag: "iq".to_owned(),
                attrs: Attrs::from([("id".to_owned(), "abc".into())]),
                content: Some(NodeContent::Nodes(vec![
                    Node {
                        tag: "ping".to_owned(),
                        ..Node::default()
                    },
                    Node {
                        tag: "list".to_owned(),
                        attrs: Attrs::new(),
                        content: Some(NodeContent::Nodes(vec![Node {
                            tag: "user".to_owned(),
                            attrs: Attrs::from([(
                                "jid".to_owned(),
                                new_jid("1234567890", DEFAULT_USER_SERVER).into(),
                            )]),
                            content: None,
                        }])),
                    },
                ])),
            },
            "00f8041908fc03616263f802f80156f80271f801f8030e0cfaff05123456789003",
        ),
        (
            Node {
                tag: "iq".to_owned(),
                attrs: Attrs::new(),
                content: Some(NodeContent::Nodes(Vec::new())),
            },
            "00f8021900",
        ),
    ];
    for (node, expected) in cases {
        assert_eq!(hex::encode(marshal(&node).unwrap()), expected, "{node}");
    }
}

#[test]
fn marshal_matches_go_for_length_prefixes() {
    let bytes_300 = marshal(&Node {
        tag: "enc".to_owned(),
        attrs: Attrs::new(),
        content: Some(NodeContent::Bytes(vec![0xab; 300])),
    })
    .unwrap();
    assert_eq!(hex::encode(&bytes_300[..8]), "00f8021dfd00012c");
    assert_eq!(bytes_300.len(), 8 + 300);

    let bytes_70000 = marshal(&Node {
        tag: "enc".to_owned(),
        attrs: Attrs::new(),
        content: Some(NodeContent::Bytes(vec![1; 70_000])),
    })
    .unwrap();
    assert_eq!(hex::encode(&bytes_70000[..12]), "00f8021dfd01117001010101");

    let bytes_1_mebibyte = marshal(&Node {
        tag: "enc".to_owned(),
        attrs: Attrs::new(),
        content: Some(NodeContent::Bytes(vec![1; 1 << 20])),
    })
    .unwrap();
    assert_eq!(
        hex::encode(&bytes_1_mebibyte[..12]),
        "00f8021dfe00100000010101"
    );

    let list_300 = marshal(&Node {
        tag: "list".to_owned(),
        attrs: Attrs::new(),
        content: Some(NodeContent::Nodes(vec![
            Node {
                tag: "item".to_owned(),
                ..Node::default()
            };
            300
        ])),
    })
    .unwrap();
    assert_eq!(hex::encode(&list_300[..12]), "00f80271f9012cf8013ff801");
}

#[test]
fn marshal_rejects_lists_go_would_truncate() {
    let node = Node {
        tag: "list".to_owned(),
        attrs: Attrs::new(),
        content: Some(NodeContent::Nodes(vec![Node::default(); 70_000])),
    };
    assert_eq!(marshal(&node), Err(EncodeError::ListTooLarge(70_000)));

    let device_too_large = node_with_attribute(
        "message",
        "to",
        Jid {
            user: "1".to_owned(),
            device: 300,
            server: DEFAULT_USER_SERVER.to_owned(),
            ..Jid::default()
        }
        .into(),
    );
    assert_eq!(
        marshal(&device_too_large),
        Err(EncodeError::DeviceOutOfRange(300))
    );
}

#[test]
fn unmarshal_decodes_go_encodings() {
    let decoded = unmarshal(&hex_bytes(
        "f8041908fc03616263f802f80156f80271f801f8030e0cfaff05123456789003",
    ))
    .unwrap();
    assert_eq!(
        decoded,
        Node {
            tag: "iq".to_owned(),
            attrs: Attrs::from([("id".to_owned(), "abc".into())]),
            content: Some(NodeContent::Nodes(vec![
                Node {
                    tag: "ping".to_owned(),
                    ..Node::default()
                },
                Node {
                    tag: "list".to_owned(),
                    attrs: Attrs::new(),
                    content: Some(NodeContent::Nodes(vec![Node {
                        tag: "user".to_owned(),
                        attrs: Attrs::from([(
                            "jid".to_owned(),
                            new_jid("1234567890", DEFAULT_USER_SERVER).into(),
                        )]),
                        content: None,
                    }])),
                },
            ])),
        }
    );

    // Binary content decodes as bytes even when it was encoded from a string,
    // and packed or token content decodes as a string.
    assert_eq!(
        unmarshal(&hex_bytes("f802ed75fc0a706c61696e2074657874"))
            .unwrap()
            .content,
        Some(NodeContent::Bytes(b"plain text".to_vec()))
    );
    assert_eq!(
        unmarshal(&hex_bytes("f802ed7509")).unwrap().content,
        Some(NodeContent::String("notification".to_owned()))
    );
    assert_eq!(
        unmarshal(&hex_bytes("f8031908ff82123f")).unwrap().attrs,
        Attrs::from([("id".to_owned(), "123".into())])
    );
    assert_eq!(
        unmarshal(&hex_bytes("f8031908fb063eb0abcdef12"))
            .unwrap()
            .attrs,
        Attrs::from([("id".to_owned(), "3EB0ABCDEF12".into())])
    );
    // The double-byte token "read-self" in dictionary 0.
    assert_eq!(
        unmarshal(&hex_bytes("f8030715ec00")).unwrap(),
        node_with_attribute("receipt", "class", "read-self".into())
    );
}

#[test]
fn unmarshal_rejects_malformed_input() {
    assert_eq!(unmarshal(&[]), Err(DecodeError::UnexpectedEof));
    // A list header promising three items with only the tag present.
    assert_eq!(
        unmarshal(&hex_bytes("f80319")),
        Err(DecodeError::UnexpectedEof)
    );
    assert_eq!(
        unmarshal(&hex_bytes("f80000")),
        Err(DecodeError::InvalidNode)
    );
    assert_eq!(
        unmarshal(&hex_bytes("1900")),
        Err(DecodeError::InvalidListSize {
            tag: 0x19,
            position: 1
        })
    );
    // Tag 240 is between the dictionaries and the JID types.
    assert_eq!(
        unmarshal(&hex_bytes("f801f0")),
        Err(DecodeError::InvalidToken {
            tag: 0xf0,
            position: 3
        })
    );
    // Nibble value 12 has no meaning.
    assert_eq!(
        unmarshal(&hex_bytes("f801ff01c0")),
        Err(DecodeError::InvalidPackedValue {
            tag: token::NIBBLE_8,
            value: 12
        })
    );
    // An attribute key that is a JID.
    assert_eq!(
        unmarshal(&hex_bytes("f80319fa0003fa0003")),
        Err(DecodeError::NonStringKey { position: 6 })
    );
    // A messenger JID whose server isn't "msgr".
    assert!(matches!(
        unmarshal(&hex_bytes(
            "f8031311f6ff81100007 03".replace(' ', "").as_str()
        )),
        Err(DecodeError::InvalidJidType(_))
    ));
    assert_eq!(
        unmarshal(&hex_bytes("f8011900")),
        Err(DecodeError::LeftoverBytes(1))
    );
}

#[test]
fn node_string_matches_go() {
    let iq = Node {
        tag: "iq".to_owned(),
        attrs: Attrs::from([
            ("id".to_owned(), "abc".into()),
            ("type".to_owned(), "get".into()),
            ("to".to_owned(), SERVER_JID.clone().into()),
        ]),
        content: Some(NodeContent::Nodes(vec![Node {
            tag: "ping".to_owned(),
            ..Node::default()
        }])),
    };
    assert_eq!(
        iq.to_string(),
        r#"<iq id="abc" to="s.whatsapp.net" type="get"><ping/></iq>"#
    );
    assert_eq!(
        iq.indented_string(),
        r#"<iq id="abc" to="s.whatsapp.net" type="get"><ping/></iq>"#
    );

    let bytes = |content: Vec<u8>| Node {
        tag: "enc".to_owned(),
        attrs: Attrs::new(),
        content: Some(NodeContent::Bytes(content)),
    };
    assert_eq!(
        bytes(vec![0, 1, 2, 3, 0xff]).to_string(),
        "<enc>00010203ff</enc>"
    );
    assert_eq!(
        bytes(vec![0xab; 200]).to_string(),
        "<enc><!-- 200 bytes --></enc>"
    );
    assert_eq!(
        bytes(b"plain text".to_vec()).to_string(),
        "<enc>plain text</enc>"
    );
    // A newline isn't printable, so the bytes print as hex.
    assert_eq!(
        bytes(b"hello\nworld".to_vec()).to_string(),
        "<enc>68656c6c6f0a776f726c64</enc>"
    );
    assert_eq!(
        bytes(vec![0xab; 100]).indented_string(),
        "<enc>\n  abababababababababababababababababababababababababababababababababababababababab\n  abababababababababababababababababababababababababababababababababababababababab\n  abababababababababababababababababababab\n</enc>"
    );
    assert_eq!(
        Node {
            tag: "body".to_owned(),
            attrs: Attrs::new(),
            content: Some(NodeContent::String("a\nb".to_owned())),
        }
        .to_string(),
        r"<body>a\nb</body>"
    );
    assert_eq!(
        Node {
            tag: "message".to_owned(),
            attrs: Attrs::from([(
                "to".to_owned(),
                Jid {
                    user: "1234567890".to_owned(),
                    device: 2,
                    integrator: 300,
                    server: INTEROP_SERVER.to_owned(),
                    ..Jid::default()
                }
                .into(),
            )]),
            content: None,
        }
        .to_string(),
        r#"<message to="1234567890:2@interop"/>"#
    );
}

#[test]
fn child_lookup_follows_tag_paths() {
    let node = unmarshal(&hex_bytes(
        "f8041908fc03616263f802f80156f80271f801f8030e0cfaff05123456789003",
    ))
    .unwrap();
    assert_eq!(node.get_children().len(), 2);
    assert_eq!(node.get_children_by_tag("ping").count(), 1);
    let user = node.get_optional_child_by_tag(&["list", "user"]).unwrap();
    assert_eq!(
        user.attr_getter().jid("jid"),
        new_jid("1234567890", DEFAULT_USER_SERVER)
    );
    assert_eq!(node.get_optional_child_by_tag(&["list", "nope"]), None);
    assert_eq!(node.get_child_by_tag(&["nope"]), &Node::default());
    assert_eq!(node.get_optional_child_by_tag(&[]), Some(&node));
}

#[test]
fn attr_utility_collects_errors() {
    let node = Node {
        tag: "message".to_owned(),
        attrs: Attrs::from([
            (
                "from".to_owned(),
                new_jid("1234567890", DEFAULT_USER_SERVER).into(),
            ),
            ("t".to_owned(), "1700000000".into()),
            ("ms".to_owned(), "1700000000123".into()),
            ("zero".to_owned(), "0".into()),
            ("offline".to_owned(), "T".into()),
            ("count".to_owned(), "+5".into()),
            ("bad".to_owned(), "maybe".into()),
        ]),
        content: None,
    };
    let mut getter = node.attr_getter();
    assert_eq!(
        getter.jid("from"),
        new_jid("1234567890", DEFAULT_USER_SERVER)
    );
    assert_eq!(
        getter.unix_time("t").map(|time| time.timestamp()),
        Some(1_700_000_000)
    );
    assert_eq!(
        getter.unix_milli("ms").map(|time| time.timestamp_millis()),
        Some(1_700_000_000_123)
    );
    assert_eq!(getter.get_unix_time("zero", true), None);
    assert!(getter.bool("offline"));
    assert_eq!(getter.int("count"), 5);
    assert!(getter.ok());

    assert_eq!(getter.optional_string("missing"), "");
    assert_eq!(getter.optional_jid("missing"), None);
    assert!(getter.ok());

    assert_eq!(getter.uint64("count"), 0);
    assert_eq!(getter.string("from"), "");
    assert_eq!(getter.jid("t"), Jid::default());
    assert!(!getter.optional_bool("bad"));
    assert_eq!(getter.string("missing"), "");
    assert_eq!(getter.jid("missing"), Jid::default());

    let errors = getter.error().unwrap_err();
    assert_eq!(errors.0.len(), 6);
    assert_eq!(
        errors.0[1].to_string(),
        "expected attribute 'from' to be string, but was types.JID"
    );
    assert_eq!(
        errors.0[4].to_string(),
        "didn't find required attribute 'missing'"
    );
    assert_eq!(
        errors.0[5].to_string(),
        "didn't find required JID attribute 'missing'"
    );
}

#[test]
fn unpack_inflates_compressed_payloads() {
    assert_eq!(unpack(&[0, 1, 2, 3]).unwrap(), vec![1, 2, 3]);
    assert_eq!(
        unpack(&hex_bytes(
            "02789c003200cdff77686174736d656f772077686174736d656f772077686174736d656f772077686174736d656f772077686174736d656f77200300044013fc"
        ))
        .unwrap(),
        b"whatsmeow whatsmeow whatsmeow whatsmeow whatsmeow ".to_vec()
    );
    assert_eq!(unpack(&[]), Err(DecodeError::EmptyPayload));
    assert!(matches!(
        unpack(&[2, 1, 2, 3]),
        Err(DecodeError::Decompress(_))
    ));
}

#[test]
fn token_lookups_match_go_tables() {
    assert_eq!(token::index_of_single_token("s.whatsapp.net"), Some(3));
    assert_eq!(token::index_of_single_token(""), None);
    assert_eq!(token::index_of_double_byte_token("read-self"), Some((0, 0)));
    assert_eq!(token::get_double_token(0, 0), Some("read-self"));
    assert_eq!(token::get_double_token(4, 0), None);
    assert_eq!(token::get_double_token(3, 256), None);
}
