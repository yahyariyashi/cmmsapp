// Small shared helpers for the card-style screens.
import { tr } from './i18n';

const PRIORITY_EN: Record<number, string> = {
  1: 'Very low',
  2: 'Low',
  3: 'Medium',
  4: 'High',
  5: 'Very high',
  6: 'Major',
};

export function priorityLabel(p: number): string {
  return PRIORITY_EN[p] || `P${p}`;
}

/** Red for high, orange for medium, green for low. Colors come from the active theme. */
export function priorityColor(p: number, c: { danger: string; warning: string; success: string }): string {
  if (p >= 4) return c.danger;
  if (p === 3) return c.warning;
  return c.success;
}

/** "2026-10-03 19:22:00" -> "Oct 3, 07:22 PM" (falls back to the original text). */
export function shortDate(raw?: string): string {
  if (!raw) return '';
  const m = String(raw).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) return String(raw);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const mon = months[Number(m[2]) - 1] || m[2];
  let h = Number(m[4]);
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${mon} ${Number(m[3])}, ${String(h).padStart(2, '0')}:${m[5]} ${ap}`;
}

/** Assigned line for a ticket card. */
export function assignedLine(name?: string): string {
  const n = (name || '').split('$#$').map((s) => s.trim()).filter(Boolean).join(', ');
  return n ? `${tr('Assigned')} · ${n}` : tr('Unassigned');
}
