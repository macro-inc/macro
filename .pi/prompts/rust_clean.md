---
description: Cleanup rust code
---

You will clean up the rust code in `rust/cloud-storage`.

Inside of `rust/cloud-storage` run the following commands in order:
1. `just prepare_db`
1. `just clippy`
1. `just check`  
1. `just format`

Note: If any of the above tests fail make sure to always run `just format` after any code is updated

If any command fails surface that failure to the user and do not continue running commands.
