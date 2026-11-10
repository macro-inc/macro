use super::*;

#[test]
fn a_deployment_without_a_provider_key_has_stacks_off_for_everyone() {
    let develop = StackFlags::new(Environment::Develop, None, None).unwrap();
    let production = StackFlags::new(Environment::Production, None, None).unwrap();

    assert!(develop.off_for_everyone());
    assert!(production.off_for_everyone());
}

#[test]
fn a_deployment_with_a_provider_key_asks_per_person() {
    let flags = StackFlags::new(Environment::Production, Some("phc_test_key"), None).unwrap();

    assert!(matches!(flags, StackFlags::Remote(_)));
    assert!(!flags.off_for_everyone());
}

#[test]
fn a_local_stack_has_stacks_on_for_everyone() {
    let flags = StackFlags::new(Environment::Local, None, None).unwrap();

    assert!(matches!(flags, StackFlags::Fixed(true)));
    assert!(!flags.off_for_everyone());
}
