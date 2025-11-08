# Cloud Storage

This folder contains all the service(s) and infra for the document storage.

## Prerequisites

- docker
- sqlx-cli
- just
- pulumi cli
- aws cli

# Testing

To run tests locally, run the following commands:

```bash
docker volume create macro_db_volume
docker-compose up -d macrodb
just setup_test_envs
just initialize_dbs
just test
```

## Deployment

To learn more read the [infra](./infra/README.md) documentation.

## Instructions

- If you haven't built anything in his project before you will need to run `just build_lambdas`
- cd `infra`
- install node modules `npm i`
- ensure you are on your correct AWS account and have pulumi cli logged into your correct work account
- `pulumi up`
- select the stack
- _read_ and understand the changes that are going to happen and ensure they are all to be expected
- done.

## Diagram

```mermaid
flowchart LR
dss(Document Storage Service)
docxunzip(Docx Unzip Lambda)
shacleantrigger(Sha Cleanup Trigger Lambda)
shacleanworker(Sha Cleanup Worker)
docx_upload[(Docx Upload Bucket)]
doc_storage[(Doc Storage Bucket)]
db[(MacroDB)]
cache[(Cloud Storage Cache)]
docmapping(Document Mapping Table)
docperms(Document Permissions Table)

dss --> doc_storage
dss --> docx_upload
dss --> db
dss --> cache
dss --> docmapping
dss --> docperms

docx_upload --unzip docx file--> docxunzip

docxunzip --> cache
docxunzip --> db
docxunzip --> doc_storage
docxunzip --> doc_mapping

shacleantrigger --triggers worker to cleanup unused bom parts--> shacleanworker
cache --> shacleanworker
shacleanworker --> doc_storage
```
