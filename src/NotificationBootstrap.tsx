import { useEffect, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { router } from 'expo-router';
import { useAuth } from './context/AuthContext';
import {
  requestNotificationPermission,
  addNotificationResponseListener,
  setAppBadge,
  registerDeviceForPush,
  getExpoPushTokenAsync,
} from './notifications';
import { cache } from './cache';
import type { GlpiTicket } from './types/glpi';

export function NotificationBootstrap() {
  const { client, userId, loginName, config } = useAuth();
  const registered = useRef(false);

  useEffect(() => {
    try {
      void requestNotificationPermission().catch(() => undefined);
      const sub = addNotificationResponseListener((data) => {
        try {
          if (data?.screen === 'tickets' || data?.type === 'ticket') {
            const id = data.ticket_id ? String(data.ticket_id) : '';
            if (id) {
              router.push({ pathname: '/ticket/[id]', params: { id } });
            } else {
              router.push({
                pathname: '/(tabs)/tickets',
                params: { priority: String(data.priority || 'all') },
              });
            }
          }
        } catch {
          /* ignore nav errors */
        }
      });
      return () => {
        try {
          sub.remove();
        } catch {
          /* ignore */
        }
      };
    } catch {
      return undefined;
    }
  }, []);

  useEffect(() => {
    if (!userId || !config?.baseUrl || registered.current) return;
    void (async () => {
      try {
        await requestNotificationPermission();
        await getExpoPushTokenAsync();
        const result = await registerDeviceForPush({
          glpiBaseUrl: config.baseUrl,
          userId,
          loginName: loginName || undefined,
        });
        if (result.ok) registered.current = true;
      } catch {
        /* push is optional — never crash the app */
      }
    })();
  }, [userId, config?.baseUrl, loginName]);

  useEffect(() => {
    const onChange = async (next: AppStateStatus) => {
      if (next !== 'active' || !client) return;
      try {
        const t = await client.getMyTickets('0-40', userId ?? undefined);
        const urgent = t.filter((x) => x.status < 5 && x.priority >= 4).length;
        await setAppBadge(urgent);
        cache.set('home_tickets', t);
      } catch {
        try {
          const cached = cache.get<GlpiTicket[]>('home_tickets') || [];
          const urgent = cached.filter(
            (x) => x.status < 5 && x.priority >= 4
          ).length;
          await setAppBadge(urgent);
        } catch {
          /* ignore */
        }
      }
    };
    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
  }, [client, userId]);

  return null;
}
