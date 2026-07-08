import * as fs from 'fs';
import type { TopicArgs } from '../../packages/resources';

// NOTE: For now we will standardize the topic config rather than allow granular topic configuration
// should we require custom partitioning/formatting for topics in the future we can address that
// when we come to it
const topicArgDefaults = {
  partitionCount: 6,
  replicationFactor: 3,
  configs: JSON.stringify({
    'retention.ms': '604800000', // 7 days in ms
    'retention.bytes': '-1', // no max retention size
    'cleanup.policy': 'delete', // deletes log items when needed
    'min.insync.replicas': '2', // durability for minimum # of producers available for ack=all to succeed
  }),
};

// Read in the kafka topic file (kafka-cluster-topics.json) and parse out all topics
export function getKafkaClusterTopics(): TopicArgs[] {
  const kafkaClusterTopics: string[] = JSON.parse(
    fs.readFileSync('../../../.github/kafka-cluster-topics.json').toString()
  );

  console.log('Generating following topics...', kafkaClusterTopics);

  const topics: TopicArgs[] = [];

  for (const name of kafkaClusterTopics) {
    topics.push({
      name,
      ...topicArgDefaults,
    });
  }

  if (topics.length === 0) {
    throw new Error('no kafka topics were generated');
  }

  return topics;
}
