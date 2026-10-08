// In-memory ring buffer of the last API calls. NEVER stores tokens, passwords or headers.
// Used by Settings → Diagnostics to show/export what the server really answered.
export type DiagEntry = {
  t: string; // ISO time
  method: string;
  path: string; // no query string
  status: number | string;
  ms: number;
  note?: string; // short server message on failure
};

const MAX = 80;
const buf: DiagEntry[] = [];

export const diag = {
  add(e: DiagEntry) {
    buf.push(e);
    if (buf.length > MAX) buf.shift();
  },
  all(): DiagEntry[] {
    return [...buf];
  },
  clear() {
    buf.length = 0;
  },
  dump(header: string[] = []): string {
    const lines = buf.map(
      (e) =>
        `${e.t}  ${e.method.padEnd(6)} ${String(e.status).padEnd(5)} ${String(e.ms).padStart(5)}ms  ${e.path}` +
        (e.note ? `  → ${e.note}` : '')
    );
    return [...header, '', ...lines].join('\n');
  },
};
