import { tr } from '../../src/i18n';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, ScrollView,
  Image, RefreshControl,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useAuth } from '../../src/context/AuthContext';
import { statusUi } from '../../src/theme';
import { useTheme } from '../../src/context/ThemeContext';
import type { GlpiTicket } from '../../src/types/glpi';
import { cache } from '../../src/cache';
import { ActionIconCircle } from '../../src/components/AppIcon';
import { requestNotificationPermission } from '../../src/notifications';

const TICKET_CACHE = 'home_tickets';
const ASSET_COUNT_CACHE = 'home_asset_count';

function SkeletonCard({ colors }: { colors: any }) {
  return (
    <View style={{ marginHorizontal: 16, gap: 8, marginBottom: 8 }}>
      {[1, 2, 3].map(i => (
        <View key={i} style={{
          backgroundColor: colors.bgCard, borderRadius: 12, padding: 14,
          borderWidth: 1, borderColor: colors.border, flexDirection: 'row', gap: 10
        }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.border, marginTop: 4 }} />
          <View style={{ flex: 1, gap: 6 }}>
            <View style={{ height: 10, width: '50%', backgroundColor: colors.border, borderRadius: 5 }} />
            <View style={{ height: 10, width: '80%', backgroundColor: colors.bgCardAlt, borderRadius: 5 }} />
          </View>
        </View>
      ))}
    </View>
  );
}

import { TicketCard } from '../../src/components/TicketCard';
import { usePrefs } from '../../src/preferences';

