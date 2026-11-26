use super::*;

#[test]
fn record_ids_are_15_or_18_letters_and_digits() {
    for good in ["0015g00000AcmeA", "0015g00000AcmeAAA1"] {
        assert!(RecordId::try_from(good.to_owned()).is_ok(), "{good:?}");
    }
    for bad in [
        "",
        "0015g00000Acme",
        "0015g00000AcmeAA",
        "0015g00000AcmeAAA12",
        "0015g00000Acme/AA1",
        "0015g00000Acme AA1",
    ] {
        assert!(RecordId::try_from(bad.to_owned()).is_err(), "{bad:?}");
    }
}
