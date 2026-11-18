use super::*;

#[tokio::test]
async fn hosted_claim_lookup_distinguishes_approved_claimed_and_missing() {
    let pairing = PairingId::new_from_uuid(Uuid::from_u128(1));
    for (status, expected) in [
        (PairingStatus::Approved, false),
        (PairingStatus::Claimed, true),
    ] {
        let service = service(FakeRepo {
            claim_facts: Some(PairingClaimFacts {
                device_secret_hash: harness_token::hash_token("fixture-device-value"),
                status,
                expires_at: Utc::now() - Duration::hours(1),
                harness_id: None,
            }),
            ..Default::default()
        });
        assert_eq!(
            service.hosted_pairing_claimed(pairing).await.unwrap(),
            expected
        );
    }
    assert!(matches!(
        service(FakeRepo::default())
            .hosted_pairing_claimed(pairing)
            .await,
        Err(HarnessError::NotFound(_))
    ));
}
