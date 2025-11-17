import { client } from '../client';

async function healthCheck() {
  const opensearchClient = client();
  console.log('Performing health check...');

  try {
    const clusterInfo = await opensearchClient.info();
    console.log('Cluster Info:', clusterInfo.body);

    const healthData = await opensearchClient.cluster.health();
    console.log('Cluster Health:', healthData.body);

    const indices = await opensearchClient.cat.indices({
      format: 'json',
    });
    console.log('Indices:', indices.body);
  } catch (error) {
    console.error('Error', error);
  }
}

healthCheck();
