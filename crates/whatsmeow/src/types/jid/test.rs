// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

//! whatsmeow has no tests for JIDs. The expected values below were produced
//! by whatsmeow's Go code at the pinned revision.

use super::*;

#[test]
fn parse_jid_matches_go() {
    let cases = [
        ("", "", 0, 0, "", "", ".0:0@", ":0"),
        (
            "s.whatsapp.net",
            "",
            0,
            0,
            "s.whatsapp.net",
            "s.whatsapp.net",
            ".0:0@s.whatsapp.net",
            ":0",
        ),
        (
            "1234567890@s.whatsapp.net",
            "1234567890",
            0,
            0,
            "s.whatsapp.net",
            "1234567890@s.whatsapp.net",
            "1234567890.0:0@s.whatsapp.net",
            "1234567890:0",
        ),
        (
            "1234567890:12@s.whatsapp.net",
            "1234567890",
            0,
            12,
            "s.whatsapp.net",
            "1234567890:12@s.whatsapp.net",
            "1234567890.0:12@s.whatsapp.net",
            "1234567890:12",
        ),
        (
            "1234567890.1:12@s.whatsapp.net",
            "1234567890",
            1,
            12,
            "s.whatsapp.net",
            "1234567890.1:12@s.whatsapp.net",
            "1234567890.1:12@s.whatsapp.net",
            "1234567890:12",
        ),
        (
            "1234567890.1@s.whatsapp.net",
            "1234567890",
            1,
            0,
            "s.whatsapp.net",
            "1234567890.1:0@s.whatsapp.net",
            "1234567890.1:0@s.whatsapp.net",
            "1234567890:0",
        ),
        (
            "98765432101234:3@lid",
            "98765432101234",
            0,
            3,
            "lid",
            "98765432101234:3@lid",
            "98765432101234.0:3@lid",
            "98765432101234_1:3",
        ),
        (
            "status@broadcast",
            "status",
            0,
            0,
            "broadcast",
            "status@broadcast",
            "status.0:0@broadcast",
            "status:0",
        ),
        ("a@b@c", "a", 0, 0, "b", "a@b", "a.0:0@b", "a:0"),
    ];
    for (input, user, agent, device, server, string, ad_string, signal_address) in cases {
        let jid = parse_jid(input).unwrap();
        assert_eq!(jid.user, user, "{input}");
        assert_eq!(jid.raw_agent, agent, "{input}");
        assert_eq!(jid.device, device, "{input}");
        assert_eq!(jid.server, server, "{input}");
        assert_eq!(jid.to_string(), string, "{input}");
        assert_eq!(jid.ad_string(), ad_string, "{input}");
        assert_eq!(jid.signal_address().to_string(), signal_address, "{input}");
    }
}

#[test]
fn parse_jid_errors_match_go() {
    assert_eq!(
        parse_jid("a.b.c@s.whatsapp.net").unwrap_err().to_string(),
        "unexpected number of dots in JID"
    );
    assert_eq!(
        parse_jid("a:b:c@s.whatsapp.net").unwrap_err().to_string(),
        "unexpected number of colons in JID"
    );
    assert_eq!(
        parse_jid("1.2:3:4@s.whatsapp.net").unwrap_err().to_string(),
        "unexpected number of colons in JID"
    );
    assert!(matches!(
        parse_jid("x:y@s.whatsapp.net"),
        Err(JidParseError::InvalidDevice(_))
    ));
    assert!(matches!(
        "1.300@s.whatsapp.net".parse::<Jid>(),
        Err(JidParseError::InvalidDevice(_))
    ));
}

#[test]
fn new_ad_jid_maps_domains_to_servers() {
    let cases = [
        (0, "123:5@s.whatsapp.net", 0, 0, "123:5"),
        (1, "123:5@lid", 0, 1, "123_1:5"),
        (128, "123:5@hosted", 0, 128, "123_128:5"),
        (129, "123:5@hosted.lid", 0, 129, "123_129:5"),
        (7, "123.7:5@s.whatsapp.net", 7, 0, "123:5"),
    ];
    for (domain, string, raw_agent, actual_agent, signal_address) in cases {
        let jid = new_ad_jid("123", domain, 5);
        assert_eq!(jid.to_string(), string);
        assert_eq!(jid.raw_agent, raw_agent);
        assert_eq!(jid.actual_agent(), actual_agent);
        assert_eq!(jid.signal_address().to_string(), signal_address);
    }
}

#[test]
fn is_bot_matches_go() {
    assert!(parse_jid("13135551234@s.whatsapp.net").unwrap().is_bot());
    assert!(parse_jid("13165550012@s.whatsapp.net").unwrap().is_bot());
    assert!(!parse_jid("13135551234:1@s.whatsapp.net").unwrap().is_bot());
    assert!(parse_jid("123@bot").unwrap().is_bot());
    assert!(!parse_jid("1234@s.whatsapp.net").unwrap().is_bot());
}

#[test]
fn helpers_follow_go_semantics() {
    let jid = parse_jid("1234567890.1:12@s.whatsapp.net").unwrap();
    assert_eq!(jid.to_non_ad().to_string(), "1234567890@s.whatsapp.net");
    assert_eq!(jid.user_int(), 1_234_567_890);
    assert_eq!(STATUS_BROADCAST_JID.user_int(), 0);
    assert!(!STATUS_BROADCAST_JID.is_broadcast_list());
    assert!(parse_jid("123@broadcast").unwrap().is_broadcast_list());
    assert!(EMPTY_JID.is_empty());
    assert!(!SERVER_JID.is_empty());
}
