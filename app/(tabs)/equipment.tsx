import { tr } from '../../src/i18n';
import { useCallback, useMemo, useState } from 'react';
import {
  View, Text, FlatList, StyleSheet, RefreshControl,
  Pressable, SectionList, TextInput, Modal, ScrollView,
} from 'react-native';
import { useFocusEffect, router } from 'expo-router';
import { useAuth } from '../../src/context/AuthContext';
import type { GlpiAssetRow } from '../../src/api/glpiClient';
import { useTheme } from '../../src/context/ThemeContext';
import { isAssetDown } from '../../src/api/glpiClient';
import { cache } from '../../src/cache';

const CACHE_KEY = 'assets_list';

function SkeletonRow({ colors }: { colors: any }) {
  return (
    <View style={[skStyles.row, { borderColor: colors.border, backgroundColor: colors.bgCard }]}>
      <View style={[skStyles.dot, { backgroundColor: colors.border }]} />
      <View style={{ flex: 1, gap: 8 }}>
        <View style={[skStyles.line, { width: '70%', backgroundColor: colors.border }]} />
        <View style={[skStyles.line, { width: '40%', backgroundColor: colors.bgCardAlt }]} />
        <View style={[skStyles.line, { width: '55%', backgroundColor: colors.bgCardAlt }]} />
      </View>
    </View>
  );
}

const skStyles = StyleSheet.create({
  row: { flexDirection: 'row', borderRadius: 14, padding: 14, marginBottom: 8, borderWidth: 1, gap: 10 },
  dot: { width: 10, height: 10, borderRadius: 5, marginTop: 5 },
  line: { height: 10, borderRadius: 5 },
});

