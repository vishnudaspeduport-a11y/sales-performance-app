import { CallLogArchive } from '../components/CallLogArchive';
import { DataTable } from '../components/DataTable';
import { isSnapshotHost } from '../lib/api';
import type { Analytics } from '../state/useAnalytics';

export function RawDataPage({ a }: { a: Analytics }) {
  return (
    <div className="space-y-4">
      {a.dataset.meta.notes?.length > 0 && (
        <div className="rounded-lg border border-line bg-surface px-4 py-3 text-xs text-ink-secondary dark:border-line-dark dark:bg-surface-dark dark:text-ink-dark-secondary">
          <div className="mb-1 font-medium text-ink dark:text-ink-dark">Data source notes</div>
          <ul className="list-disc space-y-0.5 pl-4">{a.dataset.meta.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
        </div>
      )}
      <DataTable dataset={a.dataset} records={a.records} range={a.range} />
      {!isSnapshotHost() && <CallLogArchive />}
    </div>
  );
}
