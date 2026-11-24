# APS response fixtures

These are **Autodesk's published example responses**, copied verbatim from the
APS Data Management API v2 reference on 2026-11-24. They were **not recorded**
from a real Autodesk account: none existed when the import was written. Their
ids, names and URLs are Autodesk's placeholders, and some are BIM 360 or Revit
examples rather than Fusion ones. Replace them with scrubbed recordings once
the live test (`cargo test -p fusion_import -- --ignored`) has run against a
real account.

| File | Endpoint | Reference page example |
| --- | --- | --- |
| `hubs.json` | `GET /project/v1/hubs` | [hubs-GET](https://aps.autodesk.com/en/docs/data/v2/reference/http/hubs-GET/) |
| `projects.json` | `GET /project/v1/hubs/:hub_id/projects` | [hubs-hub_id-projects-GET](https://aps.autodesk.com/en/docs/data/v2/reference/http/hubs-hub_id-projects-GET/), first example |
| `projects_paged.json` | same, `?page[number]=1&page[limit]=2` | same page, the paged example |
| `top_folders.json` | `GET /project/v1/hubs/:hub_id/projects/:project_id/topFolders` | [hubs-hub_id-projects-project_id-topFolders-GET](https://aps.autodesk.com/en/docs/data/v2/reference/http/hubs-hub_id-projects-project_id-topFolders-GET/) |
| `folder_contents.json` | `GET /data/v1/projects/:project_id/folders/:folder_id/contents` | [projects-project_id-folders-folder_id-contents-GET](https://aps.autodesk.com/en/docs/data/v2/reference/http/projects-project_id-folders-folder_id-contents-GET/) |
| `item.json` | `GET /data/v1/projects/:project_id/items/:item_id` | [projects-project_id-items-item_id-GET](https://aps.autodesk.com/en/docs/data/v2/reference/http/projects-project_id-items-item_id-GET/) |
| `versions.json` | `GET /data/v1/projects/:project_id/items/:item_id/versions` | [projects-project_id-items-item_id-versions-GET](https://aps.autodesk.com/en/docs/data/v2/reference/http/projects-project_id-items-item_id-versions-GET/) |
| `signeds3download_complete.json` | `GET /oss/v2/buckets/:bucketKey/objects/:objectKey/signeds3download` | [buckets-:bucketKey-objects-:objectKey-signeds3download-GET](https://aps.autodesk.com/en/docs/data/v2/reference/http/buckets-:bucketKey-objects-:objectKey-signeds3download-GET/), Example 1 |
| `signeds3download_fallback.json` | same | same page, Example 2 |
| `signeds3download_chunked.json` | same | same page, Example 3 |

What the examples don't show, and a recording must confirm:

- `fileType` and `storageSize` on versions: documented, but absent from the
  versions example (the item example's included version has `fileType`). The
  client falls back to the extension of the version's `name`.
- A last page: every paged example carries `links.next`. Tests make the last
  page by removing `links.next` from a parsed copy, so the files stay verbatim.
- What a Fusion design's version looks like (`f3d` or no file extension) and
  whether its storage downloads.
