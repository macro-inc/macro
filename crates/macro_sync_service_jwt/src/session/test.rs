use super::*;
use crate::{ISSUER, decode, encode};
use jsonwebtoken::errors::ErrorKind;
use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

const ID: &str = "0194c5d8-8f00-7000-8000-abcdef012345";
const SECRET: &str = "session-tests-only";

fn now() -> usize {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as usize
}

fn claims() -> SurfaceClaims {
    SurfaceClaims {
        session_kind: SurfaceSessionKind::Surface,
        surface_id: ID.parse().unwrap(),
        user_id: Some("macro|user@example.com".into()),
        access_level: SurfaceAccessLevel::Edit,
        actor: None,
        exp: now() + crate::TOKEN_TTL_SECS,
        iss: ISSUER.into(),
    }
}

// Mirrors the existing document issuer and consumer without backend dependencies.
#[derive(Debug, Serialize, Deserialize, PartialEq, Eq)]
struct LegacyDocumentClaims {
    user_id: Option<String>,
    document_id: String,
    access_level: SurfaceAccessLevel,
    exp: usize,
    iss: String,
}

#[derive(Serialize)]
struct RawSurfaceClaims<'a> {
    #[serde(skip_serializing_if = "Option::is_none")]
    session_kind: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    surface_id: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    document_id: Option<&'a str>,
    access_level: &'a str,
    exp: usize,
    iss: &'a str,
}

fn raw_claims() -> RawSurfaceClaims<'static> {
    RawSurfaceClaims {
        session_kind: Some("surface"),
        surface_id: Some(ID),
        document_id: None,
        access_level: "edit",
        exp: now() + crate::TOKEN_TTL_SECS,
        iss: ISSUER,
    }
}

fn rejects(raw: &RawSurfaceClaims<'_>) {
    let token = encode(raw, SECRET).unwrap();
    assert!(decode_surface(token.as_str(), SECRET).is_err());
}

#[test]
fn identical_uuids_have_distinct_targets_and_storage_keys() {
    let document = SessionIdentity::new(SessionKind::Document, ID).unwrap();
    let surface = SessionIdentity::new(SessionKind::Surface, ID).unwrap();
    assert_ne!(document, surface);
    assert_eq!(document.kind(), SessionKind::Document);
    assert_eq!(surface.kind(), SessionKind::Surface);
    assert_eq!(document.id(), surface.id());
    assert_eq!(document.storage_key(), ID);
    assert_eq!(surface.storage_key(), format!("surface:{ID}"));
}

#[test]
fn surface_keys_are_canonical_but_document_names_are_unchanged() {
    let uppercase = ID.to_ascii_uppercase();
    let surface = SessionIdentity::new(SessionKind::Surface, &uppercase).unwrap();
    assert_eq!(surface.id(), ID);
    assert_eq!(surface.storage_key(), format!("surface:{ID}"));
    let document = SessionIdentity::new(SessionKind::Document, &uppercase).unwrap();
    assert_eq!(document.id(), uppercase);
    assert_eq!(document.storage_key(), uppercase);
    let id: SurfaceId = uppercase.parse().unwrap();
    assert_eq!(id.as_str(), ID);
    assert_eq!(id.to_string(), ID);
}

#[test]
fn malformed_ids_cannot_enter_identities_or_claims() {
    for id in [
        "",
        "not-a-uuid",
        "0194c5d88f0070008000abcdef012345",
        "0194c5d8-8f00-7000-8000-abcdef01234g",
        "0194c5d8_8f00-7000-8000-abcdef012345",
        "0194c5d8-8f00-7000-8000-abcdef012345/ops",
        "surface:0194c5d8-8f00-7000-8000-abcdef012345",
        "{0194c5d8-8f00-7000-8000-abcdef012345}",
        " 0194c5d8-8f00-7000-8000-abcdef012345",
        "0194c5d8-8f00-7000-8000-abcdef01234é",
    ] {
        assert!(id.parse::<SurfaceId>().is_err(), "{id}");
        for kind in [SessionKind::Document, SessionKind::Surface] {
            assert!(SessionIdentity::new(kind, id).is_err(), "{id}");
        }
        let mut raw = raw_claims();
        raw.surface_id = Some(id);
        rejects(&raw);
    }
}

