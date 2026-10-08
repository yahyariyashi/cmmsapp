import { tr } from '../../src/i18n';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  RefreshControl,
  Pressable,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { useFocusEffect, router, useLocalSearchParams } from 'expo-router';
import { useAuth } from '../../src/context/AuthContext';
import type { GlpiTicket } from '../../src/types/glpi';
import { statusUi } from '../../src/theme';
import { useTheme } from '../../src/context/ThemeContext';
import { cache } from '../../src/cache';
import { usePrefs } from '../../src/preferences';
import { flushQueue } from '../../src/offlineQueue';
import { TicketCard } from '../../src/components/TicketCard';

const TICKETS_KEY = 'tickets_list_v2';

const FILTERS = ['All', 'New', 'In progress', 'Waiting', 'Solved', 'Closed'] as const;

export default function TicketsScreen() {
  const { colors } = useTheme();
  const { client, userId } = useAuth();
  const params = useLocalSearchParams<{ priority?: string }>();
  const [items, setItems] = useState<GlpiTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('All');
  const [priorityFilter, setPriorityFilter] = useState<'all' | 'urgent' | 'medium' | 'low'>(
    params.priority === 'urgent' || params.priority === 'medium' || params.priority === 'low'
      ? params.priority
      : 'all'
  );
  const [error, setError] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');

  const prefs = usePrefs();
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const pageRef = useRef(1);

  const load = useCallback(async () => {
    if (!client) return;
    setError(null);
    // 1) show the last known list instantly (works offline too)
    await cache.hydrate();
    const stale = cache.getStale<GlpiTicket[]>(TICKETS_KEY);
    if (stale?.length) setItems((prev) => (prev.length ? prev : stale));
    setLoading(true);
    try {
      // 2) refresh from the server in the background
      const size = prefs.pageSize;
      const list = await client.getMyTickets(`0-${size - 1}`, userId ?? undefined);
      setItems(list);
      cache.set(TICKETS_KEY, list);
      pageRef.current = 1;
      setHasMore(list.length >= size);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [client, userId, prefs.pageSize]);

  const loadMore = useCallback(async () => {
    if (!client || loadingMore || loading || !hasMore) return;
    setLoadingMore(true);
    try {
      const size = prefs.pageSize;
      const start = pageRef.current * size;
      const next = await client.getMyTickets(`${start}-${start + size - 1}`);
      pageRef.current += 1;
      setHasMore(next.length >= size);
      setItems((prev) => {
        const seen = new Set(prev.map((t) => t.id));
        return [...prev, ...next.filter((t) => !seen.has(t.id))];
      });
    } catch {
      /* keep what we have; pull to refresh retries */
    } finally {
      setLoadingMore(false);
    }
  }, [client, loadingMore, loading, hasMore, prefs.pageSize]);

  useFocusEffect(
    useCallback(() => {
      if (params.priority === 'urgent' || params.priority === 'medium' || params.priority === 'low') {
        setPriorityFilter(params.priority);
      }
      void load();
      void flushQueue(client, userId); // send notes written offline
      let timer: ReturnType<typeof setInterval> | undefined;
      if (prefs.autoRefresh) {
        timer = setInterval(() => void load(), Math.max(1, prefs.refreshMinutes) * 60000);
      }
      return () => {
        if (timer) clearInterval(timer);
      };
    }, [load, params.priority, prefs.autoRefresh, prefs.refreshMinutes, client, userId])
  );

  // New / Assigned / Planned first, then Pending, then Solved / Closed; newest id within group
  const statusRank = (s: number) => {
    if (s === 1 || s === 2 || s === 3) return 0; // New, Assigned, Planned
    if (s === 4) return 1; // Pending / Waiting
    if (s === 5 || s === 6) return 2; // Solved, Closed
    return 3;
  };

  const statusFiltered = useMemo(() => {
    const base =
      filter === 'All'
        ? items
        : items.filter((t) => (statusUi[t.status]?.filter || '') === filter);
    return [...base].sort((a, b) => {
      const ra = statusRank(a.status);
      const rb = statusRank(b.status);
      if (ra !== rb) return ra - rb;
      return b.id - a.id; // newest first inside group
    });
  }, [items, filter]);

  const priorityFiltered =
    priorityFilter === 'urgent'
      ? statusFiltered.filter((t) => t.priority >= 4)
      : priorityFilter === 'medium'
        ? statusFiltered.filter((t) => t.priority === 3)
        : priorityFilter === 'low'
          ? statusFiltered.filter((t) => t.priority <= 2)
          : statusFiltered;

  const q = query.trim().toLowerCase();
  const filtered = q
    ? priorityFiltered.filter(
        (t) => String(t.id).includes(q) || t.name.toLowerCase().includes(q)
      )
    : priorityFiltered;

  const openCount = items.filter((t) => t.status < 5).length;

  const styles = useMemo(() => makeStyles(colors), [colors]);

  if (loading && items.length === 0) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.hTitle}>{tr('Tickets')}</Text>
        <Text style={styles.hSub}>
          {openCount} {tr('open')}
        </Text>
      </View>

      <FlatList
        horizontal
        data={[...FILTERS]}
        keyExtractor={(f) => f}
        showsHorizontalScrollIndicator={false}
        style={styles.chips}
        contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 8, paddingRight: 24, alignItems: 'center' }}
        renderItem={({ item: f }) => (
          <Pressable onPress={() => setFilter(f)} style={[styles.chip, filter === f && styles.chipOn]}>
            <Text style={[styles.chipText, filter === f && styles.chipTextOn]} numberOfLines={1}>
              {tr(f)}
            </Text>
          </Pressable>
        )}
      />

      <View style={styles.searchBar}>
        <TextInput
          style={styles.searchInput}
          placeholder={tr('Search by ticket # or title')}
          placeholderTextColor={colors.textDim}
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
        />
      </View>

      {priorityFilter !== 'all' ? (
        <Pressable onPress={() => setPriorityFilter('all')} style={styles.prioBanner}>
          <Text style={{ color: colors.accent, fontWeight: '700', fontSize: 13 }}>
            Showing {priorityFilter} priority only — tap to show all
          </Text>
        </Pressable>
      ) : null}

      <FlatList
        data={filtered}
        keyExtractor={(item) => String(item.id)}
        onEndReached={loadMore}
        onEndReachedThreshold={0.4}
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        windowSize={7}
        removeClippedSubviews
        ListFooterComponent={
          loadingMore ? <ActivityIndicator style={{ marginVertical: 16 }} color={colors.accent} /> : null
        }
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={() => void load()} tintColor={colors.accent} />
        }
        contentContainerStyle={{ paddingBottom: 110, paddingHorizontal: 12, paddingTop: 4 }}
        ListEmptyComponent={<Text style={styles.empty}>{error || tr('No tickets')}</Text>}
        renderItem={({ item }) => <TicketCard item={item} />}
      />

      <Pressable style={styles.fab} onPress={() => router.push('/ticket/new')}>
        <Text style={styles.fabPlus}>+</Text>
      </Pressable>
    </View>
  );
}

