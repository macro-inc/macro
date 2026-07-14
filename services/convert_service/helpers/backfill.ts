import dotenv from 'dotenv';

dotenv.config();

async function run() {
  const startLimit: number = parseInt(`${process.env.LIMIT ?? '10'}`);
  let offset: number = parseInt(`${process.env.OFFSET ?? '0'}`);
  const url: string = process.env.BASE_URL ?? '';
  const internal_api_key = process.env.INTERNAL_API_KEY ?? '';

  const workers = 5;

  if (url === '') {
    throw new Error('BASE_URL environment variable is required');
  }

  if (internal_api_key === '') {
    throw new Error('INTERNAL_API_KEY environment variable is required');
  }

  try {
    while (true) {
      console.log(
        `Starting backfill with limit ${startLimit} and offset ${offset}`
      );
      const promises: Promise<string | null>[] = [];
      for (let i = 0; i < workers; i++) {
        promises.push(
          backfill(url, internal_api_key, startLimit, i * startLimit + offset)
        );
      }
      const results = await Promise.all(promises);
      console.log('backfill results', results);

      for (const result of results) {
        if (!result) {
          console.log('backfill completed');
          break;
        }
      }

      // Update the base next offset to be the result of the last backfill
      // Result will be 0 when there is no more data to backfill
      offset = parseInt(results[4] ?? '');
      if (offset === 0) {
        break;
      }
    }
  } catch (e) {
    console.error(e, { startLimit, startOffset: offset });
    process.exit(1);
  }

  console.log('backfill completed');
}

async function backfill(
  url: string,
  internal_api_key: string,
  limit: number,
  offset: number
) {
  const start_time = performance.now();
  console.log('backfill', { offset });
  const result = await fetch(
    `${url}/internal/backfill/docx?limit=${limit}&offset=${offset}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-auth-key': internal_api_key,
      },
    }
  );

  console.log('backfill', {
    offset,
    time: `${performance.now() - start_time}ms`,
  });

  if (result.status !== 200) {
    throw new Error(
      `Backfill failed with status ${result.status} ${await result.text()}`
    );
  }

  return await result.text();
}

run();
