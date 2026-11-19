use super::*;

#[test]
fn capacity_uses_recorded_memory_and_cpu_rounding_up() {
    assert_eq!(
        ComputerResources {
            vcpus: Vcpus::new(4),
            memory_gib: MemoryGib::new(8),
            disk_gib: DiskGib::new(100)
        }
        .units(),
        1
    );
    assert_eq!(
        ComputerResources {
            vcpus: Vcpus::new(4),
            memory_gib: MemoryGib::new(9),
            disk_gib: DiskGib::new(100)
        }
        .units(),
        2
    );
    assert_eq!(
        ComputerResources {
            vcpus: Vcpus::new(9),
            memory_gib: MemoryGib::new(8),
            disk_gib: DiskGib::new(100)
        }
        .units(),
        3
    );
}

#[test]
fn the_catalog_sells_todays_tiers_unchanged() {
    let sold: Vec<(String, ComputerSize, u32, u32, u32)> = current_catalog()
        .into_iter()
        .map(|entry| {
            (
                entry.id.as_str().to_owned(),
                entry.size,
                entry.resources.vcpus.get(),
                entry.resources.memory_gib.get(),
                entry.resources.disk_gib.get(),
            )
        })
        .collect();
    assert_eq!(
        sold,
        vec![
            (
                "standard@2026-11".to_owned(),
                ComputerSize::Standard,
                4,
                8,
                100
            ),
            ("large@2026-11".to_owned(), ComputerSize::Large, 8, 16, 200),
            ("xl@2026-11".to_owned(), ComputerSize::Xl, 16, 32, 400),
        ]
    );
}

#[test]
fn each_tiers_written_disks_and_units_match_what_the_fleet_derives() {
    for spec in SIZE_SPECS {
        let resources = spec.resources();
        assert_eq!(spec.units, resources.units(), "{}", spec.id);
        assert_eq!(
            spec.root_disk_gib.get(),
            crate::domain::image::ROOT_DISK_GIB,
            "{}",
            spec.id
        );
        assert_eq!(
            crate::domain::image::data_disk_gib(resources),
            Some(spec.home_disk_gib.get()),
            "{}",
            spec.id
        );
    }
}

#[test]
fn every_size_has_exactly_one_spec_in_catalog_order() {
    let sizes: Vec<ComputerSize> = SIZE_SPECS.iter().map(|spec| spec.size).collect();
    assert_eq!(sizes, ComputerSize::ALL);
    for spec in SIZE_SPECS {
        assert!(
            CatalogEntryId::try_new(spec.id.to_owned()).is_ok(),
            "{}",
            spec.id
        );
    }
}
