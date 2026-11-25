use super::*;

#[test]
fn record_ids_are_decimal_digits() {
    assert!(RecordId::try_from("1234567890".to_owned()).is_ok());
    for bad in ["", "12a", "../1", "1 2", "123456789012345678901"] {
        assert!(RecordId::try_from(bad.to_owned()).is_err(), "{bad:?}");
    }
}

#[test]
fn pipeline_keys_are_words_or_numbers() {
    for good in ["default", "closedwon", "123456", "appointment_scheduled"] {
        assert!(PipelineKey::try_from(good.to_owned()).is_ok(), "{good:?}");
    }
    for bad in ["", "a/b", "a b", "a?b"] {
        assert!(PipelineKey::try_from(bad.to_owned()).is_err(), "{bad:?}");
    }
}

#[test]
fn scopes_name_hubspot_scopes() {
    assert_eq!(Scope::Deals.to_string(), "crm.objects.deals.read");
    assert_eq!(
        HubspotError::MissingScope(Scope::Owners).to_string(),
        "The HubSpot connection is missing the crm.objects.owners.read scope"
    );
}
