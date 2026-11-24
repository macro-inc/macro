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
        assert_eq!(spec.units, resources.units(), "{}", spec.id.as_str());
        assert_eq!(
            spec.root_disk_gib.get(),
            crate::domain::image::ROOT_DISK_GIB,
            "{}",
            spec.id.as_str()
        );
        assert_eq!(
            crate::domain::image::data_disk_gib(resources),
            Some(spec.home_disk_gib.get()),
            "{}",
            spec.id.as_str()
        );
    }
}

#[test]
fn every_size_has_exactly_one_spec_in_catalog_order() {
    let sizes: Vec<ComputerSize> = SIZE_SPECS.iter().map(|spec| spec.size).collect();
    assert_eq!(sizes, ComputerSize::ALL);
}

#[test]
fn catalog_entry_ids_are_label_at_version() {
    for valid in ["standard@2026-11", "large-2@2026.11-a", "a@1"] {
        assert!(CatalogEntryId::try_new(valid.to_owned()).is_ok(), "{valid}");
        assert_eq!(CatalogEntryId::from_static(valid).as_str(), valid);
    }
    for invalid in [
        "",
        "standard",
        "@2026-11",
        "standard@",
        "std@2026@11",
        "st d@1",
        "std@1/2",
        "std.x@1",
    ] {
        assert!(
            CatalogEntryId::try_new(invalid.to_owned()).is_err(),
            "{invalid}"
        );
    }
}

#[test]
#[should_panic(expected = "catalog entry must be a label@version identity")]
fn a_malformed_literal_identity_is_refused() {
    let _ = CatalogEntryId::from_static(std::hint::black_box("standard"));
}
