//! Validated class mask changes precede a compact update without registry walks.
use super::*;
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicU64, Ordering};
pub(super) struct ClassMasks {
    owner: u32,
    known: u64,
    classes: HashMap<u32, Arc<AtomicU64>>,
}
pub(super) struct MaskChanges(Vec<(Arc<AtomicU64>, u64)>);
impl MaskChanges {
    pub fn apply(self) {
        for (cell, hooks) in self.0 {
            cell.store(hooks, Ordering::Release);
        }
    }
}
impl ClassMasks {
    pub fn new(config: &compat::CompatConfig) -> Result<Self, BoundaryError> {
        let mut classes = HashMap::new();
        for class in &config.classes {
            if class.owner_id != config.editor_id
                || class.class_id == 0
                || classes
                    .insert(class.class_id, Arc::new(AtomicU64::new(class.hooks)))
                    .is_some()
            {
                return Err(BoundaryError::Invalid("compatibility class namespace"));
            }
        }
        Ok(Self {
            owner: config.editor_id,
            classes,
            known: lexical_model::ForeignHook::ALL
                .iter()
                .fold(0, |mask, hook| mask | hook.bit()),
        })
    }
    pub fn prepare(
        &self,
        patches: &[compat::CompatClassMaskPatch],
        hosted: bool,
    ) -> Result<MaskChanges, BoundaryError> {
        let mut seen = HashSet::new();
        let mut changes = Vec::with_capacity(patches.len());
        for patch in patches {
            let class = patch.class_id;
            if patch.owner_id != self.owner
                || class == 0
                || !seen.insert(class)
                || patch.hooks & !self.known != 0
            {
                return Err(BoundaryError::Invalid("compatibility class mask patch"));
            }
            let cell = self
                .classes
                .get(&class)
                .ok_or(BoundaryError::Invalid("unregistered compatibility class"))?;
            if patch.hooks != 0 && !hosted {
                return Err(BoundaryError::Invalid(
                    "compatibility callbacks are not installed",
                ));
            }
            changes.push((cell.clone(), patch.hooks));
        }
        Ok(MaskChanges(changes))
    }
}
#[cfg(test)]
mod test {
    use super::*;
    #[test]
    fn invalid_mask_list_changes_no_registered_cells() -> Result<(), BoundaryError> {
        let config = compat::CompatConfig {
            editor_id: 7,
            classes: vec![compat::ForeignClassRegistration {
                owner_id: 7,
                class_id: 1,
                type_name: "text".into(),
                class_name: "TextNode".into(),
                kind: compat::ForeignNodeKind::Text,
                ancestry: vec![],
                native_type: "text".into(),
                hooks: 0,
            }],
        };
        let masks = ClassMasks::new(&config)?;
        let valid = compat::CompatClassMaskPatch {
            owner_id: 7,
            class_id: 1,
            hooks: lexical_model::ForeignHook::ALL[0].bit(),
        };
        let invalid = compat::CompatClassMaskPatch {
            owner_id: 8,
            ..valid
        };
        assert!(masks.prepare(&[valid, invalid], true).is_err());
        assert_eq!(masks.classes[&1].load(Ordering::Acquire), 0);
        assert!(masks.prepare(&[valid, valid], true).is_err());
        assert!(masks
            .prepare(
                &[compat::CompatClassMaskPatch {
                    hooks: u64::MAX,
                    ..valid
                }],
                true
            )
            .is_err());
        assert!(masks
            .prepare(
                &[compat::CompatClassMaskPatch {
                    class_id: 99,
                    ..valid
                }],
                true
            )
            .is_err());
        assert!(masks.prepare(&[valid], false).is_err());
        masks.prepare(&[valid], true)?.apply();
        let expected = valid.hooks;
        assert_eq!(masks.classes[&1].load(Ordering::Acquire), expected);
        masks
            .prepare(&[compat::CompatClassMaskPatch { hooks: 0, ..valid }], false)?
            .apply();
        assert_eq!(masks.classes[&1].load(Ordering::Acquire), 0);
        Ok(())
    }
}
