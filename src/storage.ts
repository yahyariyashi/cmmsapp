/**
 * Tiny JSON-on-disk helper (expo-file-system, already a dependency).
 * Every call is wrapped so a storage failure never crashes the app.
 */
import * as FileSystem from 'expo-file-system';

const dir = () => FileSystem.documentDirectory || '';

export async function readJson<T>(name: string): Promise<T | null> {
  try {
    const path = dir() + name;
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists) return null;
    const raw = await FileSystem.readAsStringAsync(path);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export async function writeJson(name: string, value: unknown): Promise<void> {
  try {
    await FileSystem.writeAsStringAsync(dir() + name, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

export async function removeFile(name: string): Promise<void> {
  try {
    await FileSystem.deleteAsync(dir() + name, { idempotent: true });
  } catch {
    /* ignore */
  }
}
