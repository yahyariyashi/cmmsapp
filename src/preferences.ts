// User preferences (Settings screen). Persisted on disk, readable anywhere.
import { useSyncExternalStore } from 'react';
import { readJson, writeJson } from './storage';

export type UploadQuality = 'low' | 'medium' | 'high';

export type Prefs = {
  uploadQuality: UploadQuality; // photo compression for attachments
  autoRefresh: boolean; // refresh ticket list while it is open
  refreshMinutes: number; // 1 / 2 / 5 / 10
  pageSize: 25 | 50 | 100; // tickets per page
  language: 'en' | 'am' | 'om'; // English, Amharic or Afaan Oromoo
};

export const DEFAULT_PREFS: Prefs = {
  uploadQuality: 'medium',
  autoRefresh: true,
  refreshMinutes: 2,
  pageSize: 50,
  language: 'en',
};

/** expo-image-picker quality (0–1) for each level */
export const QUALITY_VALUE: Record<UploadQuality, number> = {
  low: 0.4,
  medium: 0.6,
  high: 0.85,
};

const FILE = 'mm_prefs_v1.json';
let current: Prefs = { ...DEFAULT_PREFS };
let loaded = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export async function loadPrefs(): Promise<Prefs> {
  if (loaded) return current;
  loaded = true;
  const saved = await readJson<Partial<Prefs>>(FILE);
  if (saved) {
    current = { ...DEFAULT_PREFS, ...saved };
    emit();
  }
  return current;
}

export function getPrefs(): Prefs {
  return current;
}

export async function setPrefs(patch: Partial<Prefs>): Promise<void> {
  current = { ...current, ...patch };
  emit();
  await writeJson(FILE, current);
}

export function usePrefs(): Prefs {
  void loadPrefs();
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
    () => current
  );
}
