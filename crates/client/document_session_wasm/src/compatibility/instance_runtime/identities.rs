//! Exact issued JS instance IDs, compacted into adjacent numeric intervals.
use super::*;
use std::collections::BTreeMap;

#[derive(Default)]
pub(super) struct InstanceIds(BTreeMap<u32, u32>);
impl InstanceIds {
    pub fn claim(&mut self, id: u32) -> Result<(), Error> {
        if id == 0 {
            return Err(Error::Invariant("zero foreign instance identity"));
        }
        let left = self
            .0
            .range(..=id)
            .next_back()
            .map(|(start, end)| (*start, *end));
        if left.is_some_and(|(_, end)| id <= end) {
            return Err(Error::Invariant(
                "foreign instance identity was already used",
            ));
        }
        let mut start = id;
        let mut end = id;
        if let Some((lower, _)) = left.filter(|(_, upper)| upper.checked_add(1) == Some(id)) {
            self.0.remove(&lower);
            start = lower;
        }
        let right = self.0.range(id..).next().map(|(start, end)| (*start, *end));
        if let Some((lower, upper)) = right.filter(|(lower, _)| end.checked_add(1) == Some(*lower))
        {
            self.0.remove(&lower);
            end = upper;
        }
        self.0.insert(start, end);
        Ok(())
    }
}
#[cfg(test)]
mod test {
    use super::*;
    #[test]
    fn out_of_order_claims_merge_without_permitting_reuse_or_wrapping() -> Result<(), Error> {
        let mut ids = InstanceIds::default();
        ids.claim(3)?;
        ids.claim(1)?;
        ids.claim(5)?;
        ids.claim(2)?;
        ids.claim(4)?;
        assert_eq!(ids.0, [(1, 5)].into());
        assert!(ids.claim(3).is_err());
        assert!(ids.claim(0).is_err());
        ids.claim(u32::MAX)?;
        ids.claim(u32::MAX - 1)?;
        assert_eq!(ids.0, [(1, 5), (u32::MAX - 1, u32::MAX)].into());
        assert!(ids.claim(u32::MAX).is_err());
        Ok(())
    }
}
