import axios, { AxiosInstance } from 'axios';
import type { ConnectionConfig, GlpiSession, GlpiTicket } from '../types/glpi';
import { ASSET_DEFINITION_TYPES, GLPI_API_PATH } from '../config/settings';
import { diag } from '../diagnostics';
import { cache } from '../cache';

/** "First Last", each word capitalised (GLPI stores surname in realname, given name in firstname). */
export function formatPersonName(first?: unknown, last?: unknown): string {
  const words = [first, last]
    .map((x) => (x == null ? '' : String(x).trim()))
    .filter(Boolean)
    .join(' ')
    .split(/\s+/)
    .filter(Boolean);
  const seen = new Set<string>();
  return words
    .filter((w) => (seen.has(w.toLowerCase()) ? false : (seen.add(w.toLowerCase()), true)))
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** The stock plugin answered with an error message (as opposed to being unreachable). */
function PluginAnswerError(message: string): Error {
  const e = new Error(message) as Error & { isPluginAnswer?: boolean };
  e.isPluginAnswer = true;
  return e;
}

export type StockPart = {
  id: number;
  name: string;
  stock: number;
  ref?: string;
  warehouses?: { id: number; name: string; qty: number }[];
};

export type StockTool = {
  id: number;
  name: string;
  itemtype: string;
  serial?: string;
  status?: string;
  onThisTicket?: boolean;
};

export type GlpiAssetRow = {
  id: number;
  name: string;
  serial?: string;
  otherserial?: string;
  locations_id?: number;
  location_name?: string;
  entities_id?: number;
  entity_name?: string;
  states_id?: number;
  status_name?: string;
  itemtype: string;
  type_label: string;
};

export type GlpiTaskRow = {
  id: number;
  content: string;
  date?: string;
  state?: number; // 1 = to do, 2 = done
  author?: string;
};

export type GlpiTicketDocument = {
  id: number;
  name: string;
  filename?: string;
  mime?: string;
  date?: string;
};

export type GlpiSolutionRow = {
  id: number;
  content: string;
  status?: number;
  date?: string;
  author?: string;
};

export type GlpiTicketDetails = GlpiTicket & {
  location_name?: string;
  locations_id?: number;
  status_label?: string;
  assigned_names: string[];
  tasks: GlpiTaskRow[];
  linked_assets: { itemtype: string; items_id: number; name: string; serial?: string }[];
  solutions: string[];
  solutionRows: GlpiSolutionRow[];
  followups: { id?: number; date?: string; content: string; author?: string }[];
  documents: GlpiTicketDocument[];
  requester_name?: string;
  satisfaction?: { satisfaction?: number; comment?: string } | null;
};

export type TaskTemplate = {
  id: number;
  name: string;
  content: string;
  taskcategories_id?: number;
  actiontime?: number;
  state?: number;
  is_private?: number;
};
export type SolutionTemplate = {
  id: number;
  name: string;
  content: string;
  solutiontypes_id?: number;
};
export type StaffCaps = { isStaff: boolean; profile?: string; iface?: string };

export const STATUS_LABELS: Record<number, string> = {
  1: 'New',
  2: 'Assigned',
  3: 'Planned',
  4: 'Pending',
  5: 'Solved',
  6: 'Closed',
};

/** True when asset is considered down / out of service */
export function isAssetDown(statusName?: string, statesId?: number): boolean {
  const n = (statusName || '').toLowerCase();
  if (!n) return false;
  return /down|out of service|out-of-service|non.?op|inactive|broken|fault|not in use|retired|disposal/.test(
    n
  );
}

export function isAssetActive(statusName?: string): boolean {
  const n = (statusName || '').toLowerCase();
  if (!n) return true; // unknown → treat as active (green)
  if (isAssetDown(statusName)) return false;
  return /active|in use|in-use|production|ok|operational|available/.test(n) || !isAssetDown(statusName);
}


export class GlpiClient {
  private http: AxiosInstance;
  private sessionToken: string | null = null;
  private appToken: string;
  private baseUrl: string;

  constructor(config: ConnectionConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.appToken = config.appToken || '';
    this.http = axios.create({
      baseURL: this.baseUrl + GLPI_API_PATH,
      timeout: 60000,
      headers: {
        'Content-Type': 'application/json',
        ...(this.appToken ? { 'App-Token': this.appToken } : {}),
      },
    });
    this.installInterceptors();
  }

  /** Timing log for Diagnostics + readable server messages instead of "status code 400". */
  private installInterceptors() {
    const pathOf = (cfg: { baseURL?: string; url?: string } | undefined) =>
      String(cfg?.url || '').split('?')[0].slice(0, 120);
    const started = (cfg: unknown) => (cfg as { __t0?: number })?.__t0 || Date.now();

    this.http.interceptors.request.use((cfg) => {
      (cfg as unknown as { __t0: number }).__t0 = Date.now();
      return cfg;
    });

    this.http.interceptors.response.use(
      (res) => {
        const body = res.status >= 400 ? briefBody(res.data) : undefined;
        diag.add({
          t: new Date().toISOString(),
          method: String(res.config?.method || 'get').toUpperCase(),
          path: pathOf(res.config),
          status: res.status,
          ms: Date.now() - started(res.config),
          note: body,
        });
        return res;
      },
      (err) => {
        const res = err?.response;
        const note = res ? briefBody(res.data) : String(err?.code || err?.message || 'network');
        diag.add({
          t: new Date().toISOString(),
          method: String(err?.config?.method || 'get').toUpperCase(),
          path: pathOf(err?.config),
          status: res?.status ?? 'ERR',
          ms: Date.now() - started(err?.config),
          note,
        });
        if (!res) {
          err.isNetworkError = true;
          err.message = 'No connection to the server. Check your internet and try again.';
        } else if (res.status === 401) {
          err.message = 'Your session expired. Sign out and sign in again.';
        } else if (res.status >= 400) {
          const detail = humanServerMessage(res.data);
          err.message = detail
            ? `Server rejected the request (HTTP ${res.status}): ${detail}`
            : `Server rejected the request (HTTP ${res.status}).`;
        }
        return Promise.reject(err);
      }
    );
  }

  /** Quick health check for Settings (valid session + latency). */
  async ping(): Promise<{ ok: boolean; ms: number; error?: string }> {
    const t0 = Date.now();
    try {
      await this.http.get('/getActiveProfile', { headers: this.h(), timeout: 15000 });
      return { ok: true, ms: Date.now() - t0 };
    } catch (e) {
      return { ok: false, ms: Date.now() - t0, error: e instanceof Error ? e.message : String(e) };
    }
  }

  private capsPromise: Promise<StaffCaps> | null = null;

  /**
   * Who is this account? Technician-type profiles get task / solution / assign / stock tools,
   * Requester (helpdesk) profiles get a simple screen. Heuristic on the profile's rights;
   * if the rights cannot be read we assume staff so nothing is hidden by mistake.
   */
  getCapabilities(): Promise<StaffCaps> {
    if (!this.capsPromise) {
      this.capsPromise = (async (): Promise<StaffCaps> => {
        try {
          const { data } = await this.http.get('/getFullSession', { headers: this.h() });
          const sess = (data?.session ?? data ?? {}) as Record<string, unknown>;
          const prof = (sess.glpiactiveprofile ?? {}) as Record<string, unknown>;
          const num = (k: string) => Number(prof[k] ?? 0) || 0;
          const iface = String(prof.interface ?? '');
          const staff =
            iface !== 'helpdesk' &&
            ((num('task') & ~1) !== 0 || (num('followup') & ~1) !== 0 || (num('ticket') & 2) !== 0);
          return { isStaff: staff, profile: prof.name ? String(prof.name) : undefined, iface };
        } catch {
          return { isStaff: true };
        }
      })();
    }
    return this.capsPromise;
  }

  /** Active profile name + every non-zero numeric right. GLPI bits: 1 read, 2 update, 4 create, 8 delete. */
  async getMyRights(): Promise<{ profile?: string; rights: Record<string, number> }> {
    const { data } = await this.http.get('/getFullSession', { headers: this.h() });
    const sess = (data?.session ?? data ?? {}) as Record<string, unknown>;
    const prof = (sess.glpiactiveprofile ?? {}) as Record<string, unknown>;
    const always = ['ticket', 'followup', 'document'];
    const rights: Record<string, number> = {};
    for (const [k, v] of Object.entries(prof)) {
      const n = typeof v === 'number' ? v : typeof v === 'string' && v !== '' ? Number(v) : NaN;
      if (Number.isNaN(n)) continue;
      if (n !== 0 || always.includes(k)) rights[k] = n;
    }
    const names = Object.keys(rights).sort();
    const sorted: Record<string, number> = {};
    for (const k of names) sorted[k] = rights[k];
    return { profile: prof.name ? String(prof.name) : undefined, rights: sorted };
  }

  getWebBaseUrl() {
    return this.baseUrl;
  }

  setSessionToken(token: string | null) {
    this.sessionToken = token;
  }

  getSessionToken() {
    return this.sessionToken;
  }

  getAppToken() {
    return this.appToken;
  }

  /** User-facing message when API returns ERROR_GLPI_* permission */
  private friendlyPermissionError(data: unknown, action: string): Error {
    const raw = typeof data === 'string' ? data : JSON.stringify(data ?? '');
    if (/permission|ERROR_GLPI_(ADD|UPDATE|DELETE|CREATE)/i.test(raw)) {
      return new Error(
        `No permission to ${action}. ` +
          'Ask admin (Administration → Profiles → your profile) to allow: ' +
          'Tickets (update / status / followup), Documents (create), and Solution validation if used.'
      );
    }
    if (raw && raw !== 'null' && raw !== '{}') {
      return new Error(`${action} failed: ${raw.slice(0, 180)}`);
    }
    return new Error(`${action} failed (server rejected the request).`);
  }

  private h() {
    if (!this.sessionToken) throw new Error('Not logged in');
    return {
      'Session-Token': this.sessionToken,
      ...(this.appToken ? { 'App-Token': this.appToken } : {}),
    };
  }

  async initSession(login: string, password: string): Promise<GlpiSession> {
    const basic =
      typeof btoa !== 'undefined'
        ? btoa(`${login}:${password}`)
        : Buffer.from(`${login}:${password}`).toString('base64');
    const { data } = await this.http.get('/initSession', {
      headers: {
        Authorization: `Basic ${basic}`,
        ...(this.appToken ? { 'App-Token': this.appToken } : {}),
      },
      params: { get_full_session: true },
    });
    // Normalize token to string (some hosts return nested / non-string shapes)
    const raw =
      data?.session_token ??
      data?.sessionToken ??
      (typeof data === 'string' ? data : null);
    const token =
      typeof raw === 'string'
        ? raw.trim()
        : raw != null
          ? String(raw).trim()
          : '';
    if (!token) {
      throw new Error(
        'No session_token in API response. Verify App-Token and that the URL ends at the site root (not /apirest.php).'
      );
    }
    this.sessionToken = token;
    return { ...data, session_token: token };
  }

  async killSession(): Promise<void> {
    if (!this.sessionToken) return;
    try {
      await this.http.get('/killSession', { headers: this.h() });
    } finally {
      this.sessionToken = null;
    }
  }

  async getMyTickets(range = '0-99', preferAssignedUserId?: number): Promise<GlpiTicket[]> {
    const forced = {
      'forcedisplay[0]': 1,  // name
      'forcedisplay[1]': 2,  // id
      'forcedisplay[2]': 12, // status
      'forcedisplay[3]': 3,  // priority
      'forcedisplay[4]': 15, // date
      'forcedisplay[5]': 5,  // assigned tech (when available)
      'forcedisplay[6]': 83, // location / ward
      sort: 2,
      order: 'DESC',
    };

    const fromSearch = async (extra: Record<string, unknown> = {}) => {
      const { data, status } = await this.http.get('/search/Ticket', {
        headers: this.h(),
        params: { range, ...forced, ...extra },
        validateStatus: (s) => s < 500,
      });
      if (status >= 400 || !data?.data) return [] as GlpiTicket[];
      const rows = Array.isArray(data.data)
        ? data.data
        : (Object.values(data.data) as Record<string, unknown>[]);
      return rows
        .map((r) => normalizeTicket(r as Record<string, unknown>))
        .filter((t) => t.id > 0);
    };

    // Primary: search API (reliable field ids on GLPI 11)
    let tickets = await fromSearch();

    // Fallback: classic list endpoint
    if (!tickets.length) {
      try {
        const { data } = await this.http.get('/Ticket', {
          headers: this.h(),
          params: { range, expand_dropdowns: true },
        });
        const rows = Array.isArray(data)
          ? data
          : Array.isArray(data?.data)
            ? data.data
            : data && typeof data === 'object'
              ? (Object.values(data) as Record<string, unknown>[])
              : [];
        tickets = rows
          .map((r) => normalizeTicket(r as Record<string, unknown>))
          .filter((t) => t.id > 0);
      } catch {
        /* empty */
      }
    }

    tickets.sort((a, b) => {
      if (b.id !== a.id) return b.id - a.id;
      return String(b.date || '').localeCompare(String(a.date || ''));
    });

    // Pin tickets assigned to current user first
    if (preferAssignedUserId && /^0-/.test(range)) {
      try {
        const assigned = await fromSearch({
          'criteria[0][field]': 5,
          'criteria[0][searchtype]': 'equals',
          'criteria[0][value]': preferAssignedUserId,
          range: '0-50',
        });
        if (assigned.length) {
          const seen = new Set(assigned.map((t) => t.id));
          const rest = tickets.filter((t) => !seen.has(t.id));
          tickets = [
            ...assigned.sort((a, b) => b.id - a.id),
            ...rest,
          ];
        }
      } catch {
        /* keep default */
      }
    }

    return tickets;
  }

  async getTicket(id: number): Promise<GlpiTicketDetails> {
    const { data } = await this.http.get(`/Ticket/${id}`, {
      headers: this.h(),
      params: { expand_dropdowns: true },
    });
    const base = normalizeTicket(data);

    let location_name: string | undefined;
    if (typeof data.locations_id === 'string' && data.locations_id && Number.isNaN(Number(data.locations_id))) {
      location_name = data.locations_id;
    } else {
      const lid = Number(data.locations_id ?? 0);
      if (lid > 0) location_name = await this.resolveName('Location', lid);
    }

    const [assigned_names, requester_name] = await Promise.all([
      this.getAssignees(id),
      this.tryRelation(id, 'Ticket_User')
        .then(async (rows) => {
          const r = rows.find((x) => Number(x.type) === 1 && Number(x.users_id));
          return r ? this.resolveName('User', Number(r.users_id)) : undefined;
        })
        .catch(() => undefined),
    ]);

    let taskRows = await this.tryRelation(id, 'TicketTask');
    if (!taskRows.length) taskRows = await this.searchByTicketId('TicketTask', id);
    const tasks: GlpiTaskRow[] = await Promise.all(
      taskRows.map(async (r) => ({
        id: Number(r.id),
        content: stripHtml(String(r.content ?? '')),
        date: r.date ? String(r.date) : r.date_creation ? String(r.date_creation) : undefined,
        state: r.state != null ? Number(r.state) : undefined,
        author: await this.authorOf({ users_id: r.users_id_tech || r.users_id }),
      }))
    );

    // Parallel loads (same spirit as fast 1.0.4 path — avoid sequential waits)
    const [linked_assets, solutionRows, followups, documents, satisfaction] =
      await Promise.all([
        this.getLinkedAssets(id).catch(() => [] as { itemtype: string; items_id: number; name: string; serial?: string }[]),
        this.getSolutionRows(id).catch(() => [] as GlpiSolutionRow[]),
        this.getFollowups(id).catch(() => [] as { date?: string; content: string }[]),
        this.getTicketDocuments(id).catch(() => [] as GlpiTicketDocument[]),
        // Satisfaction only relevant after solved/closed — skip extra API call otherwise
        base.status >= 5
          ? this.getTicketSatisfaction(id).catch(() => null)
          : Promise.resolve(null),
      ]);
    const solutions = solutionRows.map((s) => s.content).filter(Boolean);

    return {
      ...base,
      locations_id: Number(data.locations_id) || undefined,
      location_name,
      status_label: STATUS_LABELS[base.status] || `Status ${base.status}`,
      assigned_names,
      requester_name,
      tasks,
      linked_assets,
      solutions,
      solutionRows,
      followups,
      documents,
      satisfaction,
    };
  }

  private async getAssignees(ticketId: number): Promise<string[]> {
    const [users, groups] = await Promise.all([
      this.tryRelation(ticketId, 'Ticket_User').catch(() => []),
      this.tryRelation(ticketId, 'Group_Ticket').catch(() => []),
    ]);
    const jobs: Promise<string | undefined>[] = [];
    for (const r of users) {
      if (Number(r.type) === 2 && Number(r.users_id)) jobs.push(this.resolveName('User', Number(r.users_id)));
    }
    for (const r of groups) {
      if (Number(r.type) === 2 && Number(r.groups_id)) jobs.push(this.resolveName('Group', Number(r.groups_id)));
    }
    const names = await Promise.all(jobs);
    return names.filter((n): n is string => !!n);
  }

  /** Resolve the author name of a row (users_id) — names are cached, so this is cheap. */
  private async authorOf(r: Record<string, unknown>): Promise<string | undefined> {
    const uid = Number(r.users_id ?? r.users_id_editor ?? 0);
    if (!uid) return undefined;
    return this.resolveName('User', uid);
  }

  private async getFollowups(ticketId: number) {
    let rows = await this.tryRelation(ticketId, 'ITILFollowup');
    if (!rows.length) rows = await this.searchByTicketId('ITILFollowup', ticketId, true);
    return Promise.all(
      rows.map(async (r) => ({
        id: Number(r.id) || undefined,
        date: r.date ? String(r.date) : r.date_creation ? String(r.date_creation) : undefined,
        content: stripHtml(String(r.content ?? '')),
        author: await this.authorOf(r),
      }))
    );
  }


  /** Assets linked to a ticket via Item_Ticket */
  private async getLinkedAssets(
    ticketId: number
  ): Promise<{ itemtype: string; items_id: number; name: string; serial?: string }[]> {
    const out: { itemtype: string; items_id: number; name: string; serial?: string }[] = [];
    try {
      let rows = await this.tryRelation(ticketId, 'Item_Ticket');
      if (!rows.length) {
        try {
          const { data, status } = await this.http.get('/search/Item_Ticket', {
            headers: this.h(),
            params: {
              range: '0-50',
              'criteria[0][field]': 3, // tickets_id often
              'criteria[0][searchtype]': 'equals',
              'criteria[0][value]': ticketId,
              forcedisplay: [1, 2, 3, 4, 5],
            },
            validateStatus: (s) => s < 500,
          });
          if (status < 400 && data?.data) {
            rows = Array.isArray(data.data)
              ? data.data
              : (Object.values(data.data) as Record<string, unknown>[]);
          }
        } catch {
          /* ignore */
        }
      }
      if (!rows.length) {
        try {
          const { data, status } = await this.http.get('/Item_Ticket', {
            headers: this.h(),
            params: { range: '0-300', expand_dropdowns: false },
            validateStatus: (s) => s < 500,
          });
          if (status < 400) {
            const all = Array.isArray(data) ? data : data?.data || [];
            rows = (all as Record<string, unknown>[]).filter(
              (r) => Number(r.tickets_id) === ticketId
            );
          }
        } catch {
          /* ignore */
        }
      }

      const resolved = await Promise.all(
        rows.map(async (r) => {
          const itemtype = String(r.itemtype ?? r['4'] ?? '');
          const items_id = Number(r.items_id ?? r['5'] ?? r['2'] ?? 0);
          if (!itemtype || !items_id) return null;
          let name = `${itemtype} #${items_id}`;
          let serial: string | undefined;
          try {
            const raw = await this.getItemRaw(itemtype, items_id);
            if (raw) {
              name = String(raw.name ?? raw.completename ?? name);
              if (raw.serial) serial = String(raw.serial);
            }
          } catch {
            /* keep fallback name */
          }
          return { itemtype, items_id, name, serial };
        })
      );
      for (const it of resolved) {
        if (!it) continue;
        const low = it.name.toLowerCase().trim();
        if (low === 'report an issue' || low.startsWith('report an issue')) continue;
        if ((!it.serial || it.serial === '—' || it.serial === '-') && /report|issue/.test(low)) continue;
        out.push(it);
      }
    } catch {
      /* return what we have */
    }
    return out;
  }

  private async getSolutionRows(ticketId: number): Promise<GlpiSolutionRow[]> {
    let rows = await this.tryRelation(ticketId, 'ITILSolution');
    if (!rows.length) rows = await this.searchByTicketId('ITILSolution', ticketId, true);
    const mapped = await Promise.all(
      rows.map(async (r) => ({
        id: Number(r.id),
        content: stripHtml(String(r.content ?? '')),
        status: r.status != null ? Number(r.status) : undefined,
        date: r.date_creation ? String(r.date_creation) : r.date_mod ? String(r.date_mod) : undefined,
        author: await this.authorOf(r),
      }))
    );
    return mapped.filter((s) => s.content.length > 0 || s.id > 0);
  }

  async getTicketDocuments(ticketId: number): Promise<GlpiTicketDocument[]> {
    try {
      const links = await this.tryRelation(ticketId, 'Document_Item');
      const docs = await Promise.all(
        links.map(async (link): Promise<GlpiTicketDocument | null> => {
          const docId = Number(link.documents_id ?? link.items_id ?? 0);
          if (!docId) return null;
          try {
            const { data } = await this.http.get(`/Document/${docId}`, { headers: this.h() });
            return {
              id: docId,
              name: String(data.name || data.filename || `Document ${docId}`),
              filename: data.filename ? String(data.filename) : undefined,
              mime: data.mime ? String(data.mime) : undefined,
              date: data.date_creation ? String(data.date_creation) : data.date_mod ? String(data.date_mod) : undefined,
            };
          } catch {
            return { id: docId, name: `Document ${docId}` };
          }
        })
      );
      return docs.filter((d): d is GlpiTicketDocument => !!d);
    } catch {
      return [];
    }
  }

  async getTicketSatisfaction(ticketId: number): Promise<{ satisfaction?: number; comment?: string } | null> {
    try {
      const rows = await this.tryRelation(ticketId, 'TicketSatisfaction');
      if (rows.length) {
        const r = rows[0];
        return {
          satisfaction: r.satisfaction != null ? Number(r.satisfaction) : undefined,
          comment: r.comment ? String(r.comment) : undefined,
        };
      }
      const { data, status } = await this.http.get(`/Ticket/${ticketId}/TicketSatisfaction`, {
        headers: this.h(),
        validateStatus: (s) => s < 500,
      });
      if (status < 400 && data) {
        const r = Array.isArray(data) ? data[0] : data;
        if (r) {
          return {
            satisfaction: r.satisfaction != null ? Number(r.satisfaction) : undefined,
            comment: r.comment ? String(r.comment) : undefined,
          };
        }
      }
    } catch {
      /* ignore */
    }
    return null;
  }

  /** Error for a failed bridge call. `canOpenBrowser` lets the screen offer the web page as a fallback. */
  private approvalFailure(
    b: { missing?: boolean; data?: { error?: string }; note: string },
    action: 'approve' | 'refuse'
  ): Error {
    const verb = action === 'approve' ? 'approve' : 'refuse';
    const e = new Error(
      b.missing
        ? `Your profile cannot ${verb} through the app API, and the server helper (requester-bridge.php) is not installed. ` +
          'You can still do it in the browser, or ask your admin to install the helper.'
        : b.data?.error || b.note
    ) as Error & { canOpenBrowser?: boolean };
    e.canOpenBrowser = true;
    return e;
  }

  /**
   * The browser's "Approval of the solution" box (Comments + Approve / Refuse) is a follow-up
   * with a close / reopen flag — GLPI core developers describe the API equivalent as
   * POST /ITILFollowup with add_close=1 (approve) or add_reopen=1 (refuse).
   */
  private async approvalViaFollowup(
    ticketId: number,
    action: 'approve' | 'refuse',
    comment: string
  ): Promise<{ ok: boolean; error?: Error }> {
    const flags =
      action === 'approve' ? { add_close: 1, _close: 1 } : { add_reopen: 1, _reopen: 1 };
    const { status, data } = await this.http.post(
      '/ITILFollowup',
      { input: { itemtype: 'Ticket', items_id: ticketId, content: comment, is_private: 0, ...flags } },
      { headers: this.h(), validateStatus: (s) => s < 500 }
    );
    if (status < 400) return { ok: true };
    return {
      ok: false,
      error: this.friendlyPermissionError(
        data,
        action === 'approve' ? 'approve the solution' : 'refuse the solution'
      ),
    };
  }

  /**
   * Requester approves the solution — same route as the browser's Approve button
   * (follow-up with add_close), then older fallbacks. Failures are reported honestly:
   * nothing is written to the ticket unless GLPI accepted it.
   */
  async approveTicketSolution(ticketId: number): Promise<{ closed: boolean; message: string }> {
    const isPermission = (data: unknown) =>
      /permission|ERROR_GLPI_(ADD|UPDATE|DELETE|CREATE)/i.test(
        typeof data === 'string' ? data : JSON.stringify(data ?? '')
      );

    // 0) Same as the browser: follow-up with the "close" flag (this is what the Approve button posts)
    let firstErr: Error | null = null;
    try {
      const r = await this.approvalViaFollowup(
        ticketId,
        'approve',
        'Solution approved by the requester (mobile app).'
      );
      if (r.ok) {
        let closed = false;
        try {
          const { data: t } = await this.http.get(`/Ticket/${ticketId}`, { headers: this.h() });
          closed = Number(t?.status) === 6;
        } catch {
          /* status check is informational */
        }
        return {
          closed,
          message: closed
            ? 'Solution approved and ticket closed.'
            : 'Solution approved. The ticket will close according to your GLPI settings.',
        };
      }
      firstErr = r.error || null;
    } catch (e) {
      firstErr = e instanceof Error ? e : null;
    }

    // Requester profiles are refused on every REST route (followup / ticket / solution update),
    // yet the browser allows it. Do it through the server bridge, which verifies the requester.
    if (firstErr && /^No permission/i.test(firstErr.message)) {
      const b = await this.bridgeCall('approve', {
        ticket_id: ticketId,
        comment: 'Approved from the mobile app.',
      });
      if (b.ok) {
        return {
          closed: !!b.data?.closed,
          message: b.data?.closed
            ? 'Solution approved and ticket closed.'
            : 'Solution approved. The ticket will close according to your GLPI settings.',
        };
      }
      throw this.approvalFailure(b, 'approve');
    }

    // 1) Older fallback: accept flag on the ticket (stop early on a permission error)
    const ACCEPT_ATTEMPTS: Record<string, unknown>[] = [
      { input: { status: 6, _accepted: true } },
      { input: { id: ticketId, status: 6, _accepted: 1 } },
    ];
    let lastErr: Error | null = null;
    for (const body of ACCEPT_ATTEMPTS) {
      const { status, data } = await this.http.put(`/Ticket/${ticketId}`, body, {
        headers: this.h(),
        validateStatus: (s) => s < 500,
      });
      if (status < 400) {
        return { closed: true, message: 'Solution approved and ticket closed.' };
      }
      lastErr = this.friendlyPermissionError(data, 'approve the solution');
      if (isPermission(data)) break; // another body shape will not change a rights problem
    }

    // 2) Accept the latest ITILSolution (status 3 = accepted); GLPI then closes the ticket itself
    try {
      const rows = (await this.getSolutionRows(ticketId)).filter((r) => r.id > 0);
      const latest = rows.sort((a, b) => b.id - a.id)[0];
      if (latest) {
        const { status } = await this.http.put(
          `/ITILSolution/${latest.id}`,
          { input: { status: 3 } },
          { headers: this.h(), validateStatus: (s) => s < 500 }
        );
        if (status < 400) {
          const { data: t } = await this.http.get(`/Ticket/${ticketId}`, { headers: this.h() });
          const closed = Number(t?.status) === 6;
          return {
            closed,
            message: closed
              ? 'Solution approved and ticket closed.'
              : 'Solution accepted. The ticket will close according to your GLPI settings.',
          };
        }
      }
    } catch {
      /* fall through to the error below */
    }

    throw (
      firstErr ||
      lastErr ||
      new Error(
        'Could not approve the solution. Use the same Requester account that opened the ticket and ask your admin to allow solution approval on your profile.'
      )
    );
  }

  /** Requester rejects the solution → ticket goes back to work. */
  async rejectTicketSolution(ticketId: number, note?: string): Promise<void> {
    const text =
      (note && note.trim()) ||
      'Requester refused the solution and requested more work (mobile app).';

    // Same as the browser's Refuse button: follow-up with the "reopen" flag
    let firstErr: Error | null = null;
    try {
      const r = await this.approvalViaFollowup(ticketId, 'refuse', text);
      if (r.ok) return; // the comment is already the refusal reason
      firstErr = r.error || null;
    } catch (e) {
      firstErr = e instanceof Error ? e : null;
    }

    if (firstErr && /^No permission/i.test(firstErr.message)) {
      const b = await this.bridgeCall('refuse', { ticket_id: ticketId, comment: text });
      if (b.ok) return;
      throw this.approvalFailure(b, 'refuse');
    }

    const bodies: Record<string, unknown>[] = [
      { input: { status: 2, _refused: true } },
      { input: { status: 4, _refused: true } },
      { input: { status: 2 } },
    ];
    let ok = false;
    let lastErr: Error | null = null;
    for (const body of bodies) {
      const { status, data } = await this.http.put(`/Ticket/${ticketId}`, body, {
        headers: this.h(),
        validateStatus: (s) => s < 500,
      });
      if (status < 400) {
        ok = true;
        break;
      }
      lastErr = this.friendlyPermissionError(data, 'refuse the solution / reopen the ticket');
      if (/permission|ERROR_GLPI_(ADD|UPDATE)/i.test(JSON.stringify(data ?? ''))) break;
    }
    if (!ok) throw firstErr || lastErr || new Error('Could not reopen the ticket — check Requester profile rights.');

    // Only record the reason once GLPI actually accepted the change
    try {
      await this.addTicketFollowup(ticketId, text);
    } catch {
      /* the reopen already worked */
    }
  }

  /** Satisfaction survey 1–5 (GLPI TicketSatisfaction) */
  async submitTicketSatisfaction(
    ticketId: number,
    rating: number,
    comment?: string
  ): Promise<void> {
    const score = Math.max(1, Math.min(5, Math.round(rating)));
    try {
      await this.http.post(
        '/TicketSatisfaction',
        {
          input: {
            tickets_id: ticketId,
            satisfaction: score,
            comment: comment || '',
          },
        },
        { headers: this.h() }
      );
    } catch {
      await this.http.put(
        `/Ticket/${ticketId}/TicketSatisfaction`,
        {
          input: {
            tickets_id: ticketId,
            satisfaction: score,
            comment: comment || '',
          },
        },
        { headers: this.h(), validateStatus: (s) => s < 500 }
      );
    }
  }

  async getSessionUserId(): Promise<number> {
    try {
      const { data } = await this.http.get('/getFullSession', { headers: this.h() });
      const sess = (data?.session || data || {}) as Record<string, unknown>;
      const id =
        Number(sess.glpiID ?? sess.glpi_id ?? 0) ||
        Number((sess as any).user?.id ?? 0);
      // glpi stores glpiID in session
      if (id > 0) return id;
      const nested = sess as { glpiID?: number };
      return Number(nested.glpiID ?? 0);
    } catch {
      return 0;
    }
  }

  documentDownloadUrl(documentId: number): string {
    return `${this.baseUrl}/apirest.php/Document/${documentId}?alt=media`;
  }

  /** Readable text from a GLPI error body: ["ERROR_GLPI_ADD","message"] / {message} / plain text. */
  private glpiErrorText(data: unknown): string {
    try {
      if (Array.isArray(data)) return data.slice(1).map(String).join(' ') || String(data[0] ?? '');
      if (data && typeof data === 'object') {
        const o = data as Record<string, unknown>;
        return String(o.message ?? o.error ?? JSON.stringify(o)).slice(0, 220);
      }
      return String(data ?? '').replace(/<[^>]+>/g, ' ').trim().slice(0, 220);
    } catch {
      return '';
    }
  }

  private guessMime(name: string, given?: string): string {
    if (given && given !== 'application/octet-stream') return given;
    const ext = (name.split('.').pop() || '').toLowerCase();
    const map: Record<string, string> = {
      jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
      heic: 'image/heic', pdf: 'application/pdf', txt: 'text/plain', csv: 'text/csv',
      doc: 'application/msword',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xls: 'application/vnd.ms-excel',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      zip: 'application/zip', mp4: 'video/mp4',
    };
    return map[ext] || given || 'application/octet-stream';
  }

  /**
   * Upload a file / photo and attach it to a ticket. Returns the new document id.
   *
   * v1.0.26: uses fetch() instead of axios. The axios instance defaults to Content-Type: application/json,
   * and on React Native that header was sent together with the multipart body, so the server could not read
   * the file ("issues while attaching pictures or files"). fetch() lets the phone set the multipart boundary.
   * The document is linked to the ticket in the same request (items_id / itemtype); a separate link call is
   * only made if the server did not link it.
   */
  async uploadTicketDocument(
    ticketId: number,
    file: { uri: string; name: string; mimeType?: string }
  ): Promise<number> {
    const safeName = (file.name || `upload_${Date.now()}.jpg`).replace(/[^\w.\-()+ ]+/g, '_');
    const mime = this.guessMime(safeName, file.mimeType);
    const t0 = Date.now();

    const form = new FormData();
    form.append(
      'uploadManifest',
      JSON.stringify({
        input: { name: safeName, _filename: [safeName], items_id: ticketId, itemtype: 'Ticket' },
      })
    );
    form.append('filename[0]', { uri: file.uri, name: safeName, type: mime } as unknown as Blob);

    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), 180000) : null;
    let status = 0;
    let data: unknown = null;
    try {
      const res = await fetch(`${this.baseUrl}${GLPI_API_PATH}/Document/`, {
        method: 'POST',
        headers: { ...this.h(), Accept: 'application/json' }, // NO Content-Type: the phone adds the boundary
        body: form as unknown as BodyInit,
        signal: ctrl?.signal,
      });
      status = res.status;
      const text = await res.text();
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = text;
      }
    } catch (e: unknown) {
      diag.add({ t: new Date().toISOString(), method: 'POST', path: '/Document/', status: 'ERR', ms: Date.now() - t0, note: String(e) });
      const aborted = e instanceof Error && e.name === 'AbortError';
      throw new Error(
        aborted
          ? 'Upload timed out. Check the connection or choose a smaller file.'
          : 'Could not reach the server to upload the file. Check your internet and try again.'
      );
    } finally {
      if (timer) clearTimeout(timer);
    }
    diag.add({
      t: new Date().toISOString(), method: 'POST', path: '/Document/', status, ms: Date.now() - t0,
      note: status >= 400 ? this.glpiErrorText(data) : undefined,
    });

    if (status === 401) throw new Error('Your session expired. Sign out and sign in again.');
    if (status === 413) throw new Error('The file is too big for the server. Choose a smaller file or lower the photo quality in Settings.');
    if (status >= 400) {
      const detail = this.glpiErrorText(data);
      if (/ERROR_RIGHT_MISSING|permission|right/i.test(detail + JSON.stringify(data ?? ''))) {
        throw this.friendlyPermissionError(data, 'upload files (Documents → Create on your profile)');
      }
      throw new Error(`Upload failed (HTTP ${status})${detail ? ': ' + detail : ''}`);
    }

    let docId = 0;
    const d = data as Record<string, unknown> | unknown[] | number | null;
    if (typeof d === 'number') docId = d;
    else if (Array.isArray(d)) docId = Number((d[0] as { id?: number })?.id ?? d[0] ?? 0) || 0;
    else if (d && typeof d === 'object') {
      docId = Number((d as { id?: number }).id ?? 0) || 0;
      if (!docId) {
        for (const v of Object.values(d)) {
          if (typeof v === 'number' && v > 0) { docId = v; break; }
          if (v && typeof v === 'object' && Number((v as { id?: number }).id) > 0) { docId = Number((v as { id: number }).id); break; }
        }
      }
    }
    if (!docId) {
      throw new Error(`The server did not accept the file${this.glpiErrorText(data) ? ': ' + this.glpiErrorText(data) : '. The file type may not be allowed on the server (Setup → Dropdowns → Document types).'}`);
    }

    // Was it linked in the same request? If not, link it now.
    const verifyLink = async () => {
    let linked = false;
    try {
      const { data: items, status: st } = await this.http.get(`/Document/${docId}/Document_Item`, {
        headers: this.h(),
        params: { range: '0-50' },
        validateStatus: (x) => x < 500,
      });
      if (st < 400 && Array.isArray(items)) {
        linked = items.some(
          (r: Record<string, unknown>) => String(r.itemtype) === 'Ticket' && Number(r.items_id) === ticketId
        );
      }
    } catch {
      /* unknown → try to link */
    }
    if (!linked) {
      const link = await this.http.post(
        '/Document_Item',
        { input: { documents_id: docId, items_id: ticketId, itemtype: 'Ticket' } },
        { headers: this.h(), validateStatus: (x) => x < 500 }
      );
      if (link.status >= 400) {
        const why = this.glpiErrorText(link.data);
        if (!/already|duplicate/i.test(why)) {
          throw new Error(`File uploaded (document #${docId}) but could not be attached to the ticket${why ? ': ' + why : ` (HTTP ${link.status})`}`);
        }
      }
    }
    };
    await verifyLink();
    cache.invalidate(`ticket:${ticketId}`);
    return docId;
  }


  private async tryRelation(ticketId: number, relation: string): Promise<Record<string, unknown>[]> {
    try {
      // Do NOT expand_dropdowns here — it turns items_id into a name string and breaks links
      const { data, status } = await this.http.get(`/Ticket/${ticketId}/${relation}`, {
        headers: this.h(),
        params: { range: '0-50' },
        validateStatus: (s) => s < 500,
      });
      if (status >= 400) return [];
      if (Array.isArray(data)) return data;
      if (data?.data && Array.isArray(data.data)) return data.data;
      return [];
    } catch {
      return [];
    }
  }

  private async searchByTicketId(
    itemtype: string,
    ticketId: number,
    useItemsId = false
  ): Promise<Record<string, unknown>[]> {
    try {
      const { data } = await this.http.get(`/${itemtype}`, {
        headers: this.h(),
        params: { range: '0-150' },
      });
      const all = Array.isArray(data) ? data : [];
      if (useItemsId) {
        return all.filter(
          (r: { itemtype?: string; items_id?: number }) =>
            String(r.itemtype ?? 'Ticket') === 'Ticket' && Number(r.items_id) === ticketId
        );
      }
      return all.filter((r: { tickets_id?: number }) => Number(r.tickets_id) === ticketId);
    } catch {
      return [];
    }
  }

  async addTicketFollowup(ticketId: number, content: string) {
    const { data, status } = await this.http.post(
      '/ITILFollowup',
      {
        input: {
          itemtype: 'Ticket',
          items_id: ticketId,
          content,
          is_private: 0,
        },
      },
      { headers: this.h(), validateStatus: (s) => s < 500 }
    );
    if (status >= 400) {
      throw this.friendlyPermissionError(data, 'post notes / follow-ups');
    }
    return data;
  }


  /** GLPI stores rich text HTML-escaped; turn it into plain text for the phone. */
  private plainText(v: unknown): string {
    return String(v ?? '')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&nbsp;/g, ' ')
      .replace(/&#0*39;|&apos;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /** Task templates (Setup → Dropdowns → Task templates), cached for an hour. */
  async listTaskTemplates(): Promise<TaskTemplate[]> {
    const key = 'tpl_task_v2';
    const hit = cache.get<TaskTemplate[]>(key);
    if (hit) return hit;
    try {
      const { data, status } = await this.http.get('/TaskTemplate', {
        headers: this.h(),
        params: { range: '0-100' },
        validateStatus: (s) => s < 500,
      });
      if (status >= 400) return cache.getStale<TaskTemplate[]>(key) || [];
      const rows = Array.isArray(data) ? data : data?.data || [];
      const out = (rows as Record<string, unknown>[])
        .map((r) => ({
          id: Number(r.id ?? 0),
          name: String(r.name ?? `Template #${r.id}`),
          content: this.plainText(r.content ?? r.comment),
          taskcategories_id: Number(r.taskcategories_id ?? 0) || undefined,
          actiontime: Number(r.actiontime ?? 0) || undefined,
          state: Number(r.state ?? 0) || undefined,
          is_private: Number(r.is_private ?? 0) || 0,
        }))
        .filter((t) => t.id > 0);
      cache.set(key, out);
      return out;
    } catch {
      return cache.getStale<TaskTemplate[]>(key) || [];
    }
  }

  /** Solution templates (Setup → Dropdowns → Solution templates), cached for an hour. */
  async listSolutionTemplates(): Promise<SolutionTemplate[]> {
    const key = 'tpl_solution_v2';
    const hit = cache.get<SolutionTemplate[]>(key);
    if (hit) return hit;
    try {
      const { data, status } = await this.http.get('/SolutionTemplate', {
        headers: this.h(),
        params: { range: '0-100' },
        validateStatus: (s) => s < 500,
      });
      if (status >= 400) return cache.getStale<SolutionTemplate[]>(key) || [];
      const rows = Array.isArray(data) ? data : data?.data || [];
      const out = (rows as Record<string, unknown>[])
        .map((r) => ({
          id: Number(r.id ?? 0),
          name: String(r.name ?? `Template #${r.id}`),
          content: this.plainText(r.content ?? r.comment),
          solutiontypes_id: Number(r.solutiontypes_id ?? 0) || undefined,
        }))
        .filter((t) => t.id > 0);
      cache.set(key, out);
      return out;
    } catch {
      return cache.getStale<SolutionTemplate[]>(key) || [];
    }
  }

  /** Add a task on a ticket (TicketTask) */
  async addTicketTask(
    ticketId: number,
    content: string,
    opts?: { state?: number; actiontime?: number; taskcategories_id?: number; is_private?: number }
  ): Promise<void> {
    const { data, status } = await this.http.post(
      '/TicketTask',
      {
        input: {
          tickets_id: ticketId,
          content,
          state: opts?.state ?? 1, // 1 = todo, 2 = done
          actiontime: opts?.actiontime ?? 0,
          ...(opts?.taskcategories_id ? { taskcategories_id: opts.taskcategories_id } : {}),
          is_private: opts?.is_private ?? 0,
        },
      },
      { headers: this.h(), validateStatus: (s) => s < 500 }
    );
    if (status >= 400) {
      throw this.friendlyPermissionError(data, 'add task');
    }
  }

  /** Mark a task done (state 2) or to do (state 1). */
  async setTaskState(taskId: number, state: 1 | 2): Promise<void> {
    const { data, status } = await this.http.put(
      `/TicketTask/${taskId}`,
      { input: { state } },
      { headers: this.h(), validateStatus: (s) => s < 500 }
    );
    if (status >= 400) throw this.friendlyPermissionError(data, 'change the task');
  }

  /** Post a solution (ITILSolution) — often sets ticket to Solved */
  async addTicketSolution(ticketId: number, content: string, solutiontypes_id?: number): Promise<void> {
    const input: Record<string, unknown> = {
      itemtype: 'Ticket',
      items_id: ticketId,
      content,
    };
    if (solutiontypes_id) input.solutiontypes_id = solutiontypes_id;
    const { data, status } = await this.http.post(
      '/ITILSolution',
      { input },
      { headers: this.h(), validateStatus: (s) => s < 500 }
    );
    if (status >= 400) {
      throw this.friendlyPermissionError(data, 'post solution');
    }
  }

  /**
   * Technician assigns themselves to the ticket (Ticket_User type 2 = assign).
   * Same idea as Gapp "Assign to me".
   */
  async assignMyselfToTicket(ticketId: number): Promise<void> {
    const uid = await this.getSessionUserId();
    if (!uid) throw new Error('Could not resolve current user id');

    // Already assigned?
    try {
      const rows = await this.tryRelation(ticketId, 'Ticket_User');
      for (const r of rows) {
        if (Number(r.users_id) === uid && Number(r.type) === 2) {
          return; // already assigned
        }
      }
    } catch {
      /* continue */
    }

    const { data, status } = await this.http.post(
      '/Ticket_User',
      {
        input: {
          tickets_id: ticketId,
          users_id: uid,
          type: 2, // assign
        },
      },
      { headers: this.h(), validateStatus: (s) => s < 500 }
    );
    if (status >= 400) {
      // Some setups want status → Assigned (2) as well
      try {
        await this.updateTicketStatus(ticketId, 2);
        return;
      } catch {
        throw this.friendlyPermissionError(data, 'assign yourself to this ticket');
      }
    }
    // Move status to Assigned if still New (one small request, not a full ticket load)
    try {
      const { data: t } = await this.http.get(`/Ticket/${ticketId}`, { headers: this.h() });
      if (Number(t?.status) === 1) await this.updateTicketStatus(ticketId, 2);
    } catch {
      /* optional */
    }
  }

  private nameCache = new Map<string, string | undefined>();

  /** Why the last asset load returned what it did (shown when Equipment is empty). */
  lastAssetProbe = '';

  /** URL paths GLPI said do not exist ("not an instance of CommonDBTM"). Never probed again. */
  private badPaths = new Set<string>();
  /** Types this profile may not read (403). Remembered for this session only — rights can change. */
  private noRightPaths = new Set<string>();
  private badLoaded = false;

  private async loadBadPaths() {
    if (this.badLoaded) return;
    this.badLoaded = true;
    try {
      await cache.hydrate();
      for (const p of cache.getStale<string[]>('bad_paths_v1') || []) this.badPaths.add(p);
    } catch {
      /* ignore */
    }
  }

  private markBadPath(path: string) {
    this.badPaths.add(path);
    cache.set('bad_paths_v1', Array.from(this.badPaths));
  }

  private async resolveName(itemtype: string, id: number): Promise<string | undefined> {
    const key = `${itemtype}:${id}`;
    if (this.nameCache.has(key)) return this.nameCache.get(key);
    try {
      const { data } = await this.http.get(`/${itemtype}/${id}`, {
        headers: this.h(),
        params: { expand_dropdowns: true },
      });
      let out: string | undefined;
      if (itemtype === 'User') {
        const fn = formatPersonName(data.firstname, data.realname);
        out = fn || data.name || String(id);
      } else {
        out = String(data.completename ?? data.name ?? id);
      }
      this.nameCache.set(key, out);
      return out;
    } catch {
      return undefined;
    }
  }

  private async getItemRaw(itemtype: string, id: number) {
    for (const path of itemtypePaths(itemtype)) {
      try {
        const { data, status } = await this.http.get(`/${path}/${id}`, {
          headers: this.h(),
          validateStatus: (s) => s < 500,
        });
        if (status < 400 && data && data.id) return data as Record<string, unknown>;
      } catch {
        /* next */
      }
    }
    return null;
  }


  private bridgeDownUntil = 0;

  /**
   * Call server-push/requester-bridge.php (My devices, Approve / Refuse for Requester profiles).
   * `missing` = the script is not installed / not reachable.
   */
  private async bridgeCall(
    action: 'devices' | 'approve' | 'refuse' | 'machine_status',
    payload: Record<string, unknown> = {}
  ): Promise<{ ok: boolean; missing?: boolean; status?: number; data?: any; note: string }> {
    if (Date.now() < this.bridgeDownUntil) {
      return { ok: false, missing: true, note: 'requester-bridge.php not reachable (skipped)' };
    }
    const axios = (await import('axios')).default;
    const base = this.baseUrl.replace(/\/$/, '');
    const noPublic = base.replace(/\/public$/i, '');
    const roots = Array.from(new Set([base, noPublic].filter(Boolean)));
    let lastNote = 'requester-bridge.php not found';
    for (const root of roots) {
      const url = `${root}/medmetric-push/requester-bridge.php`;
      try {
        const res = await axios.request({
          url,
          method: action === 'devices' ? 'GET' : 'POST',
          headers: {
            'Session-Token': this.sessionToken || '',
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          params: action === 'devices' ? { action } : undefined,
          data: action === 'devices' ? undefined : { action, session_token: this.sessionToken, ...payload },
          timeout: 30000,
          validateStatus: (st) => st < 500 || st === 502,
        });
        const { data, status } = res;
        if (status === 404 || (typeof data === 'string' && data.trim().startsWith('<'))) {
          lastNote = `requester-bridge.php not found at ${url.replace(/^https?:\/\//, '')}`;
          continue;
        }
        if (status >= 400 || !data?.ok) {
          return {
            ok: false,
            status,
            data,
            note: `requester-bridge.php HTTP ${status}: ${data?.error || briefBody(data)}`,
          };
        }
        return { ok: true, status, data, note: 'ok' };
      } catch (e) {
        lastNote = `requester-bridge.php unreachable: ${e instanceof Error ? e.message : 'error'}`;
      }
    }
    this.bridgeDownUntil = Date.now() + 10 * 60 * 1000; // do not retry for 10 minutes
    return { ok: false, missing: true, note: lastNote };
  }

  /**
   * "My devices" — machines linked to the logged-in user, like the browser's "User devices" list.
   * Needs server-push/requester-bridge.php on the GLPI server.
   */
  async getMyDevices(): Promise<{ rows: GlpiAssetRow[]; note: string }> {
    const r = await this.bridgeCall('devices');
    if (!r.ok) return { rows: [], note: r.note };
    const rows: GlpiAssetRow[] = (Array.isArray(r.data?.devices) ? r.data.devices : [])
      .map((d: Record<string, unknown>) => {
        const itemtype = String(d.itemtype || '');
        const short = itemtype.includes('\\') ? itemtype.split('\\').pop() || itemtype : itemtype;
        return {
          id: Number(d.id),
          name: String(d.name || `#${d.id}`),
          serial: d.serial ? String(d.serial) : undefined,
          otherserial: d.otherserial ? String(d.otherserial) : undefined,
          location_name: d.location ? String(d.location) : undefined,
          entity_name: d.entity ? String(d.entity) : undefined,
          status_name: d.status ? String(d.status) : undefined,
          itemtype,
          type_label: short.replace(/Asset$/i, '').replace(/([a-z])([A-Z])/g, '$1 $2') || short,
        } as GlpiAssetRow;
      })
      .filter((x: GlpiAssetRow) => x.id > 0 && x.itemtype);
    return { rows, note: `requester-bridge.php returned ${rows.length} device(s)` };
  }

  /**
   * Load ALL custom + searchable assets dynamically.
   * 1) AssetDefinition list → every system_name
   * 2) Glpi\CustomAsset\{system_name} for each
   * 3) AllAssets search fallback
   * No hard dependency on a fixed type list.
   */
  async listDefinedAssets(range = '0-150'): Promise<GlpiAssetRow[]> {
    const results: GlpiAssetRow[] = [];
    const seen = new Set<string>();

    const pushRow = (
      r: Record<string, unknown>,
      itemtype: string,
      type_label: string
    ) => {
      const id = Number(r.id ?? r['2'] ?? r.items_id ?? r['items_id'] ?? 0);
      if (!id || Number.isNaN(id)) return;
      // Deduplicate by id only across itemtype aliases of same asset
      const key = String(id) + '|' + String(r.name ?? r['1'] ?? '') + '|' + String(r.serial ?? r['5'] ?? '');
      if (seen.has(key)) return;
      seen.add(key);

      let location_name: string | undefined;
      let locations_id: number | undefined;
      const loc = r.locations_id ?? r['3'] ?? r.location;
      if (typeof loc === 'string' && loc && Number.isNaN(Number(loc))) {
        location_name = loc;
      } else if (loc != null && loc !== '' && loc !== 0) {
        locations_id = Number(loc);
      }

      let entity_name: string | undefined;
      let entities_id: number | undefined;
      const ent = r.entities_id ?? r['80'] ?? r.entity;
      if (typeof ent === 'string' && ent && Number.isNaN(Number(ent))) {
        entity_name = ent;
      } else if (ent != null && ent !== '' && Number(ent) >= 0) {
        entities_id = Number(ent);
      }

      const rawType = String(r.itemtype ?? itemtype);
      const short = rawType.includes('\\')
        ? rawType.split('\\').pop() || rawType
        : rawType;
      const label =
        type_label ||
        short.replace(/Asset$/i, '').replace(/([a-z])([A-Z])/g, '$1 $2') ||
        short;

      results.push({
        id,
        name: String(r.name ?? r['1'] ?? '—'),
        serial: r.serial
          ? String(r.serial)
          : r['5']
            ? String(r['5'])
            : undefined,
        otherserial: r.otherserial ? String(r.otherserial) : undefined,
        locations_id,
        location_name,
        entities_id,
        entity_name,
        states_id:
          typeof r.states_id === 'number'
            ? r.states_id
            : typeof r.states_id === 'string' && !Number.isNaN(Number(r.states_id))
              ? Number(r.states_id)
              : undefined,
        status_name: (() => {
          if (typeof r.states_id === 'string' && Number.isNaN(Number(r.states_id))) {
            return String(r.states_id);
          }
          if (r.status_name) return String(r.status_name);
          if (typeof r['31'] === 'string' && Number.isNaN(Number(r['31']))) return String(r['31']);
          return undefined;
        })(),
        itemtype: rawType,
        type_label: label,
      });
    };

    const probe: string[] = [];

    // FAST PATH: AllAssets first (one request)
    try {
      const { data, status } = await this.http.get('/search/AllAssets', {
        headers: this.h(),
        params: {
          range: range || '0-200',
          expand_dropdowns: true,
          'forcedisplay[0]': 1,
          'forcedisplay[1]': 2,
          'forcedisplay[2]': 5,
          'forcedisplay[3]': 31,
          'forcedisplay[4]': 80,
          'forcedisplay[5]': 3,
        },
        validateStatus: (s) => s < 500,
      });
      if (status >= 400) {
        probe.push(`AllAssets HTTP ${status}: ${briefBody(data)}`);
      } else {
        const n = !data?.data ? 0 : Array.isArray(data.data) ? data.data.length : Object.keys(data.data).length;
        probe.push(`AllAssets returned ${n} row(s)${data?.totalcount != null ? `, total ${data.totalcount}` : ''}`);
      }
      if (status < 400 && data?.data) {
        const rows = Array.isArray(data.data)
          ? data.data
          : (Object.values(data.data) as Record<string, unknown>[]);
        for (const r of rows) {
          const itemtype = String(r.itemtype ?? r['itemtype'] ?? 'Asset');
          const short = itemtype.includes('\\')
            ? itemtype.split('\\').pop() || itemtype
            : itemtype;
          pushRow(
            r as Record<string, unknown>,
            itemtype,
            short.replace(/Asset$/i, '') || short
          );
        }
      }
    } catch (e) {
      probe.push(`AllAssets failed: ${e instanceof Error ? e.message : 'unknown error'}`);
    }

    // Requester profiles: asset search is empty by design → use their linked "My devices"
    if (results.length === 0) {
      const mine = await this.getMyDevices();
      probe.push(mine.note);
      if (mine.rows.length) {
        this.lastAssetProbe = probe.join(' · ');
        return mine.rows.sort((a, b) =>
          a.type_label === b.type_label
            ? a.name.localeCompare(b.name)
            : a.type_label.localeCompare(b.type_label)
        );
      }
    }

    await this.loadBadPaths();

    // If AllAssets returned enough, skip slow per-type probes
    if (results.length >= 5) {
      this.lastAssetProbe = probe.join(' · ');
      return results.sort((a, b) =>
        a.type_label === b.type_label
          ? a.name.localeCompare(b.name)
          : a.type_label.localeCompare(b.type_label)
      );
    }

    // SLOW PATH: seed types in parallel (limited)
    const defs: { label: string; system_name: string }[] = [];
    const seenSn = new Set<string>();
    const addDef = (label: string, system_name: string) => {
      const sn = system_name.trim();
      if (!sn || seenSn.has(sn)) return;
      seenSn.add(sn);
      defs.push({ label: label || sn, system_name: sn });
    };
    for (const d of ASSET_DEFINITION_TYPES) addDef(d.label, d.system_name);
    addDef('Hemodialysis Machine', 'HemodialysisMachine');
    addDef('Hemodialysis Machine', 'HemodialysisMachines');

    const tasks = defs.map(async (def) => {
      const sn = def.system_name;
      const itemtypes = [
        'Glpi\\CustomAsset\\' + sn + 'Asset',
        'Glpi\\CustomAsset\\' + sn,
        sn + 'Asset',
        sn,
      ];
      for (const itemtype of itemtypes) {
        const rows = await this.tryListItemtype(itemtype, range);
        if (rows && rows.length > 0) {
          return { rows, itemtype, label: def.label };
        }
      }
      return null;
    });

    const settled = await Promise.all(tasks);
    probe.push(
      `${settled.filter(Boolean).length} of ${defs.length} asset types readable` +
        (this.badPaths.size ? ` (${this.badPaths.size} names unknown to the server)` : '')
    );
    this.lastAssetProbe = probe.join(' · ');
    for (const hit of settled) {
      if (!hit) continue;
      for (const r of hit.rows) pushRow(r, hit.itemtype, hit.label);
    }

    return results.sort((a, b) =>
      a.type_label === b.type_label
        ? a.name.localeCompare(b.name)
        : a.type_label.localeCompare(b.type_label)
    );
  }

  private async tryListItemtype(
    itemtype: string,
    range: string
  ): Promise<Record<string, unknown>[] | null> {
    const paths = itemtypePaths(itemtype);
    for (const path of paths) {
      if (this.badPaths.has(path) || this.noRightPaths.has(path)) continue; // known unusable — skip
      let notFound = false;
      let noRights = false;
      // A) Search with NO criteria (field 30 is_deleted breaks some custom asset types)
      for (const useExpand of [true, false]) {
        if (notFound) break;
        try {
          const { data, status } = await this.http.get('/search/' + path, {
            headers: this.h(),
            params: {
              range,
              ...(useExpand ? { expand_dropdowns: true } : {}),
              'forcedisplay[0]': 1,
              'forcedisplay[1]': 2,
              'forcedisplay[2]': 5,
              'forcedisplay[3]': 80,
              'forcedisplay[4]': 3,
            },
            validateStatus: (s) => s < 500,
          });
          if (status === 400 && /RESOURCE_NOT_FOUND/i.test(JSON.stringify(data ?? ''))) {
            notFound = true; // unknown itemtype: neither retry nor the plain list will work
            continue;
          }
          if (status === 403 && /RIGHT_MISSING/i.test(JSON.stringify(data ?? ''))) {
            notFound = true;
            noRights = true; // profile cannot read this type
            continue;
          }
          if (status < 400 && data) {
            let rows: Record<string, unknown>[] = [];
            if (Array.isArray(data.data)) rows = data.data;
            else if (data.data && typeof data.data === 'object') {
              rows = Object.values(data.data) as Record<string, unknown>[];
            } else if (Array.isArray(data)) rows = data;
            if (rows.length) return rows;
            // totalcount > 0 but empty data shape
            if (Number(data.totalcount || data.count || 0) > 0 && data.data) {
              const alt = Array.isArray(data.data)
                ? data.data
                : Object.values(data.data);
              if (alt.length) return alt as Record<string, unknown>[];
            }
          }
        } catch {
          /* next */
        }
      }

      if (notFound) {
        if (noRights) this.noRightPaths.add(path);
        else this.markBadPath(path);
        continue;
      }

      // B) Plain collection list
      try {
        const { data, status } = await this.http.get('/' + path, {
          headers: this.h(),
          params: { range, expand_dropdowns: true },
          validateStatus: (s) => s < 500,
        });
        if (status < 400) {
          if (Array.isArray(data) && data.length) return data;
          if (data?.data && Array.isArray(data.data) && data.data.length) return data.data;
        }
      } catch {
        /* next path */
      }
    }
    return null;
  }

  /** Work order categories (GLPI ITIL categories) for the new work order form. */
  async listTicketCategories(): Promise<{ id: number; name: string }[]> {
    try {
      const { data, status } = await this.http.get('/ITILCategory', {
        headers: this.h(),
        params: { range: '0-99', is_active: 1, expand_dropdowns: true },
        validateStatus: (st) => st < 500,
      });
      if (status >= 400 || !Array.isArray(data)) return [];
      return data
        .map((c: Record<string, unknown>) => ({ id: Number(c.id), name: String(c.completename ?? c.name ?? '') }))
        .filter((c) => c.id > 0 && c.name)
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      return [];
    }
  }

  private entityCache = new Map<string, number>();

  /** Entity of an equipment item (cached). Call when the item is picked so submit is instant. */
  async getAssetEntity(itemtype: string, itemsId: number): Promise<number | undefined> {
    const key = `${itemtype}:${itemsId}`;
    if (this.entityCache.has(key)) return this.entityCache.get(key);
    try {
      const { data: it } = await this.http.get(`/${itemtype}/${itemsId}`, {
        headers: this.h(),
        validateStatus: (st) => st < 500,
      });
      const e = Number(it?.entities_id);
      if (it && !Array.isArray(it) && Number.isFinite(e) && e >= 0) {
        this.entityCache.set(key, e);
        return e;
      }
    } catch {
      /* default entity */
    }
    return undefined;
  }

  async createTicket(input: {
    name: string;
    content: string;
    priority?: number;
    urgency?: number;
    /** Link inventory item (Asset definition / custom asset) */
    item?: { itemtype: string; items_id: number };
    /** Ticket type: 1 = Incident (breakdown), 2 = Request (service / PM) */
    type?: number;
    /** itilcategories id (work order category) */
    categoryId?: number;
  }): Promise<number> {
    // The work order belongs to the entity of the equipment (not the user's default entity "Organization").
    const entityId =
      input.item?.itemtype && input.item.items_id
        ? await this.getAssetEntity(input.item.itemtype, input.item.items_id)
        : undefined;

    const baseInput: Record<string, unknown> = {
      name: input.name,
      content: input.content,
      priority: input.priority ?? 3,
      urgency: input.urgency ?? 3,
      status: 1,
      ...(input.type ? { type: input.type } : {}),
      ...(input.categoryId ? { itilcategories_id: input.categoryId } : {}),
      // Same field the GLPI helpdesk form sends — works for Requester profiles
      // (their "associable items" right), unlike a separate Item_Ticket POST.
      ...(input.item?.itemtype && input.item.items_id
        ? { items_id: { [input.item.itemtype]: [input.item.items_id] } }
        : {}),
    };

    const post = (extra: Record<string, unknown>) =>
      this.http.post('/Ticket', { input: { ...baseInput, ...extra } }, { headers: this.h(), validateStatus: (st) => st < 500 });

    let res = await post(entityId !== undefined ? { entities_id: entityId } : {});
    if (entityId !== undefined && res.status >= 400) {
      // The entity is outside the session's active entities: widen the session once, then try again.
      try {
        await this.http.post('/changeActiveEntities', { entities_id: 'all', is_recursive: true }, { headers: this.h(), validateStatus: (st) => st < 500 });
        res = await post({ entities_id: entityId });
      } catch {
        /* fall through */
      }
      if (res.status >= 400) res = await post({}); // never block the work order
    }
    if (res.status >= 400) {
      const arr = res.data;
      const why = Array.isArray(arr) ? arr.slice(1).join(' ') : String(res.data?.message ?? '');
      throw new Error(why || `HTTP ${res.status}`);
    }
    const data = res.data;
    let id = 0;
    if (Array.isArray(data)) id = Number(data[0]?.id ?? 0);
    else id = Number(data?.id ?? 0);

    // Make sure the device really got linked; if not, try the direct link (never fail the ticket).
    if (id && input.item?.itemtype && input.item.items_id) {
      try {
        const { data: links } = await this.http.get(`/Ticket/${id}/Item_Ticket`, {
          headers: this.h(),
          validateStatus: (s) => s < 500,
        });
        const rows = Array.isArray(links) ? links : [];
        const linked = rows.some(
          (l: Record<string, unknown>) =>
            String(l.itemtype) === input.item!.itemtype && Number(l.items_id) === input.item!.items_id
        );
        if (!linked) await this.linkItemToTicket(id, input.item.itemtype, input.item.items_id);
      } catch {
        /* the ticket exists; linking is best effort */
      }
    }
    return id;
  }

  /** Link an asset to an existing ticket (Item_Ticket). */
  async linkItemToTicket(
    ticketId: number,
    itemtype: string,
    itemsId: number
  ): Promise<void> {
    await this.http.post(
      '/Item_Ticket',
      {
        input: {
          tickets_id: ticketId,
          itemtype,
          items_id: itemsId,
        },
      },
      { headers: this.h() }
    );
  }

  async updateTicketStatus(ticketId: number, status: number): Promise<void> {
    const { data, status: httpStatus } = await this.http.put(
      `/Ticket/${ticketId}`,
      { input: { status } },
      { headers: this.h(), validateStatus: (s) => s < 500 }
    );
    if (httpStatus >= 400) {
      throw this.friendlyPermissionError(data, 'change ticket status');
    }
  }

  /** List CMMS asset states (Active, Down, etc.) */
  async listAssetStates(): Promise<{ id: number; name: string }[]> {
    try {
      const { data, status } = await this.http.get('/State', {
        headers: this.h(),
        params: { range: '0-100', expand_dropdowns: true },
        validateStatus: (s) => s < 500,
      });
      if (status >= 400) return [];
      const rows = Array.isArray(data) ? data : data?.data || [];
      return (rows as Record<string, unknown>[])
        .map((r) => ({
          id: Number(r.id),
          name: String(r.name || r.completename || r.id),
        }))
        .filter((s) => s.id > 0);
    } catch {
      return [];
    }
  }

  /** Resolve Active / Down state ids from CMMS dropdown */
  async resolveActiveDownStateIds(): Promise<{ activeId?: number; downId?: number }> {
    const states = await this.listAssetStates();
    let activeId: number | undefined;
    let downId: number | undefined;
    for (const s of states) {
      const n = s.name.toLowerCase();
      if (activeId == null && /active|in use|operational|ok|production/.test(n)) {
        activeId = s.id;
      }
      if (downId == null && /down|out of service|non.?op|inactive|broken|fault|not in use/.test(n)) {
        downId = s.id;
      }
    }
    // fallbacks: first vs second common pattern
    if (activeId == null && states[0]) activeId = states[0].id;
    if (downId == null && states.length > 1) {
      downId = states.find((s) => s.id !== activeId)?.id;
    }
    return { activeId, downId };
  }

  async updateAssetStatus(
    itemtype: string,
    itemsId: number,
    statesId: number
  ): Promise<void> {
    const paths = itemtypePaths(itemtype);
    let lastErr: unknown;
    for (const path of paths) {
      try {
        const { status } = await this.http.put(
          `/${path}/${itemsId}`,
          { input: { states_id: statesId } },
          { headers: this.h(), validateStatus: (s) => s < 500 }
        );
        if (status < 400) return;
        lastErr = new Error(`HTTP ${status}`);
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error('Could not update asset status');
  }

  /** Set asset to Active or Down by name mapping */
  async setAssetOperationalStatus(
    itemtype: string,
    itemsId: number,
    mode: 'active' | 'down',
    ticketId?: number
  ): Promise<void> {
    try {
      await this.setAssetOperationalStatusDirect(itemtype, itemsId, mode);
      return;
    } catch (e) {
      // Requester profiles cannot edit assets: use the server bridge (needs the ticket as proof)
      if (!ticketId) throw e;
      const b = await this.bridgeCall('machine_status', {
        ticket_id: ticketId,
        itemtype,
        items_id: itemsId,
        mode,
      });
      if (b.ok) return;
      throw new Error(
        b.missing
          ? 'Your profile cannot change machine status, and the server helper (requester-bridge.php) is not installed.'
          : b.data?.error || b.note
      );
    }
  }

  private async setAssetOperationalStatusDirect(
    itemtype: string,
    itemsId: number,
    mode: 'active' | 'down'
  ): Promise<void> {
    const { activeId, downId } = await this.resolveActiveDownStateIds();
    const id = mode === 'active' ? activeId : downId;
    if (id == null) {
      throw new Error(
        'Asset status list has no Active/Down entry. Ask admin to define states named Active and Down.'
      );
    }
    await this.updateAssetStatus(itemtype, itemsId, id);
  }



  /**
   * Current user + optional photo (data URI for Image source).
   */
  async getCurrentUserProfile(): Promise<{
    id: number;
    name?: string;
    realname?: string;
    pictureDataUri?: string;
  }> {
    // Session full data sometimes has glpiID
    let userId = 0;
    try {
      const { data } = await this.http.get('/getFullSession', { headers: this.h() });
      const sess = data?.session || data;
      userId = Number(sess?.glpiID || sess?.glpiID || 0);
    } catch {
      /* try /getMyEntities path not needed */
    }
    if (!userId) {
      // Fallback: search self via /User with range — not ideal; use session token context
      const { data } = await this.http.get('/getActiveProfile', {
        headers: this.h(),
        validateStatus: (s) => s < 500,
      }).catch(() => ({ data: null }));
      // still need id — try getFullSession again alternate shape
    }
    if (!userId) {
      try {
        const { data } = await this.http.get('/initSession', {
          headers: this.h(),
          params: { get_full_session: true },
          validateStatus: (s) => s < 500,
        });
        // already have session; won't re-init without auth
      } catch {
        /* ignore */
      }
    }

    // Prefer explicit endpoint available in many GLPI versions
    try {
      const { data } = await this.http.get('/getFullSession', { headers: this.h() });
      const s = data?.session ?? data ?? {};
      userId = Number(s.glpiID ?? s.glpiID ?? userId);
      // first (given) name first: "Yahya Mohammed", not "Mohammed Yahya"
      const realname = formatPersonName(s.glpifirstname ?? s.firstname, s.glpirealname ?? s.realname);
      const name = s.glpiname ? String(s.glpiname) : undefined;
      let pictureDataUri: string | undefined;
      if (userId > 0) {
        pictureDataUri = await this.fetchUserPictureDataUri(userId);
      }
      return {
        id: userId,
        name,
        realname: realname || name,
        pictureDataUri,
      };
    } catch (e) {
      return { id: userId };
    }
  }

  async fetchUserPictureDataUri(userId: number): Promise<string | undefined> {
    const paths = [
      `/User/${userId}/Picture`,
      `/User/${userId}/picture`,
    ];
    for (const path of paths) {
      try {
        const res = await this.http.get(path, {
          headers: this.h(),
          responseType: 'arraybuffer',
          validateStatus: (s) => s < 500,
        });
        if (res.status >= 400 || !res.data) continue;
        // detect content-type
        const ctype = String(res.headers?.['content-type'] || 'image/jpeg');
        if (ctype.includes('json')) continue;
        // arraybuffer → base64
        const bytes = new Uint8Array(res.data as ArrayBuffer);
        if (bytes.length < 32) continue;
        let binary = '';
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) {
          binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
        }
        const b64 =
          typeof btoa !== 'undefined'
            ? btoa(binary)
            : Buffer.from(bytes).toString('base64');
        const mime = ctype.includes('png')
          ? 'image/png'
          : ctype.includes('webp')
            ? 'image/webp'
            : 'image/jpeg';
        return `data:${mime};base64,${b64}`;
      } catch {
        /* next */
      }
    }
    return undefined;
  }


  /** Tickets linked to a specific asset (Item_Ticket). */
  async getTicketsForAsset(
    itemtype: string,
    itemsId: number,
    range = '0-40'
  ): Promise<GlpiTicket[]> {
    const out: GlpiTicket[] = [];
    const seen = new Set<number>();

    const paths = itemtypePaths(itemtype);
    // Search Item_Ticket by items_id
    for (const field of [13, 131, 2]) {
      try {
        const { data, status } = await this.http.get('/search/Item_Ticket', {
          headers: this.h(),
          params: {
            range,
            'criteria[0][field]': field,
            'criteria[0][searchtype]': 'equals',
            'criteria[0][value]': itemsId,
            forcedisplay: [1, 2, 3, 4, 5],
          },
          validateStatus: (s) => s < 500,
        });
        if (status >= 400 || !data?.data) continue;
        const rows = Array.isArray(data.data)
          ? data.data
          : Object.values(data.data);
        for (const r of rows as Record<string, unknown>[]) {
          const tid = Number(
            r.tickets_id ?? r['3'] ?? r['tickets_id'] ?? r.id ?? 0
          );
          const it = String(r.itemtype ?? r['4'] ?? '');
          if (it && itemtype && !it.includes(itemtype.split('\\').pop() || '')) {
            // soft match — still accept if items_id matched
          }
          if (!tid || seen.has(tid)) continue;
          seen.add(tid);
        }
        if (seen.size) break;
      } catch {
        /* next field */
      }
    }

    // Fallback: list Item_Ticket and filter client-side (small ranges)
    if (!seen.size) {
      try {
        const { data, status } = await this.http.get('/Item_Ticket', {
          headers: this.h(),
          params: { range: '0-200', expand_dropdowns: false },
          validateStatus: (s) => s < 500,
        });
        if (status < 400) {
          const rows = Array.isArray(data) ? data : data?.data || [];
          for (const r of rows as Record<string, unknown>[]) {
            const iid = Number(r.items_id ?? 0);
            const it = String(r.itemtype ?? '');
            const tid = Number(r.tickets_id ?? 0);
            if (iid === itemsId && tid) {
              const short = itemtype.split('\\').pop() || itemtype;
              if (!it || it === itemtype || it.endsWith(short) || it.includes(short)) {
                seen.add(tid);
              }
            }
          }
        }
      } catch {
        /* ignore */
      }
    }

    // Fetch ticket headers (parallel)
    const heads = await Promise.all(
      Array.from(seen)
        .slice(0, 30)
        .map(async (tid) => {
          try {
            const { data, status } = await this.http.get('/Ticket/' + tid, {
              headers: this.h(),
              params: { expand_dropdowns: true },
              validateStatus: (s) => s < 500,
            });
            if (status >= 400 || !data) return null;
            const row = Array.isArray(data) ? data[0] : data;
            return {
              id: Number(row.id ?? tid),
              name: String(row.name ?? 'Ticket #' + tid),
              status: Number(row.status ?? 1),
              priority: Number(row.priority ?? 3),
              date: row.date ? String(row.date) : undefined,
              content: row.content ? String(row.content) : undefined,
            } as GlpiTicket;
          } catch {
            return null;
          }
        })
    );
    for (const h of heads) if (h) out.push(h);

    return out.sort((a, b) => b.id - a.id);
  }

  /** Change password for the logged-in user (GLPI requires password + password2). */
  async changePassword(
    userId: number,
    newPassword: string
  ): Promise<void> {
    await this.http.put(
      '/User/' + userId,
      {
        input: {
          id: userId,
          password: newPassword,
          password2: newPassword,
        },
      },
      { headers: this.h() }
    );
  }




  // ---------- medMETRIC stock plugin API + native fallbacks ----------

  /** Address (up to the file name) of the stock plugin API that answered last time. */
  private pluginBaseOk: string | null = null;
  /** Why the last stock call failed (shown under Field stock instead of a vague message). */
  lastStockError: string | null = null;
  /** 'plugin' = real warehouse stock, 'server' = plain GLPI consumables (plugin unreachable). */
  lastStockSource: 'plugin' | 'server' | null = null;

  private pluginStockCandidates(file: string): string[] {
    const base = this.baseUrl.replace(/\/$/, '');
    const noPublic = base.replace(/\/public$/i, '');
    const withPublic = base.endsWith('/public') ? base : `${noPublic}/public`;
    const roots = Array.from(
      new Set([base, noPublic, withPublic, base.replace(/\/index\.php$/i, '')].filter(Boolean))
    );
    const urls: string[] = [];
    if (this.pluginBaseOk) urls.push(this.pluginBaseOk + file); // the address that worked before goes first
    for (const root of roots) {
      urls.push(`${root}/plugins/medmetricstock/api/${file}`);
      urls.push(`${root}/plugins/medmetricstock/front/api/${file}`); // GLPI 11 layout (plugin v1.4.2+)
      urls.push(`${root}/public/plugins/medmetricstock/api/${file}`);
      urls.push(`${root}/marketplace/medmetricstock/api/${file}`);
      urls.push(`${root}/marketplace/medmetricstock/front/api/${file}`);
      urls.push(`${root}/plugins/medmetricstock/front/${file}`);
      urls.push(`${root}/api/plugins/medmetricstock/${file}`);
    }
    return Array.from(new Set(urls));
  }

  /**
   * One call to the stock plugin. Tries the known addresses until one answers with the plugin's JSON
   * (an object with an "ok" field). v1.0.26: a real answer from the plugin (e.g. "Not enough stock in ...")
   * is returned / thrown at once; before, the error was overwritten by the HTTP 404 of the last address tried.
   */
  private async pluginRequest<T = unknown>(
    method: 'GET' | 'POST',
    file: string,
    opts: { params?: Record<string, string | number>; body?: Record<string, unknown>; soft?: boolean } = {}
  ): Promise<T> {
    const axios = (await import('axios')).default;
    const headers: Record<string, string> = {
      'Session-Token': this.sessionToken || '',
      Accept: 'application/json',
      ...(this.appToken ? { 'App-Token': this.appToken } : {}),
      ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
    };
    let lastWhy = '';
    let netErrors = 0;
    let tried = 0;
    for (const url of this.pluginStockCandidates(file)) {
      tried += 1;
      const t0 = Date.now();
      const shortPath = url.replace(/^https?:\/\/[^/]+/, '');
      try {
        const res = await axios.request({
          url,
          method,
          headers,
          params: {
            ...(opts.params || {}),
            session_token: this.sessionToken || undefined,
            app_token: this.appToken || undefined,
          },
          data: method === 'POST' ? { ...(opts.body || {}), session_token: this.sessionToken } : undefined,
          timeout: this.pluginBaseOk ? 30000 : 12000,
          validateStatus: () => true,
        });
        const data = res.data as unknown;
        const looksHtml = typeof data === 'string' && data.trim().startsWith('<');
        diag.add({
          t: new Date().toISOString(), method, path: shortPath, status: res.status, ms: Date.now() - t0,
          note: looksHtml ? 'web page instead of JSON' : typeof data === 'object' && data ? String((data as { message?: string; error?: string }).message ?? (data as { error?: string }).error ?? '') || undefined : undefined,
        });
        const isPluginJson =
          !!data && typeof data === 'object' && !Array.isArray(data) && typeof (data as { ok?: unknown }).ok === 'boolean';
        if (!isPluginJson) {
          lastWhy =
            typeof data === 'string' && data.trim().startsWith('<')
              ? `HTTP ${res.status}, web page instead of JSON at ${url}`
              : `HTTP ${res.status} at ${url}`;
          continue; // wrong address (or GLPI login page) → next one
        }
        // The plugin answered: this is the right address.
        this.pluginBaseOk = url.slice(0, url.length - file.length);
        const o = data as { ok: boolean; error?: string; message?: string };
        if (res.status === 401 || o.error === 'unauthorized') {
          throw PluginAnswerError(
            o.message || 'The stock plugin did not accept your session. Sign out and sign in again.'
          );
        }
        if (res.status >= 400 || o.ok === false) {
          if (opts.soft) return data as T;
          throw PluginAnswerError(o.message || o.error || `Stock plugin error (HTTP ${res.status})`);
        }
        return data as T;
      } catch (e: unknown) {
        if ((e as { isPluginAnswer?: boolean })?.isPluginAnswer) {
          this.lastStockError = (e as Error).message;
          throw e;
        }
        const code = (e as { code?: string })?.code;
        diag.add({ t: new Date().toISOString(), method, path: shortPath, status: 'ERR', ms: Date.now() - t0, note: String(code || (e instanceof Error ? e.message : e)) });
        lastWhy = `${code || (e instanceof Error ? e.message : String(e))} at ${url}`;
        if (!(e as { response?: unknown })?.response) netErrors += 1;
        if (netErrors >= 3 && !this.pluginBaseOk) break; // no connection at all: stop probing
      }
    }
    const msg =
      `Stock plugin not reachable (tried ${tried} address${tried === 1 ? '' : 'es'}). ` +
      'Check that medMETRIC Stock v1.4.4 is installed and enabled. ' +
      (lastWhy ? `Last: ${lastWhy}` : '');
    this.lastStockError = msg;
    throw new Error(msg);
  }

  private pluginGet<T = unknown>(
    file: string,
    params?: Record<string, string | number>,
    soft = false
  ): Promise<T> {
    return this.pluginRequest<T>('GET', file, { params, soft });
  }

  /**
   * Changes (spare part deducted, tool out / in). Sent as GET with the Session-Token header:
   * GLPI 11 rejects token-only POST requests as CSRF (HTTP 403 "The action you have requested is not allowed").
   */
  private pluginPost<T = unknown>(file: string, body: Record<string, unknown>): Promise<T> {
    const params: Record<string, string | number> = {};
    for (const [k, v] of Object.entries(body)) {
      if (v === undefined || v === null || v === '') continue;
      params[k] = typeof v === 'number' ? v : String(v);
    }
    return this.pluginRequest<T>('GET', file, { params });
  }

  /** More → "Stock plugin check": reachable? version? does it accept this session? */
  async checkStockPlugin(): Promise<{ ok: boolean; version?: string; detail: string }> {
    try {
      const r = await this.pluginGet<{ version?: string; authenticated?: boolean; can_read?: boolean }>('ping.php');
      if (!r.authenticated) {
        return { ok: false, version: r.version, detail: 'Plugin found, but it does not accept your session.' };
      }
      if (r.can_read === false) {
        return { ok: false, version: r.version, detail: 'Plugin found, but your profile has no right to read it (Administration → Profiles → medMETRIC Stock).' };
      }
      return { ok: true, version: r.version, detail: `Plugin ${r.version || ''} · session accepted` };
    } catch (e) {
      // an older plugin has no ping.php: try the real list
      try {
        await this.pluginGet('stock.php');
        return { ok: true, detail: 'Plugin answers (older version without ping.php — update to 1.4.4).' };
      } catch {
        return { ok: false, detail: e instanceof Error ? e.message : String(e) };
      }
    }
  }

  private parseStockRows(raw: unknown): StockPart[] {
    const rows: unknown[] = (() => {
      if (Array.isArray(raw)) return raw;
      if (!raw || typeof raw !== 'object') return [];
      const o = raw as Record<string, unknown>;
      for (const k of ['data', 'items', 'stock', 'consumables', 'parts', 'result', 'results']) {
        if (Array.isArray(o[k])) return o[k] as unknown[];
      }
      // single object map id->row
      return [];
    })();
    const out: StockPart[] = [];
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const r = row as Record<string, unknown>;
      const whRaw = Array.isArray(r.warehouses) ? (r.warehouses as Record<string, unknown>[]) : [];
      const warehouses = whRaw
        .map((w) => ({
          id: Number(w.id ?? w.warehouse_id ?? w.warehouses_id ?? 0),
          name: String(w.name ?? `#${w.id ?? ''}`),
          qty: Number(w.qty ?? w.quantity ?? 0) || 0,
        }))
        .filter((w) => w.id > 0 && w.qty > 0);
      const id = Number(
        r.id ?? r.consumableitems_id ?? r.consumable_item_id ?? r.consumableitems_id ?? 0
      );
      if (!id) continue;
      const stock = Number(
        r.stock ??
          r.quantity ??
          r.qty ??
          r.num_in_stock ??
          r.in_stock ??
          r.count ??
          r.numbers ??
          r.remaining ??
          0
      );
      out.push({
        id,
        name: String(r.name ?? r.designation ?? r.ref ?? r.completename ?? `Part #${id}`),
        stock: Number.isFinite(stock) ? stock : 0,
        ref: r.ref != null ? String(r.ref) : undefined,
        warehouses: warehouses.length ? warehouses : undefined,
      });
    }
    return out;
  }



  /**
   * GET lookup.php?code= — resolve QR / reference to part or tool + warehouse stock
   */
  async lookupStockCode(
    code: string,
    ticketId?: number
  ): Promise<{
    ok: boolean;
    type?: 'consumable' | 'tool';
    id?: number;
    name?: string;
    code?: string;
    serial?: string;
    status?: string;
    stock?: { warehouse_id: number; name: string; qty: number }[];
    error?: string;
  }> {
    const raw = await this.pluginGet<Record<string, unknown>>(
      'lookup.php',
      { code: code.trim(), ...(ticketId ? { tickets_id: ticketId } : {}) },
      true // soft: "not found" / "not compatible" come back as a normal answer
    );
    if (!raw || raw.ok === false) {
      return {
        ok: false,
        error: String(raw?.error || raw?.message || 'not_found'),
      };
    }
    const stockRaw = Array.isArray(raw.stock) ? raw.stock : [];
    const stock = stockRaw.map((row: any) => ({
      warehouse_id: Number(row.warehouse_id ?? row.warehouses_id ?? 0),
      name: String(row.name ?? row.warehouse ?? `WH #${row.warehouse_id ?? ''}`),
      qty: Number(row.qty ?? row.quantity ?? row.stock ?? 0),
    }));
    return {
      ok: true,
      type: (raw.type as 'consumable' | 'tool') || 'consumable',
      id: Number(raw.id ?? 0) || undefined,
      name: raw.name ? String(raw.name) : undefined,
      code: raw.code ? String(raw.code) : code,
      serial: raw.serial ? String(raw.serial) : undefined,
      status: raw.status ? String(raw.status) : undefined,
      stock,
    };
  }

  /**
   * List spare parts for a ticket (plugin filters by machine compatibility when tickets_id given).
   * General parts always included by plugin; specific parts only if linked machine matches.
   */
  async listConsumableStock(opts?: {
    ticketId?: number;
    itemtype?: string;
    itemsId?: number;
  }): Promise<StockPart[]> {
    const cacheKey = `stock:${opts?.ticketId || 0}:${opts?.itemtype || ''}:${opts?.itemsId || 0}`;
    try {
      const { cache } = await import('../cache');
      const hit = cache.get<StockPart[]>(cacheKey);
      if (hit && hit.length) {
        this.lastStockSource = 'plugin';
        return hit;
      }
    } catch {
      /* no cache */
    }

    const params: Record<string, string | number> = {};
    if (opts?.ticketId) params.tickets_id = opts.ticketId;
    if (opts?.itemtype) params.itemtype = opts.itemtype;
    if (opts?.itemsId) {
      params.items_id = opts.itemsId;
      params.machines_id = opts.itemsId;
    }

    // 1) Plugin API (preferred — stock + compatibility)
    try {
      const raw = await this.pluginGet<unknown>('stock.php', params);
      let parsed = this.parseStockRows(raw);
      // Some plugin builds nest under compatible / general
      if (!parsed.length && raw && typeof raw === 'object') {
        const o = raw as Record<string, unknown>;
        const merged = [
          ...(Array.isArray(o.compatible) ? o.compatible : []),
          ...(Array.isArray(o.general) ? o.general : []),
          ...(Array.isArray(o.parts) ? o.parts : []),
        ];
        if (merged.length) parsed = this.parseStockRows(merged);
      }
      this.lastStockSource = 'plugin';
      if (parsed.length) {
        try {
          const { cache } = await import('../cache');
          cache.set(cacheKey, parsed);
        } catch {
          /* */
        }
        return parsed.sort((a, b) => a.name.localeCompare(b.name));
      }
      // The plugin answered but has no part for this ticket: that is a real answer, not an error.
      return [];
    } catch (e) {
      console.warn('stock.php', e);
      // fall through to the plain server catalogue; lastStockError tells the screen why
    }

    // 2) Native ConsumableItem fallback when plugin empty/unreachable
    try {
      const { data, status } = await this.http.get('/ConsumableItem', {
        headers: this.h(),
        params: { range: '0-100', expand_dropdowns: true },
        validateStatus: (s) => s < 500,
      });
      if (status < 400) {
        const rows = Array.isArray(data) ? data : data?.data || [];
        const out: StockPart[] = [];
        for (const r of rows as Record<string, unknown>[]) {
          const id = Number(r.id ?? 0);
          if (!id) continue;
          out.push({
            id,
            name: String(r.name ?? r.ref ?? `Part #${id}`),
            stock: Number(r.num_in_stock ?? r.stock ?? r.numbers ?? r.count ?? 0) || 0,
            ref: r.ref ? String(r.ref) : undefined,
          });
        }
        if (out.length) {
          await this.enrichStockCounts(out);
          this.lastStockSource = 'server';
          return out.sort((a, b) => a.name.localeCompare(b.name));
        }
      }
    } catch {
      /* empty */
    }
    return [];
  }

  /** Fill stock counts (GLPI stores qty as unused Consumable rows, not a field) */
  private async enrichStockCounts(
    items: { id: number; name: string; stock: number; ref?: string }[]
  ): Promise<void> {
    const need = items.filter((i) => !i.stock).slice(0, 15);
    await Promise.all(
      need.map(async (item) => {
        try {
          // Count unused consumables for this model
          const { data, status, headers } = await this.http.get(
            `/ConsumableItem/${item.id}/Consumable`,
            {
              headers: this.h(),
              params: { range: '0-0' },
              validateStatus: (s) => s < 500,
            }
          );
          // Content-Range: items 0-0/12 → total 12
          const cr = String(headers?.['content-range'] || headers?.['Content-Range'] || '');
          const m = cr.match(/\/(\d+)\s*$/);
          if (m) {
            item.stock = Number(m[1]) || 0;
            return;
          }
          if (status < 400 && Array.isArray(data)) {
            // Only count rows still in stock (no date_out)
            const inStock = data.filter((row: Record<string, unknown>) => {
              const out = row.date_out ?? row.date_out_NULL ?? null;
              return out == null || out === '' || out === 'NULL';
            }).length;
            if (inStock) item.stock = inStock;
          }
          // Detail endpoint
          const { data: detail } = await this.http.get(`/ConsumableItem/${item.id}`, {
            headers: this.h(),
            validateStatus: (s) => s < 500,
          });
          if (detail) {
            const n = Number(
              detail.num_in_stock ??
                detail.stock ??
                detail.consumables_count ??
                detail.numbers ??
                0
            );
            if (Number.isFinite(n) && n > item.stock) item.stock = n;
          }
        } catch {
          /* keep 0 */
        }
      })
    );
  }



  /** GET tools.php — reusable tools: available ones (Check out) and checked-out ones (Return). */
  async listAvailableTools(ticketId?: number): Promise<StockTool[]> {
    const raw = await this.pluginGet<unknown>('tools.php', ticketId ? { tickets_id: ticketId } : undefined);
    const rows: unknown[] = (() => {
      if (Array.isArray(raw)) return raw;
      if (raw && typeof raw === 'object') {
        const o = raw as Record<string, unknown>;
        for (const k of ['data', 'tools', 'items', 'result', 'results']) {
          if (Array.isArray(o[k])) return o[k] as unknown[];
        }
      }
      return [];
    })();
    const out: StockTool[] = [];
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const r = row as Record<string, unknown>;
      const id = Number(r.id ?? r.tools_id ?? r.plugin_medmetricstock_tools_id ?? 0);
      if (!id) continue;
      const name = String(r.name ?? r.designation ?? r.label ?? '').trim() || `Tool #${id}`;
      out.push({
        id,
        name,
        itemtype: 'PluginMedmetricstockTool',
        serial: r.serial ? String(r.serial) : undefined,
        status: String(r.status ?? r.state ?? 'available').toLowerCase(),
        onThisTicket: r.on_this_ticket === true,
      });
    }
    // Checked out on this ticket first (they can be returned), then available, then the rest
    const weight = (t: StockTool) => (t.onThisTicket ? 0 : t.status === 'available' ? 1 : 2);
    return out.sort((a, b) => weight(a) - weight(b) || a.name.localeCompare(b.name));
  }

  /**
   * POST movement.php — deduct a spare part on a ticket.
   * v1.0.26: no more app-side follow-up (the plugin already writes one — it was posted twice, and even
   * when the deduction failed); the warehouse is optional (plugin picks one with enough stock);
   * the plugin's real error text is thrown.
   */
  async deductSparePart(opts: {
    ticketId: number;
    consumableItemId: number;
    quantity: number;
    warehouseId?: number;
    comment?: string;
    partName?: string;
  }): Promise<{ remaining?: number }> {
    const qty = Math.max(1, Math.round(opts.quantity));
    const r = await this.pluginPost<{ remaining?: number }>('movement.php', {
      tickets_id: opts.ticketId,
      consumableitems_id: opts.consumableItemId,
      ...(opts.warehouseId ? { warehouses_id: opts.warehouseId } : {}),
      quantity: qty,
      comment: opts.comment || '',
    });
    cache.invalidatePrefix('stock:');
    cache.invalidate(`ticket:${opts.ticketId}`);
    return { remaining: typeof r?.remaining === 'number' ? r.remaining : undefined };
  }

  async checkoutTool(opts: {
    ticketId: number;
    toolId: number;
    itemtype?: string;
    comment?: string;
    toolName?: string;
  }): Promise<void> {
    await this.pluginPost('tool.php', {
      tickets_id: opts.ticketId,
      tools_id: opts.toolId,
      action: 'checkout',
      comment: opts.comment || 'Checkout',
    });
    cache.invalidate(`ticket:${opts.ticketId}`);
  }

  async returnTool(opts: {
    ticketId: number;
    toolId: number;
    itemtype?: string;
    toolName?: string;
  }): Promise<void> {
    await this.pluginPost('tool.php', {
      tickets_id: opts.ticketId,
      tools_id: opts.toolId,
      action: 'return',
      comment: 'Return tool',
    });
    cache.invalidate(`ticket:${opts.ticketId}`);
  }

  async getTicketStockHistory(ticketId: number): Promise<{
    parts: { id?: number; name: string; quantity: number; date?: string; user?: string }[];
    tools: { id?: number; name: string; direction?: string; date?: string; user?: string }[];
  }> {
    try {
      const raw = await this.pluginGet<unknown>('ticket_stock.php', { tickets_id: ticketId });
      const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
      const partRows = Array.isArray(obj.parts)
        ? obj.parts
        : Array.isArray(obj.spare_parts)
          ? obj.spare_parts
          : Array.isArray(obj.movements)
            ? obj.movements
            : Array.isArray(obj.data)
              ? obj.data
              : Array.isArray(raw)
                ? raw
                : [];
      const toolRows = Array.isArray(obj.tools)
        ? obj.tools
        : Array.isArray(obj.tool_movements)
          ? obj.tool_movements
          : [];
      return {
        parts: (partRows as Record<string, unknown>[]).map((r) => ({
          id: r.id != null ? Number(r.id) : undefined,
          name: String(r.name ?? r.part ?? r.consumable ?? r.model ?? 'Part'),
          quantity: Number(r.quantity ?? r.qty ?? 1),
          date: r.date ? String(r.date) : r.date_mod ? String(r.date_mod) : undefined,
          user: r.user ? String(r.user) : undefined,
        })),
        tools: (toolRows as Record<string, unknown>[]).map((r) => ({
          id: r.id != null ? Number(r.id) : undefined,
          name: String(r.name ?? r.tool ?? 'Tool'),
          direction: r.direction ? String(r.direction) : r.action ? String(r.action) : undefined,
          date: r.date ? String(r.date) : undefined,
          user: r.user ? String(r.user) : undefined,
        })),
      };
    } catch {
      return { parts: [], tools: [] };
    }
  }

  ticketWebUrl(id: number) {
    return this.baseUrl + '/front/ticket.form.php?id=' + id;
  }

  /** Server PDF plugin — primary export entry (medMETRIC CMMS / AI narrative). */
  ticketPdfPluginUrl(id: number) {
    const base = this.baseUrl.replace(/\/+$/, '');
    // Common plugin PDF routes used by medMETRIC customized PDF plugin
    return (
      base +
      '/plugins/pdf/front/export.php?itemtype=Ticket&id=' +
      id
    );
  }

  /** Alternate PDF / report URLs to try if primary fails in browser. */
  ticketPdfPluginUrls(id: number): string[] {
    const base = this.baseUrl.replace(/\/+$/, '');
    return [
      base + '/plugins/pdf/front/export.php?itemtype=Ticket&id=' + id,
      base + '/plugins/pdf/front/export.form.php?itemtype=Ticket&id=' + id,
      base + '/front/ticket.form.php?id=' + id + '&forcetab=PluginPdfTicket$1',
      base + '/front/ticket.form.php?id=' + id,
    ];
  }
}

