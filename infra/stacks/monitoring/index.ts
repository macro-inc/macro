// Datadog monitors and synthetic tests.
//
// Every monitor in the org is declared here, and every one notifies through
// notify.ts. See README.md before deploying — the 34 monitors under `monitors/`
// are adopted, not created, and a program that stops declaring one deletes it.

// Adopted from the Datadog UI.
import './monitors/cache';
import './monitors/compute';
import './monitors/dynamodb';
import './monitors/load-balancer';
import './monitors/logs';
import './monitors/opensearch';
import './monitors/rds';
import './monitors/rum';
import './monitors/ses';
import './synthetics';

// Declared here first.
import './goalert';
import './monitors/ai-editing';
import './monitors/calls';
import './monitors/graphql-soup';
import './monitors/macrodb';
import './monitors/queues';
import './monitors/redis';
import './monitors/regressions';
import './monitors/whatsapp-session';
import { notificationRetentionDashboard } from './monitors/notification-retention';

export const notificationRetentionDashboardUrl =
  notificationRetentionDashboard.url;
