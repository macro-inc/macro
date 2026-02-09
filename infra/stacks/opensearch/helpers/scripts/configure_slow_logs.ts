import { client } from '../client';

async function configureSlowLogs() {
  const opensearchClient = client();
  console.log('Configuring slow query logging thresholds...');

  try {
    // Configure slow query thresholds for all indices
    const response = await opensearchClient.indices.putSettings({
      index: '_all',
      body: {
        // Search query slow logs
        'index.search.slowlog.threshold.query.warn': '1s',
        'index.search.slowlog.threshold.query.info': '500ms',
        'index.search.slowlog.threshold.query.debug': '200ms',
        'index.search.slowlog.threshold.query.trace': '100ms',

        // Search fetch slow logs
        'index.search.slowlog.threshold.fetch.warn': '1s',
        'index.search.slowlog.threshold.fetch.info': '500ms',
        'index.search.slowlog.threshold.fetch.debug': '200ms',
        'index.search.slowlog.threshold.fetch.trace': '100ms',

        // Indexing slow logs
        'index.indexing.slowlog.threshold.index.warn': '1s',
        'index.indexing.slowlog.threshold.index.info': '500ms',
        'index.indexing.slowlog.threshold.index.debug': '200ms',
        'index.indexing.slowlog.threshold.index.trace': '100ms',

        // Slow log level (can be: trace, debug, info, warn)
        'index.search.slowlog.level': 'info',
        'index.indexing.slowlog.level': 'info',
      },
    });

    console.log('✅ Slow log thresholds configured successfully');
    console.log('Response:', response.body);

    // Verify settings were applied
    const settings = await opensearchClient.indices.getSettings({
      index: '_all',
    });

    console.log('\n📊 Current slow log settings (sample from first index):');
    const firstIndex = Object.keys(settings.body)[0];
    if (firstIndex) {
      const indexSettings = settings.body[firstIndex].settings.index;
      console.log('Search query warn threshold:', indexSettings?.search?.slowlog?.threshold?.query?.warn);
      console.log('Search fetch warn threshold:', indexSettings?.search?.slowlog?.threshold?.fetch?.warn);
      console.log('Indexing warn threshold:', indexSettings?.indexing?.slowlog?.threshold?.index?.warn);
    }

    console.log('\n📝 Slow queries will now be logged to CloudWatch:');
    console.log('  - Queries > 1s: WARN level');
    console.log('  - Queries > 500ms: INFO level');
    console.log('  - Queries > 200ms: DEBUG level');
    console.log('  - Queries > 100ms: TRACE level');
  } catch (error) {
    console.error('❌ Error configuring slow logs:', error);
    throw error;
  }
}

configureSlowLogs();