/** Short one-line server message for logs. */
function briefBody(data: unknown): string {
  try {
    const t = typeof data === 'string' ? data : JSON.stringify(data ?? '');
    return t.replace(/\s+/g, ' ').slice(0, 160);
  } catch {
    return '';
  }
}

/** GLPI errors look like ["ERROR_GLPI_UPDATE","You don't have permission..."] */
function humanServerMessage(data: unknown): string {
  if (Array.isArray(data) && typeof data[1] === 'string' && data[1]) return data[1];
  if (Array.isArray(data) && typeof data[0] === 'string') return data[0];
  if (data && typeof data === 'object') {
    const o = data as Record<string, unknown>;
    const m = o.message ?? o.error;
    if (typeof m === 'string') return m;
  }
  if (typeof data === 'string' && data && !data.trim().startsWith('<')) return data.slice(0, 160);
  return '';
}

/** Paths for namespaced itemtypes (legacy REST). */
function itemtypePaths(itemtype: string): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();
  const add = (p: string) => {
    if (!p || seen.has(p)) return;
    seen.add(p);
    paths.push(p);
  };

  // Single-level encoding: Backslash → %5C (GLPI REST style)
  add(itemtype.replace(/\\/g, '%5C'));
  // Segment encode (handles special chars in system_name)
  add(itemtype.split('\\').map(encodeURIComponent).join('%5C'));
  // Raw (some proxies)
  add(itemtype);
  // Short class name only
  const short = itemtype.split(/\\|\//).pop();
  if (short && short !== itemtype) {
    add(short);
    add(short.replace(/Asset$/i, ''));
    if (!short.endsWith('Asset')) add(short + 'Asset');
  }
  return paths;
}

