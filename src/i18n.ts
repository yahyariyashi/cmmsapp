/**
 * English, Amharic (አማርኛ) and Afaan Oromoo.
 * tr('English text') returns the translation for the language chosen in More → Language.
 * Missing keys fall back to English, so nothing can break.
 * Edit the translations in src/locales/am.ts and src/locales/om.ts (key = English text, value = translation).
 */
import { getPrefs } from './preferences';
import { AM } from './locales/am';
import { OM } from './locales/om';

export type Lang = 'en' | 'am' | 'om';

export const LANGUAGES: { id: Lang; label: string; english: string }[] = [
  { id: 'en', label: 'English', english: 'English' },
  { id: 'am', label: 'አማርኛ', english: 'Amharic' },
  { id: 'om', label: 'Afaan Oromoo', english: 'Afan Oromo' },
];

/**
 * English wording used on screen (CMMS / medical-equipment maintenance standard: "work orders").
 * Keys stay the original strings so Amharic / Afaan Oromoo lookups keep working.
 */
const EN_STANDARD: Record<string, string> = {
  'Tickets': 'Work orders',
  'All Tickets': 'All work orders',
  'New Ticket': 'New work order',
  'Create ticket': 'Create work order',
  'Open Tickets': 'Open work orders',
  'Recent Tickets': 'Recent work orders',
  'No tickets': 'No work orders',
  'No open tickets. All clear!': 'No open work orders. All clear!',
  'No tickets linked to this machine yet.': 'No work orders for this equipment yet.',
  'Search by ticket # or title': 'Search by work order # or title',
  'Auto-refresh ticket list': 'Auto-refresh work orders',
  'Updates while the Tickets screen is open': 'Updates while the Work orders screen is open',
  'Tickets per page': 'Work orders per page',
  'Ticket may move to Solved.': 'Work order may move to Completed.',
  'Ticket set to Pending.': 'Work order set to On hold.',
  'Ticket was not created': 'Work order was not created',
  'Tickets and assets will be downloaded again.': 'Work orders and equipment will be downloaded again.',
  'You are now assigned to this ticket.': 'You are now assigned to this work order.',
  'Attachment added to the ticket.': 'Attachment added to the work order.',
  '{n} files added to the ticket.': '{n} files added to the work order.',
  'No spare parts found for this ticket': 'No spare parts found for this work order',
  'Spare parts and tools used on this ticket': 'Spare parts and tools used on this work order',
  'On this ticket': 'On this work order',
  'Task recorded on the ticket.': 'Task recorded on the work order.',
  'Linked assets': 'Equipment',
  'Linked asset (item)': 'Equipment',
  'Machine status': 'Equipment status',
  'Select asset': 'Select equipment',
  'Requester approval': 'Requester sign-off',
  'Approve solution & close': 'Approve repair & close',
  'Request more work': 'Reopen / more work needed',
  'Solution': 'Repair / resolution',
  'Post solution': 'Post repair report',
  'No solution recorded': 'No repair report yet',
  'Solved': 'Completed',
  'Solved / closed': 'Completed / closed',
  'Pending': 'On hold',
  'Waiting': 'On hold',
  'Planned': 'Scheduled',
  'Down': 'Out of service',
  'Active': 'In service',
  'Add field note': 'Add work note',
  'Tasks': 'Work tasks',
  'Replaced parts': 'Spare parts used',
};

const TABLES: Record<Lang, Record<string, string> | null> = { en: null, am: AM, om: OM };

/** Translate an English UI string. */
export function tr(text: string): string {
  const table = TABLES[(getPrefs().language as Lang) || 'en'];
  if (!table) return EN_STANDARD[text] ?? text;
  return table[text] ?? EN_STANDARD[text] ?? text;
}

/** Translate a string that has a {n}-style placeholder, e.g. trf('Only {n} in stock', { n: 3 }) */
export function trf(text: string, vars: Record<string, string | number>): string {
  let out = tr(text);
  for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(String(v));
  return out;
}
