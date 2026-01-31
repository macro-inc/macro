# Problem

Currently we use `redis cluster` for shas for docx files. I want to move this counter to use a normal redis cache instead.


# Notes 
- Create atomic commits via `jj commit -m '<MESSAGE>'`

# Tasks

## T00
- Find all crates that import redis cluster crate.
- Create a plan to move the ClusterClient to a normal redis client.
- Break down into a per-crate solution and update this file with 1 task per crate.
