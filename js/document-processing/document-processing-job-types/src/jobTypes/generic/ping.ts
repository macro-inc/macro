import { z } from 'zod';
import { BaseResponse } from '../baseResponse';

const Ping = z.any();

export function ping_validate(data: { [name: string]: any }) {
  const result = Ping.safeParse(data);
  if (result.success) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return result.data;
  }
  throw result.error;
}

/**
 * Simple job that will hit the consumer and re-log the data you provide.
 * Meant to test things working E2E.
 */
export type Ping = z.infer<typeof Ping>;

const PingResponseDataSchema = z.object({
  pong: z.literal(true),
});

const PingResponse = BaseResponse.extend({
  data: PingResponseDataSchema.optional(),
});

export type PingResponseData = z.infer<typeof PingResponseDataSchema>;

export function ping_response_validate(data: { [name: string]: any }) {
  const result = PingResponse.safeParse(data);
  if (result.success) {
    return result.data;
  }
  throw result.error;
}

export type PingResponse = z.infer<typeof PingResponse>;

export function ping_response_data_validate(
  data: any
): data is PingResponseData {
  const result = PingResponseDataSchema.safeParse(data);
  if (result.success) {
    return true;
  }
  return false;
}
