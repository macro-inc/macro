# Changelog - utoipa-swagger-ui

## 9.0.2 - Sun 25 May 2025

### Fixed

* Avoid cloning ApiDoc on every request for axum (https://github.com/juhaku/utoipa/pull/1393)

### Changed

* Update build dependency `zip` to v3.0 (https://github.com/juhaku/utoipa/pull/1391)

## 9.0.1 - Fri 4 Apr 2025

### Fixed

* fix(swagger-ui): fix build for breaking zip crate 2.6.0 change (#1363)
* fix: mismatch error from InvalidArchive (#1343)

## 9.0.0 - Thu 16 2025

### Changed

* Re-release 8.1.1 since axum upgrade is a breaking change (https://github.com/juhaku/utoipa/pull/1295)

## 8.1.1 - Jan 6 2025

### Changed

* Update axum to v0.8 (https://github.com/juhaku/utoipa/pull/1269)

### Fixed

* Add debug implementation for SwaggerUi (https://github.com/juhaku/utoipa/pull/1276)

## 8.1.0 - Dec 19 2024

### Added

* Add basic auth support for actix, rocket, axum (https://github.com/juhaku/utoipa/pull/1221)
* Add `cache` feature to cache swagger ui zip in build script (https://github.com/juhaku/utoipa/pull/1214)
* Allow disabling syntax highlighting (https://github.com/juhaku/utoipa/pull/1188)

## 8.0.3 - Oct 23 2024

### Fixed

* Fixed version number from docs main page

## 8.0.2 - Oct 21 2024

### Fixed

* Fix regression due to a985d8c1340f80ab69b2b0e5de799df98d567732 (https://github.com/juhaku/utoipa/pull/1155)

## 8.0.1 - Oct 16 2024

### Changed

* Update Swagger UI with latest release 5.7.14 (https://github.com/juhaku/utoipa/pull/1142)

## 8.0.0 - Oct 14 2024

### Added

* Add typos to CI (https://github.com/juhaku/utoipa/pull/1036)
* Add macros feature flag (https://github.com/juhaku/utoipa/pull/1015)

### Fixed

* Fix testing without explicit features (https://github.com/juhaku/utoipa/pull/1041)
* Fix building utoipa-axum & utoipa-swagger-ui (https://github.com/juhaku/utoipa/pull/1038)
* Fix utoipa-swagger-ui-vendored crates link

### Changed

* Remove commit commit id from changelogs (https://github.com/juhaku/utoipa/pull/1077)
* Update to rc version
* Always use system `curl` by default (https://github.com/juhaku/utoipa/pull/1045)
* Remove Redirect Causing Invalid URIs for Swagger UIs Server on / (https://github.com/juhaku/utoipa/pull/1043)
* Use fs::read to overwrite swagger UI contents (https://github.com/juhaku/utoipa/pull/1022)
* Update next beta versions
* Chore update docs and relax `url` version (https://github.com/juhaku/utoipa/pull/1001)
* Bump up versions (https://github.com/juhaku/utoipa/pull/998)
* Update versions
* Update utoipa-swagger-ui vendored dependency

## 7.1.0 - May 22 2024

### Added

* Add vendored Swagger UI for utoipa (https://github.com/juhaku/utoipa/pull/941)

### Changed

* Update utoipa-swagger-ui vendored dependency
* Update utoipa-swagger-ui-vendored version
* Include res for crates
* Update min Rust version and utoipa-swagger-ui version

## 7.0.3 - May 22 2024

### Fixed

* Fix docs.rs build

## 7.0.2 - May 21 2024

### Added

* Add missing windows check to utoipa-swagger-ui build.rs
* Add nest `OpenApi` support (https://github.com/juhaku/utoipa/pull/930)

### Changed

* Update `utoipa-swagger-ui` versions (https://github.com/juhaku/utoipa/pull/938)
* Enhance utoipa-swagger-ui build (https://github.com/juhaku/utoipa/pull/936)
* Use CARGO_HTTP_CAINFO CA file in build script if present (https://github.com/juhaku/utoipa/pull/935)
* Improve file:// url parsing (https://github.com/juhaku/utoipa/pull/925)
* Make SWAGGER_UI_DOWNLOAD_URL support file:// urls (https://github.com/juhaku/utoipa/pull/923)

## 7.0.1 - May 7 2024

### Changed

* Make reqwest to use rustls instead of openssl (https://github.com/juhaku/utoipa/pull/912)

## 7.0.0 - May 5 2024

### Added

* Add `default-features = false` to the optional axum dependency to avoid pulling in tokio in non-tokio environments (https://github.com/juhaku/utoipa/pull/874)

### Fixed

* Fix spelling (https://github.com/juhaku/utoipa/pull/846)

### Changed

* Seems like the zip_next is nowadays just zip again
* Update docs and next versions
* Update default Swagger UI version (https://github.com/juhaku/utoipa/pull/905)
* Replace `zip` with `zip_next` (https://github.com/juhaku/utoipa/pull/889)
* **`breaking`** Add flex to `utoipa-swagger-ui` build (https://github.com/juhaku/utoipa/pull/845)

## 6.0.0 - Jan 6 2024

### Changed

* Update next versions
* Allowing utoipa/utoipa-swagger-ui successfully build on Windows and made path proc macro attribute more permissive (https://github.com/juhaku/utoipa/pull/830)
* Update Rocket v0.5 (https://github.com/juhaku/utoipa/pull/825)
* Generate embed code instead of using interpolation (https://github.com/juhaku/utoipa/pull/828)
* Misc document improvements (https://github.com/juhaku/utoipa/pull/814)

## 5.0.0 - Nov 28 2023

### Changed

* Update next versions
* Axum 0.7 bindings (https://github.com/juhaku/utoipa/pull/807)

## 4.0.0 - Oct 7 2023

### Changed

* Update utoipa versions **min. utoipa `4`**

## 3.1.6 - Oct 7 2023

### Added

* Add rapidoc support (https://github.com/juhaku/utoipa/pull/723)

### Fixed

* Fix: panic on missing trailing / in rocket environment (https://github.com/juhaku/utoipa/pull/645) (#757)

### Changed

* Update next versions and dependencies

## 3.1.5 - Aug 6 2023

### Changed

* Update utoipa-swagger-ui version
* Update Swagger UI to 5.3.1
* Update README.md docs
