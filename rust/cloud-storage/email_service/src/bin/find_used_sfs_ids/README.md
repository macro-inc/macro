# Find Used SFS IDs

This binary scans email message HTML content to find all SFS (Static File Service) UUIDs that are referenced in message bodies. This helps identify which SFS mappings are actually in use versus those that are orphaned.

## Purpose

Part of a three-step workflow to identify and clean up unused SFS files:
1. **This tool** → Finds SFS UUIDs referenced in email message bodies
2. `find_unused_sfs_ids` → Compares all mappings against used UUIDs to find orphans
3. `cleanup_unused_sfs` → Deletes the unused files and mappings

## How It Works

1. Fetches all email message IDs from the database
2. Retrieves message HTML content in batches (streaming, memory-efficient)
3. Extracts SFS UUIDs from HTML using regex pattern matching
4. Writes unique UUIDs to output file as they're discovered
5. Supports resume functionality - if interrupted, it picks up where it left off

## Environment Variables

### Required
- `DATABASE_URL`: PostgreSQL connection string for the MacroDB database

### Optional
- `SFS_DOMAIN`: The domain to search for (default: `static-file-service.macro.com`)
- `MESSAGE_IDS_FILE`: Path to store/load message IDs (default: `message_ids.txt`)
- `USED_UUIDS_FILE`: Path to store found UUIDs (default: `used_sfs_uuids.txt`)
- `FETCH_BATCH_SIZE`: Number of messages to fetch from DB per query (default: `1000`)
- `BATCH_SIZE`: Number of messages to process before logging progress (default: `1000`)
- `PREFETCH_BATCHES`: Number of batches to prefetch while processing (default: `2`)

## Usage

### Basic Usage
```bash
cargo run --bin find_used_sfs_ids
```

### With Custom Configuration
```bash
export DATABASE_URL="postgresql://user:pass@localhost/macrodb"
export SFS_DOMAIN="static-file-service-dev.macro.com"
export USED_UUIDS_FILE="custom_used_uuids.txt"
cargo run --bin find_used_sfs_ids
```

### From Release Binary
```bash
./find_used_sfs_ids
```

## Output Files

### `used_sfs_uuids.txt` (default)
Contains one UUID per line for each SFS file referenced in email message bodies.

Example:
```
bc698c53-5a61-45f9-ac88-212e22cf8a33
d4e7f1a2-9b3c-4d2e-8f5a-1a2b3c4d5e6f
a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d
```

### `message_ids.txt` (default)
Cached list of all message IDs from the database. If this file exists, the tool will use it instead of querying the database again.

### `message_ids.processed` (automatically created)
Tracks which message IDs have been processed. Used for resume functionality.

## Resume Functionality

The tool automatically supports resuming interrupted runs:

1. On start, checks for existing `message_ids.processed` file
2. Skips messages that have already been processed
3. Appends newly found UUIDs to the existing output file
4. Progress is saved incrementally, so interruptions are safe

To force a fresh run, delete:
- `message_ids.processed`
- `used_sfs_uuids.txt` (optional, if you want to start fresh)

## Performance

- **Streaming architecture**: Fetches and processes messages in batches to avoid loading all into memory
- **Concurrent processing**: Uses tokio tasks to process multiple messages in parallel
- **Prefetching**: Database batches are fetched ahead of processing to minimize wait time
- **Incremental writes**: UUIDs are written to disk as they're found, not buffered in memory

Typical performance:
- ~1000-2000 messages per second (varies based on HTML complexity)
- Memory usage stays constant regardless of total message count
- Can process millions of messages without issue

## Example Run

```
=== Find Used SFS IDs ===

Loading configuration...
Configuration:
  SFS Domain: static-file-service.macro.com
  Message IDs file: message_ids.txt
  Used UUIDs file: used_sfs_uuids.txt
  Fetch batch size: 1000
  Progress batch size: 1000
  Prefetch batches: 2

Connecting to the database...
Fetching all message IDs from the database...
Found 145623 message IDs

Total message IDs to process: 145623

  [Batch 1/146] DB fetch: 1000 messages in 245ms
  [Batch 1/146] Processing: 1000 messages in 1.2s
Progress: 1000/145623 messages processed, 342 unique UUIDs found (342 new this run)
  [Batch 2/146] DB fetch: 1000 messages in 198ms
  [Batch 2/146] Processing: 1000 messages in 1.1s
Progress: 2000/145623 messages processed, 687 unique UUIDs found (345 new this run)
...

=== Processing Complete ===
Total messages processed: 145623
Total unique SFS UUIDs found: 12847
Results saved to: used_sfs_uuids.txt
```

## Next Steps

After running this tool:
1. Run `find_unused_sfs_ids` to compare all mappings against this list
2. Review the unused UUIDs file to verify they're safe to delete
3. Run `cleanup_unused_sfs` to delete the unused files and mappings

## Troubleshooting

### "Failed to connect to database"
- Verify `DATABASE_URL` is set correctly
- Check database is running and accessible
- Ensure user has SELECT permissions on email_messages table

### Out of memory
- Reduce `FETCH_BATCH_SIZE` (try 500 or 250)
- Reduce `PREFETCH_BATCHES` (try 1)

### Slow performance
- Increase `FETCH_BATCH_SIZE` (try 2000 or 5000)
- Ensure database has proper indexes on email_messages table
- Check database connection pool size

### Resume not working
- Check that `message_ids.processed` file has write permissions
- Verify file is in the same directory as the binary
