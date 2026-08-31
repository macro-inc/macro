// Datadog monitors and synthetic tests.
//
// Every monitor in the org is declared here. See README.md before deploying —
// the 35 monitors under `monitors/` are adopted, not created, and a program that
// stops declaring one deletes it.

// Adopted from the Datadog UI.
import './monitors/apm';
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
import './monitors/ai-editing';
