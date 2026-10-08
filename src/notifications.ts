import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const CHANNEL_ID = 'medmetric-alerts';
const TOKEN_KEY = 'expo_push_token';

type NotificationsModule = typeof import('expo-notifications');
let Notifications: NotificationsModule | null = null;

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Notifications = require('expo-notifications');
  Notifications!.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    }),
  });
} catch {
  Notifications = null;
}

export async function ensureNotificationChannel() {
  if (!Notifications || Platform.OS !== 'android') return;
  try {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'CMMS ticket alerts',
      description: 'New and updated maintenance tickets',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#0D7377',
      showBadge: true,
    });
  } catch {
    /* ignore */
  }
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (!Notifications) return false;
  try {
    await ensureNotificationChannel();
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;
    const asked = await Notifications.requestPermissionsAsync();
    return !!asked.granted;
  } catch {
    return false;
  }
}

export async function getNotificationPermissionStatus(): Promise<
  'granted' | 'denied' | 'undetermined'
> {
  if (!Notifications) return 'undetermined';
  try {
    const p = await Notifications.getPermissionsAsync();
    if (p.granted) return 'granted';
    if (p.canAskAgain === false) return 'denied';
    return 'undetermined';
  } catch {
    return 'undetermined';
  }
}

export async function setAppBadge(count: number) {
  if (!Notifications) return;
  try {
    await Notifications.setBadgeCountAsync(Math.max(0, count));
  } catch {
    /* ignore */
  }
}

export async function showTrayAlert(opts: {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}) {
  if (!Notifications) return;
  try {
    const ok = await requestNotificationPermission();
    if (!ok) return;
    await ensureNotificationChannel();
    await Notifications.scheduleNotificationAsync({
      content: {
        title: opts.title,
        body: opts.body,
        data: opts.data || {},
        sound: true,
      },
      trigger: null,
    });
  } catch {
    /* ignore */
  }
}

export async function notifyUrgentTickets(count: number) {
  await setAppBadge(count);
  if (count <= 0) return;
  await showTrayAlert({
    title: 'medMETRIC CMMS',
    body:
      count === 1
        ? '1 urgent ticket needs attention'
        : `${count} urgent tickets need attention`,
    data: { screen: 'tickets', priority: 'urgent' },
  });
}

export async function getExpoPushTokenAsync(): Promise<string | null> {
  if (!Notifications) return null;
  try {
    const ok = await requestNotificationPermission();
    if (!ok) return null;
    const token = await Notifications.getExpoPushTokenAsync();
    const value =
      typeof token?.data === 'string'
        ? token.data
        : token?.data != null
          ? String(token.data)
          : null;
    if (value) {
      try {
        await SecureStore.setItemAsync(TOKEN_KEY, value);
      } catch {
        /* SecureStore may reject non-string — already coerced */
      }
    }
    return value;
  } catch {
    try {
      return await SecureStore.getItemAsync(TOKEN_KEY);
    } catch {
      return null;
    }
  }
}

export async function registerDeviceForPush(opts: {
  glpiBaseUrl: string;
  userId: number;
  loginName?: string;
  bridgePath?: string;
}): Promise<{ ok: boolean; token?: string; error?: string }> {
  try {
    const token = await getExpoPushTokenAsync();
    if (!token) {
      return { ok: false, error: 'No push token' };
    }
    const base = opts.glpiBaseUrl.replace(/\/+$/, '');
    const path = opts.bridgePath || '/medmetric-push/register.php';
    const url = base.replace(/\/apirest\.php$/i, '') + path;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token,
        user_id: opts.userId,
        login: opts.loginName || '',
        platform: Platform.OS,
        app: 'medmetric-cmms',
      }),
    });
    if (!res.ok) return { ok: false, token, error: `HTTP ${res.status}` };
    return { ok: true, token };
  } catch (e: unknown) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Register failed',
    };
  }
}

export function addNotificationResponseListener(
  handler: (data: Record<string, unknown>) => void
) {
  if (!Notifications) {
    return { remove: () => undefined };
  }
  try {
    return Notifications.addNotificationResponseReceivedListener((response) => {
      const data = (response.notification.request.content.data ||
        {}) as Record<string, unknown>;
      handler(data);
    });
  } catch {
    return { remove: () => undefined };
  }
}

export function addNotificationReceivedListener(
  handler: (title: string, body: string) => void
) {
  if (!Notifications) {
    return { remove: () => undefined };
  }
  try {
    return Notifications.addNotificationReceivedListener((n) => {
      handler(
        n.request.content.title || 'medMETRIC CMMS',
        n.request.content.body || ''
      );
    });
  } catch {
    return { remove: () => undefined };
  }
}