#[test]
fn surface_token_round_trip_has_explicit_kind_and_scoped_id() {
    let expected = claims();
    let token = encode_surface(&expected, SECRET).unwrap();
    let actual = decode_surface(token.as_str(), SECRET).unwrap();
    assert_eq!(actual, expected);
    assert_eq!(
        actual.session_identity(),
        SessionIdentity::new(SessionKind::Surface, ID).unwrap()
    );

    #[derive(Deserialize)]
    struct WireClaims {
        session_kind: SessionKind,
        surface_id: String,
    }
    let wire: WireClaims = decode(token.as_str(), SECRET).unwrap();
    assert_eq!(wire.session_kind, SessionKind::Surface);
    assert_eq!(wire.surface_id, ID);
    assert!(decode::<LegacyDocumentClaims>(token.as_str(), SECRET).is_err());
}

#[test]
fn legacy_document_tokens_remain_compatible_but_are_not_surface_grants() {
    let expected = LegacyDocumentClaims {
        user_id: None,
        document_id: ID.into(),
        access_level: SurfaceAccessLevel::Comment,
        exp: now() + crate::TOKEN_TTL_SECS,
        iss: ISSUER.into(),
    };
    let token = encode(&expected, SECRET).unwrap();
    assert_eq!(
        decode::<LegacyDocumentClaims>(token.as_str(), SECRET).unwrap(),
        expected
    );
    assert!(decode_surface(token.as_str(), SECRET).is_err());
}

#[test]
fn surface_claims_require_surface_kind_and_surface_id() {
    for kind in [None, Some("document"), Some("initiative"), Some("Surface")] {
        let mut raw = raw_claims();
        raw.session_kind = kind;
        rejects(&raw);
    }
    let mut raw = raw_claims();
    raw.surface_id = None;
    rejects(&raw);
    raw.document_id = Some(ID);
    rejects(&raw);
    raw.surface_id = Some(ID);
    rejects(&raw); // Reject ambiguous grants containing both target fields.
}

#[test]
fn unsupported_access_levels_are_rejected() {
    for level in ["admin", "write", "Edit", ""] {
        let mut raw = raw_claims();
        raw.access_level = level;
        rejects(&raw);
    }
    for level in ["view", "comment", "edit", "owner"] {
        let mut raw = raw_claims();
        raw.access_level = level;
        let token = encode(&raw, SECRET).unwrap();
        assert!(decode_surface(token.as_str(), SECRET).is_ok());
    }
}

#[test]
fn expired_surface_tokens_are_rejected_without_default_clock_leeway() {
    let mut expired = claims();
    expired.exp = now() - 1;
    let token = encode_surface(&expired, SECRET).unwrap();
    assert_eq!(
        decode_surface(token.as_str(), SECRET).unwrap_err().kind(),
        &ErrorKind::ExpiredSignature
    );
}

#[test]
fn surface_tokens_require_expected_issuer_and_signature() {
    let valid = claims();
    let token = encode_surface(&valid, SECRET).unwrap();
    assert!(decode_surface(token.as_str(), "wrong-secret").is_err());
    let mut raw = raw_claims();
    raw.iss = "another-service";
    rejects(&raw);
}

#[test]
fn surface_tokens_require_expiry() {
    #[derive(Serialize)]
    struct NoExpiry {
        session_kind: SessionKind,
        surface_id: SurfaceId,
        access_level: SurfaceAccessLevel,
        iss: &'static str,
    }
    let token = encode(
        &NoExpiry {
            session_kind: SessionKind::Surface,
            surface_id: ID.parse().unwrap(),
            access_level: SurfaceAccessLevel::View,
            iss: ISSUER,
        },
        SECRET,
    )
    .unwrap();
    assert!(decode_surface(token.as_str(), SECRET).is_err());
}
