import type {
  ListTeamComputerUsageResponse,
  UsagePoint,
} from '@macro-inc/sdk/generated/auth';
import type { BillingReading } from './read';

function usagePoint(value: unknown): value is UsagePoint {
  if (value === null || typeof value !== 'object') return false;
  if (
    !('memoryBytes' in value) ||
    typeof value.memoryBytes !== 'number' ||
    !Number.isSafeInteger(value.memoryBytes) ||
    value.memoryBytes < 0
  ) {
    return false;
  }
  if (!('cpuPercent' in value) || value.cpuPercent == null) return true;

  const cpu = value.cpuPercent;
  return (
    typeof cpu === 'number' && Number.isFinite(cpu) && cpu >= 0 && cpu <= 100
  );
}

export function parseComputerUsage(
  value: unknown
): ListTeamComputerUsageResponse | undefined {
  if (!Array.isArray(value)) return;
  const computers: ListTeamComputerUsageResponse = [];

  for (const item of value) {
    const computer: unknown = item;
    if (
      !computer ||
      typeof computer !== 'object' ||
      !('computerId' in computer) ||
      typeof computer.computerId !== 'string' ||
      !computer.computerId ||
      !('points' in computer) ||
      !Array.isArray(computer.points) ||
      computer.points.length !== 96
    ) {
      return;
    }

    const points: (UsagePoint | null)[] = [];
    for (const item of computer.points) {
      const point: unknown = item;
      if (point === null) {
        points.push(null);
      } else if (usagePoint(point)) {
        points.push({
          cpuPercent: point.cpuPercent,
          memoryBytes: point.memoryBytes,
        });
      } else {
        return;
      }
    }
    computers.push({ computerId: computer.computerId, points });
  }

  return computers;
}

export async function readLocalCompute(
  teamId: string
): Promise<BillingReading<ListTeamComputerUsageResponse>> {
  if (!__BOTS_LOCAL_BILLING__) return { status: 'unavailable' };

  try {
    const response = await fetch(`${__BOTS_LOCAL_AUTH__}/compute-usage`, {
      redirect: 'error',
    });
    if (response.status === 401 || response.status === 403)
      return { status: 'denied' };
    if (response.ok) {
      const result: unknown = await response.json();
      if (
        result &&
        typeof result === 'object' &&
        'status' in result &&
        result.status === 'ready' &&
        'teamId' in result &&
        result.teamId === teamId &&
        'value' in result
      ) {
        const usage = parseComputerUsage(result.value);
        if (usage) return { status: 'ready', value: usage };
      }
    }
  } catch {
    // A failed local bridge never supplies observations.
  }
  return { status: 'unavailable' };
}
