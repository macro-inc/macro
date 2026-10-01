import { parseCsv } from '@core/util/csv';
import { createSignal } from 'solid-js';
import { normalizeCompanyImport } from '../core/import-companies';
export function createCompanyImport(
  createCompany: (input: { name: string; domain: string }) => Promise<unknown>
) {
  const [rows, setRows] = createSignal<{ name: string; domain: string }[]>([]);
  const [error, setError] = createSignal('');
  const [pending, setPending] = createSignal(false);
  const [completed, setCompleted] = createSignal(0);
  async function read(file?: Pick<File, 'size' | 'text'>) {
    setError('');
    setRows([]);
    setCompleted(0);
    if (!file) return;
    if (file.size > 1024 * 1024) {
      setError('Choose a CSV smaller than 1 MB.');
      return;
    }
    try {
      const parsed = parseCsv((await file.text()).replace(/^\uFEFF/, ''));
      if (!parsed.ok) {
        setError(parsed.error);
        return;
      }
      const normalized = normalizeCompanyImport(parsed.records);
      if (normalized.error !== undefined) {
        setError(normalized.error);
        return;
      }
      setRows(normalized.rows);
    } catch {
      setError('Could not read that file. Please try again.');
    }
  }
  async function run() {
    if (pending() || !rows().length) return;
    setPending(true);
    setError('');
    const failed: { name: string; domain: string }[] = [];
    for (const row of rows()) {
      try {
        await createCompany(row);
        setCompleted((n) => n + 1);
      } catch {
        failed.push(row);
      }
    }
    setRows(failed);
    setPending(false);
    if (failed.length)
      setError(
        `${failed.length} could not be imported. They may already exist or use an unsupported domain. Successful rows will not be retried.`
      );
  }
  return { rows, error, pending, completed, read, run };
}
