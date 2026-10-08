export type GlpiSession = {
  session_token: string;
  glpi?: Record<string, unknown>;
};

export type GlpiTicket = {
  id: number;
  name: string;
  status: number;
  priority: number;
  date?: string;
  solvedate?: string | null;
  content?: string;
  entities_id?: number;
  location_name?: string; // ward / location, shown on the card
  assigned_label?: string; // technician name(s), shown on the card
};

export type GlpiSearchResult<T = Record<string, unknown>> = {
  totalcount: number;
  count: number;
  data: T[];
};

export type ConnectionConfig = {
  baseUrl: string;
  appToken: string;
};
