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

#[test]
fn allocation_watermark_includes_temporary_keys_and_resets_with_generation() -> Result<(), Error> {
    let counter = SharedKeyCounter::new();
    assert_eq!(counter.last_allocated(), None);
    let first = counter.next()?;
    let temporary = counter.next()?;
    assert_eq!(counter.last_allocated(), Some(temporary));
    assert_ne!(first, temporary);
    counter.reset()?;
    assert_eq!(counter.last_allocated(), None);
    let next = counter.next()?;
    assert_eq!(counter.last_allocated(), Some(next));
    assert_eq!(next.index(), first.index());
    assert_ne!(next.generation(), first.generation());
    Ok(())
}