export default function HomeScreen() {
  const { colors } = useTheme();
  const { loginName, client, userPicture, realName, userId } = useAuth();
  const [tickets, setTickets] = useState<GlpiTicket[]>(
    () => cache.get<GlpiTicket[]>(TICKET_CACHE) || []
  );
  const [assetCount, setAssetCount] = useState<number>(
    () => cache.get<number>(ASSET_COUNT_CACHE) || 0
  );
  const [refreshing, setRefreshing] = useState(false);
  const [initialLoad, setInitialLoad] = useState(tickets.length === 0);

  const load = useCallback(async (force = false) => {
    if (!client) return;

    // Cold start: paint the last saved list immediately (saved on disk), then refresh below
    await cache.hydrate();
    const stale = cache.getStale<GlpiTicket[]>(TICKET_CACHE);
    if (stale?.length) {
      setTickets((prev) => (prev.length ? prev : stale));
      setInitialLoad(false);
    }

    // Use cache first
    const cachedTickets = cache.get<GlpiTicket[]>(TICKET_CACHE);
    const cachedCount = cache.get<number>(ASSET_COUNT_CACHE);
    if (cachedTickets && cachedCount !== null && !force) {
      setTickets(cachedTickets);
      setAssetCount(cachedCount);
      setInitialLoad(false);
      return;
    }

    force ? setRefreshing(true) : null;
    try {
      // Tickets only on home (fast). Asset count from cache or background.
      const t = await client.getMyTickets('0-40', userId ?? undefined);
      setTickets(t);
      cache.set(TICKET_CACHE, t);
      const urgentCount = t.filter((x) => x.status < 5 && x.priority >= 4).length;
      // Badge only here; real tray push comes from server when tickets change
      void import('../../src/notifications').then((n) => n.setAppBadge(urgentCount));

      const cachedAssets = cache.get<{ length: number } | unknown[]>('assets_list');
      if (Array.isArray(cachedAssets)) {
        setAssetCount(cachedAssets.length);
        cache.set(ASSET_COUNT_CACHE, cachedAssets.length);
      } else {
        // Background count — do not block UI
        client.listDefinedAssets('0-80')
          .then((a) => {
            setAssetCount(a.length);
            cache.set(ASSET_COUNT_CACHE, a.length);
            cache.set('assets_list', a);
          })
          .catch(() => undefined);
      }
    } catch { /* keep previous */ }
    finally {
      setRefreshing(false);
      setInitialLoad(false);
    }
  }, [client]);

  useFocusEffect(useCallback(() => {
    void requestNotificationPermission();
    void load(false);
  }, [load]));

  const openTickets = useMemo(() => tickets.filter((t) => t.status < 5), [tickets]);
  const high   = openTickets.filter((t) => t.priority >= 4).length;
  const medium = openTickets.filter((t) => t.priority === 3).length;
  const low    = openTickets.filter((t) => t.priority <= 2).length;

  const prefs = usePrefs();
  const [isStaff, setIsStaff] = useState(false);
  useEffect(() => {
    void client?.getCapabilities().then((c) => setIsStaff(c.isStaff));
  }, [client]);
  const assignedToMe = useMemo(() => {
    const me = (realName || '').trim().toLowerCase();
    if (!me) return 0;
    return openTickets.filter((t) => (t.assigned_label || '').toLowerCase().includes(me)).length;
  }, [openTickets, realName]);

  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={{ paddingBottom: 32 }}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => load(true)}
          tintColor={colors.accent} colors={[colors.accent]} />
      }
    >
      {/* Header */}
      <View style={styles.topBar}>
        <View style={styles.logoWrap}>
          <Image source={require('../../assets/icon.png')} style={styles.logo} resizeMode="contain" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.brand}>{tr('MedMetric CMMS')}</Text>
          <Text style={styles.sub}>{tr('Healthcare Equipment Maintenance')}</Text>
        </View>
        <Pressable style={styles.userChip} onPress={() => router.push('/(tabs)/more')}>
          <Text style={styles.userChipName} numberOfLines={1}>
            {realName || loginName || 'User'}
          </Text>
          {userPicture ? (
            <Image source={{ uri: userPicture }} style={styles.userPic} />
          ) : (
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>
                {(realName || loginName || 'U').charAt(0).toUpperCase()}
              </Text>
            </View>
          )}
        </Pressable>
      </View>

      {/* Welcome */}
      <Text style={styles.hello}>
        {tr('Welcome back')}, {(realName || loginName || 'Technician').split(' ')[0]}
      </Text>

      {/* Stats card */}
      <View style={styles.statCard}>
        <View style={styles.statRow}>
          <Text style={styles.statLabel}>{tr('Open Tickets')}</Text>
          {high > 0 && (
            <Pressable
              style={[styles.urgentBadge, { backgroundColor: colors.danger + '18' }]}
              onPress={() => router.push({ pathname: '/(tabs)/tickets', params: { priority: 'urgent' } })}
            >
              <View style={[styles.urgentDot, { backgroundColor: colors.danger }]} />
              <Text style={[styles.urgentText, { color: colors.danger }]}>{high} {tr('urgent')}</Text>
            </Pressable>
          )}
        </View>
        <Text style={styles.statBig}>{openTickets.length}</Text>
        <Text style={styles.statMeta}>
          {assetCount} {tr('medical devices tracked')}
          {assignedToMe > 0 ? ` · ${assignedToMe} ${tr('assigned to you')}` : ''}
        </Text>

        {/* Priority bar */}
        <View style={styles.barTrack}>
          <View style={[styles.barSeg, { flex: Math.max(high, 0.01), backgroundColor: colors.danger }]} />
          <View style={[styles.barSeg, { flex: Math.max(medium, 0.01), backgroundColor: colors.warning }]} />
          <View style={[styles.barSeg, { flex: Math.max(low, 0.01), backgroundColor: colors.success }]} />
        </View>
        <View style={styles.legendRow}>
          <Pressable onPress={() => router.push({ pathname: '/(tabs)/tickets', params: { priority: 'urgent' } })}>
            <Text style={styles.legend}>{tr('Urgent')} {high}</Text>
          </Pressable>
          <Pressable onPress={() => router.push({ pathname: '/(tabs)/tickets', params: { priority: 'medium' } })}>
            <Text style={styles.legend}>{tr('Medium')} {medium}</Text>
          </Pressable>
          <Pressable onPress={() => router.push({ pathname: '/(tabs)/tickets', params: { priority: 'low' } })}>
            <Text style={styles.legend}>{tr('Low')} {low}</Text>
          </Pressable>
        </View>
      </View>

      {/* Quick actions */}
      <View style={styles.actions}>
        <Pressable style={styles.action} onPress={() => router.push('/ticket/new')}>
          <ActionIconCircle
            name="add-circle-outline"
            fallback="+"
            color={colors.accent}
            bg={colors.accent + '22'}
          />
          <Text style={styles.actionText}>{tr('New Ticket')}</Text>
        </Pressable>
        <Pressable style={styles.action} onPress={() => router.push('/(tabs)/equipment')}>
          <ActionIconCircle
            name="hardware-chip-outline"
            fallback="⚙"
            color={colors.accent}
            bg={colors.accent + '22'}
          />
          <Text style={styles.actionText}>{tr('Equipment')}</Text>
        </Pressable>
        {isStaff ? (
          <Pressable style={styles.action} onPress={() => router.push('/ticket/scan')}>
            <ActionIconCircle name="qr-code-outline" fallback="▣" color={colors.accent} bg={colors.accent + '22'} />
            <Text style={styles.actionText}>{tr('Scan QR')}</Text>
          </Pressable>
        ) : (
          <Pressable style={styles.action} onPress={() => router.push('/(tabs)/tickets')}>
            <ActionIconCircle name="ticket-outline" fallback="☰" color={colors.accent} bg={colors.accent + '22'} />
            <Text style={styles.actionText}>{tr('All Tickets')}</Text>
          </Pressable>
        )}
      </View>

      {/* Recent tickets */}
      <View style={styles.sectionRow}>
        <Text style={styles.section}>{tr('Recent Tickets')}</Text>
        <Pressable onPress={() => router.push('/(tabs)/tickets')}>
          <Text style={[styles.seeAll, { color: colors.accent }]}>{tr('See all →')}</Text>
        </Pressable>
      </View>

      {initialLoad ? (
        <SkeletonCard colors={colors} />
      ) : openTickets.length === 0 ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyIcon}>✅</Text>
          <Text style={[styles.emptyText, { color: colors.textMuted }]}>
            {tr('No open tickets. All clear!')}
          </Text>
        </View>
      ) : (
        <View style={{ paddingHorizontal: 12 }}>
          {openTickets.slice(0, 6).map((t) => (
            <TicketCard key={t.id} item={t} />
          ))}
        </View>
      )}
    </ScrollView>
  );
}