function pickNum(...vals: unknown[]): number {
  for (const v of vals) {
    if (v == null || v === '') continue;
    if (typeof v === 'number' && !Number.isNaN(v)) return v;
    const n = Number(v);
    if (!Number.isNaN(n)) return n;
  }
  return 0;
}

function pickStr(...vals: unknown[]): string {
  for (const v of vals) {
    if (v == null) continue;
    const s = String(v).trim();
    if (s && s !== '0' && s !== 'undefined') return s;
  }
  return '';
}

/** Map status label → id when expand_dropdowns returns a string */
function parseStatus(v: unknown): number {
  if (typeof v === 'number') return v;
  if (v == null || v === '') return 0;
  const n = Number(v);
  if (!Number.isNaN(n) && String(n) === String(v).trim()) return n;
  const s = String(v).toLowerCase();
  if (s.includes('new')) return 1;
  if (s.includes('assign') || s.includes('processing (assigned)')) return 2;
  if (s.includes('plan')) return 3;
  if (s.includes('pending') || s.includes('waiting')) return 4;
  if (s.includes('solved')) return 5;
  if (s.includes('closed')) return 6;
  return 0;
}

function normalizeTicket(row: Record<string, unknown>): GlpiTicket {
  // REST item fields OR search API numeric keys:
  // 1=name, 2=id, 3=priority, 12=status, 15=date, 80=entities_id
  const id = pickNum(row.id, row['2']);
  const name = pickStr(row.name, row['1']) || 'Ticket';
  const status = parseStatus(row.status ?? row['12']);
  const priority = pickNum(row.priority, row['3']);
  const dateRaw = row.date ?? row['15'] ?? row.date_creation;
  const date = dateRaw ? String(dateRaw) : undefined;
  const content = row.content ? stripHtml(String(row.content)) : undefined;
  const entities_id = (() => {
    const e = row.entities_id ?? row['80'];
    if (e == null || e === '') return undefined;
    if (typeof e === 'string' && Number.isNaN(Number(e))) return undefined;
    return pickNum(e);
  })();

  return {
    id,
    name,
    status,
    priority,
    date,
    solvedate: row.solvedate ? String(row.solvedate) : null,
    content,
    entities_id,
    location_name: pickStr(row['83'], row.locations_id) || undefined,
    assigned_label: pickStr(row['5']) || undefined,
  };
}

function stripHtml(html: string) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}
