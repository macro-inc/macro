.PHONY: build build-submit build-update

build: build-submit build-update

build-submit:
	cargo lambda build --release --bin submit --output-format zip

build-update:
	cargo lambda build --release --bin update --output-format zip