function makeStyles(colors: any) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bg },
    header: { backgroundColor: colors.header, paddingHorizontal: 16, paddingTop: 36, paddingBottom: 12 },
    hTitle: { color: '#FFFFFF', fontSize: 20, fontWeight: '700' },
    hSub: { color: '#FFFFFFB3', fontSize: 12, marginTop: 2 },
    searchBar: { paddingHorizontal: 12, marginBottom: 6 },
    searchInput: {
      backgroundColor: colors.bgCard, borderRadius: 14, borderWidth: 1, borderColor: colors.border,
      paddingHorizontal: 14, paddingVertical: 11, color: colors.text, fontSize: 14,
    },
    prioBanner: { marginHorizontal: 12, marginBottom: 8, padding: 10, borderRadius: 10, backgroundColor: colors.accent + '18' },
    chips: { flexGrow: 0, maxHeight: 56 },
    chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: colors.chip, marginRight: 8, minHeight: 36, justifyContent: 'center' },
    chipOn: { backgroundColor: colors.chipOn },
    chipText: { color: colors.textMuted, fontWeight: '600', fontSize: 12 },
    chipTextOn: { color: colors.chipOnText },
    card: {
      backgroundColor: colors.bgCard,
      borderRadius: 16,
      marginTop: 10,
      paddingHorizontal: 14,
      paddingVertical: 12,
      borderWidth: 1,
      borderColor: colors.border,
      elevation: 1,
      shadowColor: '#0B2A44',
      shadowOpacity: 0.06,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 2 },
    },
    cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    id: { color: colors.textDim, fontSize: 12 },
    badge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 12, borderWidth: 1 },
    badgeText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.4 },
    name: { color: colors.text, fontSize: 15, fontWeight: '700', marginTop: 4 },
    metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginTop: 8, gap: 10 },
    dot: { width: 8, height: 8, borderRadius: 4, marginRight: -4 },
    metaStrong: { fontSize: 11, fontWeight: '700' },
    meta: { color: colors.textMuted, fontSize: 11, flexShrink: 1 },
    assigned: { color: colors.textDim, fontSize: 11, marginTop: 8 },
    empty: { textAlign: 'center', color: colors.textMuted, marginTop: 40 },
    fab: {
      position: 'absolute', right: 18, bottom: 22, width: 56, height: 56, borderRadius: 28,
      backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', elevation: 6,
      shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 6, shadowOffset: { width: 0, height: 3 },
    },
    fabPlus: { color: colors.chipOnText, fontSize: 30, fontWeight: '400', marginTop: -2 },
  });
}
