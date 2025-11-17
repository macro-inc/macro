// This script allows you to cancel an async job by its task ID.
// Usage: bun kill_async_job.ts <task_id>

require('dotenv').config();

import { client } from '../client';

async function cancelTask(taskId: string) {
  const opensearchClient = client();

  try {
    await opensearchClient.tasks.cancel({
      task_id: taskId,
    });
    console.log(`✓ Task ${taskId} cancelled`);
  } catch (error: any) {
    console.error(`✗ Error: ${error.message}`);
    process.exit(1);
  }
}

const taskId = process.argv[2];

if (!taskId) {
  console.error('Usage: bun kill_async_job.ts <task_id>');
  process.exit(1);
}

console.log(`Cancelling task ${taskId}...`);

cancelTask(taskId);
