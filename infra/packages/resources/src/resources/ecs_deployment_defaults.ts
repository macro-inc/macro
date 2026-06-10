import type * as aws from '@pulumi/aws';

export const DEFAULT_CONTINUE_BEFORE_STEADY_STATE = true;

export const DEFAULT_TARGET_GROUP_HEALTH_CHECK = {
  interval: 10,
  healthyThreshold: 2,
  unhealthyThreshold: 2,
  timeout: 5,
  matcher: '200-399',
} satisfies Partial<aws.types.input.lb.TargetGroupHealthCheck>;

export const DEFAULT_DEREGISTRATION_DELAY_SECONDS = 15;
