use crate::email::ReadEmailParts;

use super::*;

#[test]
fn it_should_parse() {
    let valid_emails = [
        "macro|sean@macro.com",
        "macro|sean+testing.thing@example.gc.ca",
        "macro|###hello###+weird@something-strange.world.tour",
    ];
    let res: Result<Vec<_>, _> = valid_emails
        .iter()
        .copied()
        .map(MacroUserId::parse_from_str)
        .collect();
    res.unwrap();
}

#[test]
fn it_should_fail() {
    let invalid_emails = [
        "macro|sean@macro.com ",
        "macro| sean@macro.com",
        "macro|sean@macro.com\n",
        "macro|\nsean@macro.com",
        "macro|sean..aye@macro.com",
        "macro|sean@@macro.com",
        "schmacro|sean@macro.com",
    ];
    invalid_emails
        .iter()
        .copied()
        .map(MacroUserId::parse_from_str)
        .for_each(|res| {
            res.unwrap_err();
        });
}

#[test]
fn email_works() {
    let id = MacroUserId::parse_from_str("macro|###hello###+weird@something-strange.world.tour")
        .unwrap();

    dbg!(&id);

    assert_eq!(
        id.email_part().email_str(),
        "###hello###+weird@something-strange.world.tour"
    );
}

#[test]
fn domain_part_works() {
    let id = MacroUserId::parse_from_str("macro|###hello###+weird@something-strange.world.tour")
        .unwrap();

    dbg!(&id);

    assert_eq!(
        id.email_part().domain_part(),
        "something-strange.world.tour"
    );
}

#[test]
fn local_part_works() {
    let id = MacroUserId::parse_from_str("macro|###hello###+weird@something-strange.world.tour")
        .unwrap();

    dbg!(&id);

    assert_eq!(id.email_part().local_part(), "###hello###+weird");
}

#[test]
fn casing_matters_for_prefix() {
    let _id = MacroUserId::parse_from_str("macRo|###hello###+weird@something-strange.world.tour")
        .unwrap_err();
}

#[test]
fn casing_ignored_for_email() {
    let id = MacroUserId::parse_from_str("macro|###hello###+WEIRD@something-strange.world.tour")
        .unwrap();

    assert_eq!(id.email_part().local_part(), "###hello###+WEIRD");
}
