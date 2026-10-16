use super::*;

#[test]
fn signatures_cover_raw_body_timestamp_and_id() {
    let secret = SigningSecret(format!("whsec_{}", STANDARD.encode([7_u8; 32])));
    let mut mac = Hmac::<Sha256>::new_from_slice(&[7; 32]).unwrap();
    mac.update(b"event.1000.{\"hello\":true}");
    let signature = format!("v1,{}", STANDARD.encode(mac.finalize().into_bytes()));
    let mut delivery = Delivery {
        id: "event",
        timestamp: "1000",
        signature: &signature,
        body: br#"{"hello":true}"#,
    };
    assert!(verify_at(&secret, &delivery, 1000));
    assert!(!verify_at(&secret, &delivery, 1301));
    assert!(!verify_at(&secret, &delivery, 699));
    delivery.body = br#"{"hello":false}"#;
    assert!(!verify_at(&secret, &delivery, 1000));
    delivery.body = br#"{"hello":true}"#;
    delivery.id = "other";
    assert!(!verify_at(&secret, &delivery, 1000));
}

#[test]
fn accepts_a_valid_signature_among_rotated_keys_but_not_unknown_versions() {
    let secret = SigningSecret(format!("whsec_{}", STANDARD.encode([9_u8; 32])));
    let mut mac = Hmac::<Sha256>::new_from_slice(&[9; 32]).unwrap();
    mac.update(b"event.1000.{}");
    let valid = STANDARD.encode(mac.finalize().into_bytes());
    let signature = format!("v1,invalid v1,{valid}");
    let delivery = Delivery {
        id: "event",
        timestamp: "1000",
        signature: &signature,
        body: b"{}",
    };
    assert!(verify_at(&secret, &delivery, 1000));
    let invalid = format!("v2,{valid}");
    assert!(!verify_at(
        &secret,
        &Delivery {
            signature: &invalid,
            ..delivery
        },
        1000
    ));
}
