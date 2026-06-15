use super::*;

#[test]
fn it_should_parse() {
    let valid_emails = [
        "sean@macro.com",
        "sean+testing.thing@example.gc.ca",
        "###hello###+weird@something-strange.world.tour",
    ];
    let res: Result<Vec<_>, _> = valid_emails
        .iter()
        .copied()
        .map(Email::parse_from_str)
        .collect();
    res.unwrap();
}

#[test]
fn it_should_fail() {
    let invalid_emails = [
        "sean@macro.com ",
        " sean@macro.com",
        "sean@macro.com\n",
        "\nsean@macro.com",
        // cant have double dot
        "sean..aye@macro.com",
        "sean@@macro.com",
        r#"foo"@macro.com"@example.com"#,
    ];
    invalid_emails
        .iter()
        .copied()
        .map(Email::parse_from_str)
        .for_each(|res| {
            res.unwrap_err();
        });
}

#[test]
fn local_part_works() {
    let email = Email::parse_from_str("###hello###+weird@something-strange.world.tour").unwrap();

    assert_eq!(email.local_part(), "###hello###+weird");
}

#[test]
fn domain_part_works() {
    let email = Email::parse_from_str("###hello###+weird@something-strange.world.tour").unwrap();

    assert_eq!(email.domain_part(), "something-strange.world.tour");
}

#[test]
fn test_normalize_email_and_lowercase() {
    let emails = [
        ("test@test.com", "test@test.com"),
        ("test321+test@test.com", "test321@test.com"),
        ("TEST321+test@test.com", "test321@test.com"),
        ("TEST321+TEST@test.com", "test321@test.com"),
        ("TEST321+TEST@TEST.com", "test321@test.com"),
        ("TEST321312.TEST@test.com", "test321312.test@test.com"),
        ("TEST321312.TEST+ABC@Test.com", "test321312.test@test.com"),
        ("test@test.test", "test@test.test"),
        ("test@test.test.test", "test@test.test.test"),
        ("test-123test.TESt@test.com", "test-123test.test@test.com"),
        ("test@test.com", "test@test.com"),
        ("test321+test@test.com", "test321@test.com"),
        ("test321312.test@test.com", "test321312.test@test.com"),
        ("test321312.test+abc@test.com", "test321312.test@test.com"),
        ("test@test.test", "test@test.test"),
        ("test@test.test.test", "test@test.test.test"),
        ("test-123test.test@test.test", "test-123test.test@test.test"),
    ];

    for (input, output) in emails {
        let result = Email::parse_from_str(input)
            .unwrap()
            .lowercase()
            .normalize()
            .unwrap();
        assert_eq!(result.as_ref(), output);
    }
}

#[test]
fn normalize_only() {
    let emails = [
        ("test@test.com", "test@test.com"),
        ("test321+test@test.com", "test321@test.com"),
        ("TEST321+test@test.com", "TEST321@test.com"),
        ("TEST321+TEST@test.com", "TEST321@test.com"),
        ("TEST321+TEST@TEST.com", "TEST321@TEST.com"),
        ("TEST321312.TEST@test.com", "TEST321312.TEST@test.com"),
        ("TEST321312.TEST+ABC@Test.com", "TEST321312.TEST@Test.com"),
        ("test@test.test", "test@test.test"),
        ("test@test.test.test", "test@test.test.test"),
        ("test-123test.TESt@test.com", "test-123test.TESt@test.com"),
        ("test@test.com", "test@test.com"),
        ("test321+test@test.com", "test321@test.com"),
        ("test321312.test@test.com", "test321312.test@test.com"),
        ("test321312.test+abc@test.com", "test321312.test@test.com"),
        ("test@test.test", "test@test.test"),
        ("test@test.test.test", "test@test.test.test"),
        ("test-123test.test@test.test", "test-123test.test@test.test"),
    ];

    for (input, output) in emails {
        let result = Email::parse_from_str(input).unwrap().normalize().unwrap();
        assert_eq!(result.as_ref(), output);
    }
}

#[test]
fn test_is_valid_email() {
    let emails = [
        ("test@test.com", true),
        ("test321+test@test.com", true),
        ("test321312.test@test.com", true),
        ("test@test.test", true),
        ("test.com", false),
        ("test@test", false),
        ("test@@test.com", false),
        ("test@#test.com", false),
        ("test@$test.com", false),
        ("test@/test.com", false),
        ("test@\\test.com", false),
        ("test@test.test.test", true),
        ("test-123test.test@test.test", true),
    ];

    for (input, is_valid) in emails {
        let res = Email::parse_from_str(input);
        match is_valid {
            true => {
                res.unwrap();
            }
            false => {
                res.unwrap_err();
            }
        }
    }
}