function makeStyles(colors: any) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    topBar: {
      flexDirection: 'row', alignItems: 'center',
      paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10, gap: 12,
      backgroundColor: colors.header,
    },
    logoWrap: {
      width: 44, height: 44, borderRadius: 10,
      backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
    },
    logo: { width: 44, height: 44 },
    userChip: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      maxWidth: 140,
    },
    userChipName: { color: colors.white, fontSize: 12, fontWeight: '600', flexShrink: 1 },
    userPic: { width: 38, height: 38, borderRadius: 10 },
    avatar: {
      width: 38, height: 38, borderRadius: 10,
      backgroundColor: colors.accent + '40',
      alignItems: 'center', justifyContent: 'center',
    },
    avatarText: { color: colors.white, fontWeight: '800', fontSize: 16 },
    brand: { color: colors.white, fontWeight: '700', fontSize: 16 },
    sub: { color: colors.white + 'AA', fontSize: 11, marginTop: 2 },
    helloSub: { color: colors.textMuted, fontSize: 12, paddingHorizontal: 16, marginTop: 2, marginBottom: 12 },
    hello: {
      color: colors.text, paddingHorizontal: 16,
      marginTop: 14, fontSize: 18, fontWeight: '700',
    },
    statCard: {
      marginHorizontal: 16, backgroundColor: colors.bgCard,
      borderRadius: 16, padding: 18, borderWidth: 1, borderColor: colors.border,
      shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 2 },
    },
    statRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    statLabel: { color: colors.textMuted, fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
    urgentBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
    urgentDot: { width: 7, height: 7, borderRadius: 4 },
    urgentText: { fontSize: 12, fontWeight: '700' },
    statBig: { color: colors.text, fontSize: 52, fontWeight: '800', marginTop: 4, lineHeight: 58 },
    statMeta: { color: colors.textMuted, fontSize: 12, marginBottom: 14 },
    barTrack: { flexDirection: 'row', height: 6, borderRadius: 4, overflow: 'hidden', gap: 2 },
    barSeg: { height: 6, borderRadius: 3 },
    legendRow: { flexDirection: 'row', gap: 16, marginTop: 8 },
    legend: { color: colors.textDim, fontSize: 11 },
    actions: { flexDirection: 'row', marginHorizontal: 16, marginTop: 16, gap: 10 },
    actionIconWrap: {
      width: 48, height: 48, borderRadius: 14,
      alignItems: 'center', justifyContent: 'center', marginBottom: 6,
    },
    action: { flex: 1, backgroundColor: colors.bgCard, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 8, alignItems: 'center', borderWidth: 1, borderColor: colors.border },
    actionIcon: { fontSize: 24 },
    actionText: { color: colors.text, fontWeight: '700', fontSize: 12, marginTop: 8 },
    sectionRow: {
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      marginHorizontal: 16, marginTop: 22, marginBottom: 10,
    },
    section: { color: colors.text, fontWeight: '700', fontSize: 16 },
    seeAll: { fontSize: 13, fontWeight: '600' },
    alertRow: {
      flexDirection: 'row', marginHorizontal: 16, marginBottom: 8,
      backgroundColor: colors.bgCard, borderRadius: 12,
      borderWidth: 1, borderColor: colors.border, overflow: 'hidden',
    },
    priorityBar: { width: 4 },
    alertTop: {
      flexDirection: 'row', justifyContent: 'space-between',
      alignItems: 'center', paddingHorizontal: 12, paddingTop: 10,
    },
    alertId: { fontWeight: '700', fontSize: 11 },
    statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
    statusText: { fontSize: 10, fontWeight: '700' },
    alertTitle: { fontWeight: '600', fontSize: 14, paddingHorizontal: 12, marginTop: 4 },
    alertDate: { fontSize: 11, paddingHorizontal: 12, paddingBottom: 10, marginTop: 3 },
    emptyBox: { alignItems: 'center', paddingVertical: 40, gap: 8 },
    emptyIcon: { fontSize: 36 },
    emptyText: { fontSize: 14 },
  });
}
