/**
 * Safe wrappers around expo-secure-store.
 * SecureStore only accepts strings — never pass numbers, objects, null, or undefined.
 */
import * as SecureStore from 'expo-secure-store';

/** Coerce any value to a string suitable for SecureStore, or null if empty. */
export function toSecureString(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'string') {
    const s = value.trim();
    return s.length ? s : null;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  // Objects / arrays → JSON
  try {
    const json = JSON.stringify(value);
    return json && json !== 'null' ? json : null;
  } catch {
    return null;
  }
}

export async function secureSet(key: string, value: unknown): Promise<void> {
  const str = toSecureString(value);
  if (str == null) {
    // Nothing useful to store — remove key if present
    try {
      await SecureStore.deleteItemAsync(key);
    } catch {
      /* ignore */
    }
    return;
  }
  await SecureStore.setItemAsync(key, str);
}

export async function secureGet(key: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

export async function secureDelete(key: string): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(key);
  } catch {
    /* ignore */
  }
}

/** Parse a previously JSON-encoded value; returns null on failure. */
export function secureParseJson<T = unknown>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
