use std::str::FromStr;

use sqlx::{Decode, Encode, Postgres, Type, encode::IsNull, postgres::PgArgumentBuffer};

use super::LinkShare;

#[test]
fn serializes_and_deserializes_screaming_snake_case_values() {
    assert_eq!(
        serde_json::to_string(&LinkShare::Public).unwrap(),
        "\"PUBLIC\""
    );
    assert_eq!(serde_json::to_string(&LinkShare::Team).unwrap(), "\"TEAM\"");
    assert_eq!(
        serde_json::from_str::<LinkShare>("\"PUBLIC\"").unwrap(),
        LinkShare::Public
    );
    assert_eq!(
        serde_json::from_str::<LinkShare>("\"TEAM\"").unwrap(),
        LinkShare::Team
    );
}

#[test]
fn displays_and_parses_screaming_snake_case_values() {
    assert_eq!(LinkShare::Public.to_string(), "PUBLIC");
    assert_eq!(LinkShare::Team.to_string(), "TEAM");
    assert_eq!(LinkShare::from_str("PUBLIC").unwrap(), LinkShare::Public);
    assert_eq!(LinkShare::from_str("TEAM").unwrap(), LinkShare::Team);
    assert!(LinkShare::from_str("public").is_err());
}

#[test]
fn encodes_as_postgres_text() {
    assert_eq!(
        <LinkShare as Type<Postgres>>::type_info(),
        <String as Type<Postgres>>::type_info()
    );
    assert!(<LinkShare as Type<Postgres>>::compatible(
        &<String as Type<Postgres>>::type_info()
    ));

    let mut buffer = PgArgumentBuffer::default();
    let is_null = <LinkShare as Encode<Postgres>>::encode_by_ref(&LinkShare::Team, &mut buffer)
        .expect("TEAM should encode as PostgreSQL TEXT");

    assert!(matches!(is_null, IsNull::No));
    assert_eq!(buffer.as_slice(), b"TEAM");
}

#[test]
fn supports_postgres_text_decoding() {
    fn assert_decode<T>()
    where
        for<'value> T: Decode<'value, Postgres>,
    {
    }

    assert_decode::<LinkShare>();
}
