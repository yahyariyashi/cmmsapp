// Notes written without a connection are saved here and sent automatically later.
import { readJson, writeJson } from './storage';
import type { GlpiClient } from './api/glpiClient';

export type QueuedNote = {
  id: string;
  ticketId: number;
  content: string;
  createdAt: string;
  userId: number | null; // only this user's session may send it
};

const FILE = 'mm_offline_queue_v1.json';
let items: QueuedNote[] | null = null;
let flushing = false;

async function load(): Promise<QueuedNote[]> {
  if (items) return items;
  items = (await readJson<QueuedNote[]>(FILE)) || [];
  return items;
}

async function save() {
  await writeJson(FILE, items || []);
}

export async function enqueueFollowup(n: Omit<QueuedNote, 'id' | 'createdAt'>): Promise<void> {
  const list = await load();
  list.push({
    ...n,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    createdAt: new Date().toISOString(),
  });
  await save();
}

export async function pendingCount(): Promise<number> {
  return (await load()).length;
}

export async function clearQueue(): Promise<void> {
  items = [];
  await save();
}

/** Send what we can. Network errors keep the note queued; server rejections drop it after reporting. */
export async function flushQueue(
  client: GlpiClient | null,
  userId: number | null
): Promise<{ sent: number; failed: number; left: number }> {
  if (!client || flushing) return { sent: 0, failed: 0, left: (await load()).length };
  flushing = true;
  let sent = 0;
  let failed = 0;
  try {
    const list = await load();
    const keep: QueuedNote[] = [];
    for (const n of list) {
      if (n.userId && userId && n.userId !== userId) {
        keep.push(n); // belongs to another account on this phone
        continue;
      }
      try {
        await client.addTicketFollowup(n.ticketId, n.content);
        sent++;
      } catch (e) {
        if ((e as { isNetworkError?: boolean })?.isNetworkError) {
          keep.push(n); // still offline
        } else {
          failed++; // rejected by server (rights / ticket closed) — do not retry forever
        }
      }
    }
    items = keep;
    await save();
    return { sent, failed, left: keep.length };
  } finally {
    flushing = false;
  }
}