export default function EquipmentScreen() {
  const { colors } = useTheme();
  const { client } = useAuth();
  const [items, setItems] = useState<GlpiAssetRow[]>(() => cache.get<GlpiAssetRow[]>(CACHE_KEY) || []);
  const [loading, setLoading] = useState(items.length === 0);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>('all');
  const [typeMenuOpen, setTypeMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');

  const load = useCallback(async (forceRefresh = false) => {
    if (!client) return;

    // Cold start: show the last saved list immediately (kept on disk), then refresh
    await cache.hydrate();
    const stale = cache.getStale<GlpiAssetRow[]>(CACHE_KEY);
    if (stale?.length) {
      setItems((prev) => (prev.length ? prev : stale));
      setLoading(false);
    }

    // Show cached data instantly, then refresh in background
    const cached = cache.get<GlpiAssetRow[]>(CACHE_KEY);
    // Empty array is truthy in JS — must not treat "0 assets" cache as final success
    if (cached && cached.length > 0 && !forceRefresh) {
      setItems(cached);
      setLoading(false);
      // Soft refresh in background
      void (async () => {
        try {
          const list = await client.listDefinedAssets();
          setItems(list);
          cache.set(CACHE_KEY, list);
        } catch { /* keep cache */ }
      })();
      return;
    }

    if (forceRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const list = await client.listDefinedAssets();
      setItems(list);
      cache.set(CACHE_KEY, list);
      if (!list.length) setError(`No assets visible for this account. Confirm the user can see assets on the web under the same login.\n\nDetails: ${client.lastAssetProbe || 'none'}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load assets');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [client]);

  useFocusEffect(
    useCallback(() => {
      void load(false);
    }, [load])
  );

  const types = useMemo(() => {
    const s = new Set(
      items.map((i) => (i.type_label || 'Other').trim()).filter(Boolean)
    );
    return ['all', ...Array.from(s).sort()];
  }, [items]);

  // Normalize so "Hemodialysis Machine" matches variants from AllAssets
  const norm = (s: string) =>
    s.toLowerCase().replace(/\s+/g, ' ').replace(/asset$/i, '').trim();

  const typeFiltered = useMemo(() => {
    if (filter === 'all') return items;
    const f = norm(filter);
    return items.filter((i) => {
      const lab = norm(i.type_label || '');
      return lab === f || lab.includes(f) || f.includes(lab);
    });
  }, [items, filter]);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    // SN / text search always spans all loaded assets (ignore type filter)
    const base = q ? items : typeFiltered;
    if (!q) return base;
    return base.filter((i) =>
      [i.name, i.serial, i.otherserial, i.location_name, i.entity_name, i.type_label]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    );
  }, [typeFiltered, items, q]);

  const sections = useMemo(() => {
    const map = new Map<string, GlpiAssetRow[]>();
    for (const a of filtered) {
      const key = a.location_name || a.entity_name || 'Unassigned';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(a);
    }
    return Array.from(map.entries()).map(([title, data]) => ({
      title: String(title).split('>').pop()!.trim().toUpperCase(),
      data,
    }));
  }, [filtered]);


  const typeLabel = (t: string) => {
    if (t === 'all') return 'All equipment';
    const map: Record<string, string> = {
      HemodialysisMachines: 'Hemodialysis machines',
      WaterTreatment: 'Water treatment',
      Appliance: 'Appliances',
      BiomedicalAndMechanicalTools: 'Biomedical & mechanical tools',
    };
    return map[t] || t.replace(/([A-Z])/g, ' $1').trim();
  };

  const styles = makeStyles(colors);

  return (
    <View style={styles.root}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.hTitle}>{tr('Equipment')}</Text>
          <Text style={styles.hSub}>
            {loading && items.length === 0
              ? tr('Loading...')
              : q
                ? `${filtered.length} ${tr('matches')}`
                : `${filtered.length} ${tr('devices')}`}
          </Text>
        </View>
      </View>

      {/* Search */}
      <View style={styles.searchBar}>
        <TextInput
          style={styles.searchInput}
          placeholder={tr('Search name, serial, or location')}
          placeholderTextColor={colors.textDim}
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
        />
      </View>

      {/* Type chips */}
      <FlatList
        horizontal
        data={types}
        keyExtractor={(t) => t}
        showsHorizontalScrollIndicator={false}
        style={styles.chips}
        contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 6, paddingRight: 24, alignItems: 'center' }}
        renderItem={({ item: t }) => (
          <Pressable onPress={() => setFilter(t)} style={[styles.chip, filter === t && styles.chipOn]}>
            <Text style={[styles.chipText, filter === t && styles.chipTextOn]} numberOfLines={1}>
              {t === 'all' ? tr('All Types') : typeLabel(t)}
            </Text>
          </Pressable>
        )}
      />

      {/* Skeleton loading */}
      {loading && items.length === 0 ? (
        <View style={{ paddingHorizontal: 12, paddingTop: 8 }}>
          {[1, 2, 3, 4, 5].map((i) => <SkeletonRow key={i} colors={colors} />)}
        </View>
      ) : (
        <SectionList
          sections={sections}
          initialNumToRender={10}
          maxToRenderPerBatch={10}
          windowSize={7}
          removeClippedSubviews
          stickySectionHeadersEnabled={false}
          keyExtractor={(item) => `${item.itemtype}-${item.id}`}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => load(true)}
              tintColor={colors.accent}
              colors={[colors.accent]}
            />
          }
          contentContainerStyle={{ paddingBottom: 28, paddingHorizontal: 12 }}
          ListEmptyComponent={
            <View style={styles.emptyBox}>
              <Text style={styles.emptyIcon}>🏥</Text>
              <Text style={styles.emptyText}>{error || 'No equipment found'}</Text>
              <Pressable style={[styles.retryBtn, { backgroundColor: colors.accent }]} onPress={() => load(true)}>
                <Text style={{ color: colors.white, fontWeight: '700' }}>{tr('Retry')}</Text>
              </Pressable>
            </View>
          }
          renderSectionHeader={({ section: { title } }) => (
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{title}</Text>
            </View>
          )}
          renderItem={({ item }) => {
            const down = isAssetDown(item.status_name, item.states_id);
            return (
              <Pressable
                style={styles.row}
                onPress={() =>
                  router.push({
                    pathname: '/equipment/[id]',
                    params: {
                      id: String(item.id),
                      itemtype: item.itemtype,
                      name: item.name,
                      serial: item.serial || '',
                      location: item.location_name || '',
                      entity: item.entity_name || '',
                      type: item.type_label,
                    },
                  })
                }
              >
                <View style={[styles.dot, { backgroundColor: down ? colors.danger : colors.success }]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
                  <Text style={styles.meta} numberOfLines={1}>
                    {item.type_label} · SN {item.serial || '—'}
                  </Text>
                  <Text style={[styles.meta, { color: down ? colors.danger : colors.textDim }]}>
                    {tr(item.status_name || (down ? 'Down' : 'Active'))}
                  </Text>
                </View>
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

function makeStyles(colors: any) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    chips: { flexGrow: 0, maxHeight: 52 },
    chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: colors.chip, marginRight: 8, minHeight: 36, justifyContent: 'center' },
    chipOn: { backgroundColor: colors.chipOn },
    chipText: { color: colors.textMuted, fontWeight: '600', fontSize: 12 },
    chipTextOn: { color: colors.chipOnText },
    header: {
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      paddingHorizontal: 16, paddingTop: 36, paddingBottom: 12, backgroundColor: colors.header, marginBottom: 12,
    },
    hTitle: { color: '#FFFFFF', fontSize: 20, fontWeight: '700' },
    hSub: { color: '#FFFFFFB3', fontSize: 12, marginTop: 2 },
    statusPill: {
      flexDirection: 'row', alignItems: 'center', gap: 5,
      paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20,
    },
    statusDot: { width: 7, height: 7, borderRadius: 4 },
    statusText: { fontSize: 12, fontWeight: '600' },
    searchBtn: {
      width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
      backgroundColor: colors.chip,
    },
    searchBtnIcon: { fontSize: 15 },
    searchBar: { paddingHorizontal: 16, marginBottom: 6 },
    searchInput: {
      backgroundColor: colors.bgCard, borderRadius: 10, borderWidth: 1, borderColor: colors.border,
      paddingHorizontal: 14, paddingVertical: 10, color: colors.text, fontSize: 14,
    },
    filterBar: {
      paddingHorizontal: 16,
      paddingBottom: 10,
      paddingTop: 2,
      alignItems: 'center',
    },
    selectBtn: {
      width: '100%',
      maxWidth: 420,
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.bgCard,
      borderRadius: 14,
      borderWidth: 1.5,
      borderColor: colors.border,
      paddingVertical: 12,
      paddingHorizontal: 14,
      shadowColor: '#0B3D4A',
      shadowOpacity: 0.06,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 2 },
      elevation: 2,
    },
    selectLeft: { flex: 1, minWidth: 0 },
    selectCaption: {
      color: colors.textDim,
      fontSize: 10,
      fontWeight: '800',
      letterSpacing: 0.8,
      marginBottom: 2,
    },
    selectValue: {
      color: colors.text,
      fontSize: 15,
      fontWeight: '700',
    },
    selectChevronWrap: {
      width: 28,
      height: 28,
      borderRadius: 8,
      backgroundColor: colors.chip,
      alignItems: 'center',
      justifyContent: 'center',
      marginLeft: 10,
    },
    selectChevron: { color: colors.textMuted, fontSize: 11, fontWeight: '700' },
    modalBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(13, 27, 42, 0.45)',
      justifyContent: 'center',
      alignItems: 'center',
      padding: 24,
    },
    modalCard: {
      width: '100%',
      maxWidth: 360,
      backgroundColor: colors.bgCard,
      borderRadius: 18,
      paddingTop: 18,
      paddingBottom: 12,
      paddingHorizontal: 14,
      borderWidth: 1,
      borderColor: colors.border,
      shadowColor: '#000',
      shadowOpacity: 0.18,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 8 },
      elevation: 8,
    },
    modalTitle: {
      textAlign: 'center',
      color: colors.text,
      fontSize: 17,
      fontWeight: '800',
    },
    modalSub: {
      textAlign: 'center',
      color: colors.textMuted,
      fontSize: 12,
      marginTop: 4,
      marginBottom: 12,
    },
    modalScroll: { maxHeight: 320 },
    modalRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 13,
      paddingHorizontal: 12,
      borderRadius: 12,
      marginBottom: 4,
    },
    modalRowOn: {
      backgroundColor: colors.accent + '18',
    },
    modalRowText: {
      color: colors.text,
      fontSize: 15,
      fontWeight: '600',
      flex: 1,
    },
    modalRowTextOn: {
      color: colors.accent,
      fontWeight: '800',
    },
    modalCheck: {
      color: colors.accent,
      fontSize: 16,
      fontWeight: '800',
      marginLeft: 8,
    },
    modalClose: {
      marginTop: 8,
      paddingVertical: 12,
      alignItems: 'center',
      borderRadius: 12,
      backgroundColor: colors.chip,
    },
    modalCloseText: {
      color: colors.text,
      fontWeight: '700',
      fontSize: 14,
    },
    sectionHeader: { paddingTop: 12, paddingBottom: 6 },
    sectionTitle: {
      color: colors.textDim, fontSize: 11, fontWeight: '700', letterSpacing: 0.8,
    },
    row: {
      flexDirection: 'row', backgroundColor: colors.bgCard, borderRadius: 16,
      paddingHorizontal: 14, paddingVertical: 12, marginBottom: 8, borderWidth: 1, borderColor: colors.border, gap: 10,
      elevation: 1, shadowColor: '#0B2A44', shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 2 },
    },
    rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
    dot: { width: 10, height: 10, borderRadius: 5, marginTop: 6 },
    name: { color: colors.text, fontWeight: '700', fontSize: 15, flex: 1, marginRight: 8 },
    typeBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, flexShrink: 0 },
    typeBadgeText: { fontSize: 10, fontWeight: '700' },
    meta: { color: colors.textMuted, fontSize: 12, marginTop: 3 },
    emptyBox: { alignItems: 'center', paddingTop: 60, gap: 12 },
    emptyIcon: { fontSize: 40 },
    emptyText: { color: colors.textMuted, textAlign: 'center', fontSize: 14 },
    retryBtn: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, marginTop: 4 },
  });
}
