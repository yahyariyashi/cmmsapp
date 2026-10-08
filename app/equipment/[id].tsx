import { tr } from '../../src/i18n';
import { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, router, Stack } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import { useAuth } from '../../src/context/AuthContext';
import { useTheme } from '../../src/context/ThemeContext';
import type { GlpiTicket } from '../../src/types/glpi';
import { STATUS_LABELS } from '../../src/api/glpiClient';
import { statusUi } from '../../src/theme';

export default function EquipmentDetailScreen() {
  const { colors } = useTheme();
  const { client } = useAuth();
  const params = useLocalSearchParams<{
    id: string;
    itemtype?: string;
    name?: string;
    serial?: string;
    location?: string;
    entity?: string;
    type?: string;
  }>();

  const assetId = Number(params.id || 0);
  const itemtype = String(params.itemtype || 'Asset');
  const [tickets, setTickets] = useState<GlpiTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!client || !assetId) return;
    setLoading(true);
    setError(null);
    try {
      const list = await client.getTicketsForAsset(itemtype, assetId);
      setTickets(list);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not load history');
    } finally {
      setLoading(false);
    }
  }, [client, assetId, itemtype]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const styles = makeStyles(colors);
  const open = tickets.filter((t) => t.status < 5);
  const closed = tickets.filter((t) => t.status >= 5);

  return (
    <View style={styles.root}>
      <Stack.Screen
        options={{
          title: params.name || 'Equipment',
          headerStyle: { backgroundColor: colors.bgCard },
          headerTintColor: colors.text,
        }}
      />
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={load}
            tintColor={colors.accent}
          />
        }
      >
        <View style={styles.card}>
          <Text style={styles.type}>{params.type || 'Asset'}</Text>
          <Text style={styles.name}>{params.name || `Asset #${assetId}`}</Text>
          <Text style={styles.meta}>SN: {params.serial || '—'}</Text>
          {params.location ? (
            <Text style={styles.meta}>Location: {params.location}</Text>
          ) : null}
          {params.entity ? (
            <Text style={styles.meta}>Entity: {params.entity}</Text>
          ) : null}
        </View>

        <Pressable
          style={[styles.newBtn, { backgroundColor: colors.accent }]}
          onPress={() =>
            router.push({
              pathname: '/ticket/new',
              params: {
                itemtype,
                items_id: String(assetId),
                asset_name: params.name || '',
              },
            })
          }
        >
          <Text style={styles.newBtnText}>{'+ '}{tr('New work order for this equipment')}</Text>
        </Pressable>

        <Text style={styles.section}>
          Ticket history ({tickets.length})
        </Text>

        {loading && tickets.length === 0 ? (
          <ActivityIndicator color={colors.accent} style={{ marginTop: 20 }} />
        ) : error ? (
          <Text style={[styles.empty, { color: colors.danger }]}>{error}</Text>
        ) : tickets.length === 0 ? (
          <Text style={styles.empty}>{tr('No tickets linked to this machine yet.')}</Text>
        ) : (
          <>
            {open.length > 0 && (
              <Text style={styles.subSection}>{tr('Open / active')}</Text>
            )}
            {open.map((t) => (
              <TicketRow key={t.id} t={t} colors={colors} styles={styles} />
            ))}
            {closed.length > 0 && (
              <Text style={styles.subSection}>{tr('Solved / closed')}</Text>
            )}
            {closed.map((t) => (
              <TicketRow key={t.id} t={t} colors={colors} styles={styles} />
            ))}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function TicketRow({
  t,
  colors,
  styles,
}: {
  t: GlpiTicket;
  colors: any;
  styles: any;
}) {
  const ui = statusUi[t.status] || statusUi[1];
  return (
    <Pressable
      style={styles.ticket}
      onPress={() => router.push(`/ticket/${t.id}`)}
    >
      <View style={[styles.priDot, { backgroundColor: t.priority >= 4 ? colors.danger : colors.accent }]} />
      <View style={{ flex: 1 }}>
        <Text style={styles.ticketTitle} numberOfLines={2}>
          #{t.id} · {t.name}
        </Text>
        <Text style={styles.ticketMeta}>
          {STATUS_LABELS[t.status] || ui.label || 'Status'} · Priority {t.priority}
          {t.date ? ` · ${t.date.slice(0, 10)}` : ''}
        </Text>
        {t.content ? (
          <Text style={styles.ticketBody} numberOfLines={3}>
            {String(t.content).replace(/<[^>]+>/g, ' ').trim()}
          </Text>
        ) : null}
      </View>
      <Text style={{ color: colors.accent }}>›</Text>
    </Pressable>
  );
}

function makeStyles(colors: any) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    card: {
      backgroundColor: colors.bgCard,
      borderRadius: 14,
      padding: 16,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: 12,
    },
    type: {
      color: colors.accent,
      fontSize: 12,
      fontWeight: '700',
      textTransform: 'uppercase',
      marginBottom: 4,
    },
    name: { color: colors.text, fontSize: 20, fontWeight: '800' },
    meta: { color: colors.textMuted, fontSize: 13, marginTop: 4 },
    newBtn: {
      padding: 14,
      borderRadius: 12,
      alignItems: 'center',
      marginBottom: 18,
    },
    newBtnText: { color: '#fff', fontWeight: '700' },
    section: {
      color: colors.text,
      fontWeight: '700',
      fontSize: 16,
      marginBottom: 8,
    },
    subSection: {
      color: colors.textDim,
      fontSize: 12,
      fontWeight: '700',
      marginTop: 8,
      marginBottom: 6,
    },
    empty: { color: colors.textMuted, textAlign: 'center', marginTop: 16 },
    ticket: {
      flexDirection: 'row',
      gap: 10,
      backgroundColor: colors.bgCard,
      borderRadius: 12,
      padding: 12,
      marginBottom: 8,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'flex-start',
    },
    priDot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
    ticketTitle: { color: colors.text, fontWeight: '700', fontSize: 14 },
    ticketMeta: { color: colors.textDim, fontSize: 11, marginTop: 2 },
    ticketBody: { color: colors.textMuted, fontSize: 12, marginTop: 4 },
  });
}
