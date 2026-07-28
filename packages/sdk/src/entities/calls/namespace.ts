import type { MacroClient } from '../../utils/client';
import type { SearchOpts } from '../search';
import { CallRecord } from './call-record';

export class CallRecordNamespace {
  constructor(private readonly client: MacroClient) {}

  byId(id: string): CallRecord {
    return CallRecord.byId(this.client, id);
  }

  search(query: string, opts?: SearchOpts): AsyncGenerator<CallRecord> {
    return CallRecord.search(this.client, query, opts);
  }
}
