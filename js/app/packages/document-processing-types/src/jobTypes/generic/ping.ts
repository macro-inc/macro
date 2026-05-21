import { z } from 'zod';
import { BaseResponse } from '../baseResponse';

const Ping = z.any();

export function ping_validate(data: { [name: string]: unknown }): unknown {
  return Ping.parse(data);
}

/**
 * Simple job that will hit the consumer and re-log the data you provide.
 * Meant to test things working E2E.
 */
export type Ping = z.infer<typeof Ping>;

const PingResponseDataSchema = z.object({
  pong: z.literal(true),
});

type PingResponseData = z.infer<typeof PingResponseDataSchema>;

const PingResponse = BaseResponse.extend({
  data: PingResponseDataSchema.optional(),
});

export function ping_response_validate(data: { [name: string]: unknown }) {
  return PingResponse.parse(data);
}

export type PingResponse = z.infer<typeof PingResponse>;

export function ping_response_data_validate(
  data: unknown
): data is PingResponseData {
  return PingResponseDataSchema.safeParse(data).success;
}
