// What the deploy workflow may apply on its own: a new image or runtime
// settings, which replace the instance and re-point what references it. Any
// other change (network, storage, IAM, DNS) stops the run for a reviewed,
// manual `pulumi up`, so the workflow's role stays narrow.

export interface PreviewStep {
  op: string;
  urn: string;
}

export interface Preview {
  steps?: PreviewStep[];
}

const REPLACE = ['replace', 'create-replacement', 'delete-replaced'];
const ALLOWED: Record<string, string[]> = {
  'aws:ec2/instance:Instance': [...REPLACE, 'update'],
  'aws:ec2/volumeAttachment:VolumeAttachment': REPLACE,
  'aws:lb/targetGroupAttachment:TargetGroupAttachment': REPLACE,
  // Their InstanceId dimension follows the new host.
  'aws:cloudwatch/metricAlarm:MetricAlarm': ['update'],
  'pulumi:pulumi:Stack': ['update'],
};
// Pulumi reports these for resources it leaves alone.
const UNCHANGED = ['same', 'read'];
// The retained telemetry: an auto-deploy must leave each of them untouched.
export const DURABLE = [
  'aws:ebs/volume:Volume::observability-data',
  'aws:s3/bucketV2:BucketV2::observability-logs',
  'aws:s3/bucketV2:BucketV2::observability-traces',
];
export const INSTANCE = 'aws:ec2/instance:Instance::observability';

/** `type::name` from a URN, dropping any parent type chain. */
export function resourceOf(urn: string): { type: string; name: string } {
  const parts = urn.split('::');
  if (parts.length < 4) throw new Error(`Unexpected URN ${urn}`);
  const type = parts[parts.length - 2].split('$').pop() ?? '';
  return { type, name: parts[parts.length - 1] };
}

export interface PlanCheck {
  /** The changes, as `op type::name`. */
  changes: string[];
  /** Why the workflow must not apply this plan; empty when it may. */
  refused: string[];
  /** The instance's URN, which `pulumi up --target` is restricted to. */
  instanceUrn?: string;
}

export function checkPlan(preview: Preview): PlanCheck {
  const steps = preview.steps ?? [];
  const changes: string[] = [];
  const refused: string[] = [];
  let instanceUrn: string | undefined;
  const seen = new Set<string>();
  for (const step of steps) {
    const { type, name } = resourceOf(step.urn);
    const id = `${type}::${name}`;
    seen.add(id);
    if (id === INSTANCE) instanceUrn = step.urn;
    if (UNCHANGED.includes(step.op)) continue;
    changes.push(`${step.op} ${id}`);
    if (DURABLE.includes(id)) {
      refused.push(`${step.op} of retained storage ${id}`);
    } else if (!ALLOWED[type]?.includes(step.op)) {
      refused.push(`${step.op} ${id} is outside what the workflow deploys`);
    } else if (type === 'aws:ec2/instance:Instance' && id !== INSTANCE) {
      refused.push(`${step.op} of an unexpected instance ${id}`);
    }
  }
  for (const id of [...DURABLE, INSTANCE]) {
    if (!seen.has(id)) refused.push(`the plan does not mention ${id}`);
  }
  return { changes, refused, instanceUrn };
}
