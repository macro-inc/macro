import type { MacroClient } from '../../utils/client';
import type { SearchOpts } from '../search';
import { CallRecord } from './call-record';

/**
 * @routing Use when the request names a recorded call or its transcript, such as what was said on yesterday's call; not email, messages, tables or scheduling.
 */
export class CallRecordNamespace {
  constructor(private readonly client: MacroClient) {}

  byId(id: string): CallRecord {
    return CallRecord.byId(this.client, id);
  }

  search(query: string, opts?: SearchOpts): AsyncGenerator<CallRecord> {
    return CallRecord.search(this.client, query, opts);
  }
}
