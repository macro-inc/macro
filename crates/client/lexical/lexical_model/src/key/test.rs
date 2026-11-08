use super::*;
#[test]
fn generations_cannot_alias() -> Result<(), Error> {
    let counter = SharedKeyCounter::new();
    let first = counter.next()?;
    counter.reset()?;
    let second = counter.next()?;
    assert_ne!(first, second);
    assert_eq!(first.to_string(), second.to_string());
    assert!(first < second);
    assert_eq!(
        NodeKey::from_parts(KeyParts {
            generation: 4,
            index: 0
        }),
        NodeKey::ROOT
    );
    assert_eq!(counter.clone().next()?.index(), 2);
    Ok(())
}
