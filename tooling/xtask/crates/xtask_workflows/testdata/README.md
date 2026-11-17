# Workflow test data

`pulumi-preview-services.json` and the two `pulumi-preview-*-source.txt`
files retain independent synthetic inputs for the preview selector test.
The test writes config and changed paths into a temporary checkout; these
labels are data, not paths to read from the current repository. Expected
service selections and assertions remain in the Rust test.
