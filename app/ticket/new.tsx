import { tr } from '../../src/i18n';
import { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Alert,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Modal,
  FlatList,
  Switch,
} from 'react-native';
import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useAuth } from '../../src/context/AuthContext';
import { useTheme } from '../../src/context/ThemeContext';
import type { GlpiAssetRow } from '../../src/api/glpiClient';
import { isAssetDown } from '../../src/api/glpiClient';
import { cache } from '../../src/cache';
import { pickFromCamera, pickFromGallery, pickFromFiles, uploadAll } from '../../src/attachPicker';
import type { PickedFile } from '../../src/attachPicker';

const ASSETS_CACHE = 'assets_list';

export default function NewTicketScreen() {
  const { client } = useAuth();
  const { colors } = useTheme();
  const params = useLocalSearchParams<{
    itemtype?: string;
    items_id?: string;
    asset_name?: string;
  }>();
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [priority, setPriority] = useState('3');
  const [busy, setBusy] = useState(false);
  const [assets, setAssets] = useState<GlpiAssetRow[]>(
    () => cache.get<GlpiAssetRow[]>(ASSETS_CACHE) || []
  );
  const [selected, setSelected] = useState<GlpiAssetRow | null>(() => {
    if (params.items_id && params.itemtype) {
      return {
        id: Number(params.items_id),
        name: params.asset_name || `Asset #${params.items_id}`,
        itemtype: params.itemtype,
        type_label: 'Equipment',
      };
    }
    return null;
  });
  const [pickerOpen, setPickerOpen] = useState(false);
  const [loadingAssets, setLoadingAssets] = useState(false);
  const [query, setQuery] = useState('');
  const [woType, setWoType] = useState<1 | 2>(1); // 1 = Incident (corrective), 2 = Request (planned)
  const [categories, setCategories] = useState<{ id: number; name: string }[]>([]);
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [assetOpStatus, setAssetOpStatus] = useState<'active' | 'down'>('active');


  useEffect(() => {
    if (!client) return;
    let off = false;
    client.listTicketCategories().then((c) => { if (!off) setCategories(c); }).catch(() => undefined);
    return () => { off = true; };
  }, [client]);

  // Category is hidden: pick the matching one automatically from the work order type
  useEffect(() => {
    if (!categories.length) return;
    const re = woType === 1 ? /correct|breakdown|repair/i : /prevent|planned|calib|inspect|schedul/i;
    setCategoryId(categories.find((c) => re.test(c.name))?.id ?? null);
  }, [categories, woType]);

  // Warm up the equipment entity so "Create" does not wait for an extra round trip
  useEffect(() => {
    if (client && selected) void client.getAssetEntity(selected.itemtype, selected.id);
  }, [client, selected]);

  useEffect(() => {
    if (!selected) return;
    setAssetOpStatus(isAssetDown(selected.status_name, selected.states_id) ? 'down' : 'active');
  }, [selected]);

  const loadAssets = useCallback(async () => {
    if (!client) return;
    const cached = cache.get<GlpiAssetRow[]>(ASSETS_CACHE);
    if (cached?.length) {
      setAssets(cached);
      setLoadingAssets(false);
    } else {
      setLoadingAssets(true);
    }
    try {
      const list = await client.listDefinedAssets('0-200');
      setAssets(list);
      cache.set(ASSETS_CACHE, list);
    } catch {
      if (!cached?.length) setAssets([]);
    } finally {
      setLoadingAssets(false);
    }
  }, [client]);

  useFocusEffect(
    useCallback(() => {
      void loadAssets();
    }, [loadAssets])
  );

  const submit = async () => {
    if (!client) return;
    if (!title.trim()) {
      Alert.alert(tr('Required'), tr('Enter a title'));
      return;
    }
    setBusy(true);
    try {
      const id = await client.createTicket({
        name: title.trim(),
        content: content.trim() || title.trim(),
        priority: Number(priority) || 3,
        type: woType,
        categoryId: categoryId || undefined,
        item: selected
          ? { itemtype: selected.itemtype, items_id: selected.id }
          : undefined,
      });
      if (!id) {
        Alert.alert(tr('Error'), tr('Work order was not created'));
        return;
      }
      // Equipment status + attachments run at the same time (faster than one after the other)
      const statusJob = async () => {
        if (!selected || typeof client.setAssetOperationalStatus !== 'function') return;
        try {
          await client.setAssetOperationalStatus(selected.itemtype, selected.id, assetOpStatus, id);
          cache.invalidate('equipment_list');
          cache.invalidate('assets_list');
        } catch (e) {
          console.warn('asset status update', e); // work order exists; status update may need rights
        }
      };
      const uploadJob = async () => {
        if (!files.length) return { ok: 0, errors: [] as string[] };
        return uploadAll((f) => client.uploadTicketDocument(id, f), files, (d, t) => setProgress(`${d}/${t}`));
      };
      if (files.length) setProgress(`0/${files.length}`);
      const [, up] = await Promise.all([statusJob(), uploadJob()]);
      setProgress(null);
      cache.invalidate('home_tickets');
      const failNote = up.errors.length ? `\n\n${tr('Upload failed')}:\n${up.errors.join('\n')}` : '';
      Alert.alert(
        tr('Created'),
        (selected ? `${tr('Work order')} #${id} · ${selected.name}` : `${tr('Work order')} #${id}`) + failNote,
        [
          {
            text: tr('Open'),
            onPress: () =>
              router.replace({ pathname: '/ticket/[id]', params: { id: String(id) } }),
          },
        ]
      );
    } catch (e: unknown) {
      Alert.alert(tr('Error'), e instanceof Error ? e.message : tr('Create failed'));
    } finally {
      setBusy(false);
    }
  };

  const q = query.trim().toLowerCase();
  const filtered = q
    ? assets.filter((a) =>
        [a.name, a.serial, a.location_name, a.entity_name, a.type_label]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q))
      )
    : assets;

  const styles = makeStyles(colors);

  return (
    <>
      <Stack.Screen
        options={{
          title: tr('New work order'),
          headerShown: true,
          headerStyle: { backgroundColor: colors.header },
          headerTintColor: '#FFFFFF', // header is always dark; colors.text was dark on dark
        }}
      />
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: colors.bg }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.pad} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>{tr('Work order title')}</Text>
          <TextInput
            style={styles.input}
            value={title}
            onChangeText={setTitle}
            placeholder={tr('Short description of the problem')}
            placeholderTextColor={colors.textDim}
          />

          <Text style={styles.label}>{tr('Equipment')}</Text>
          <Pressable style={styles.pickerBtn} onPress={() => setPickerOpen(true)}>
            <Text style={selected ? styles.pickerValue : styles.pickerPlaceholder}>
              {selected
                ? `${selected.type_label}: ${selected.name}${
                    selected.serial ? ` (SN ${selected.serial})` : ''
                  }`
                : loadingAssets
                  ? 'Loading assets…'
                  : assets.length
                    ? 'Tap to select equipment'
                    : 'No assets loaded — tap to retry'}
            </Text>
          </Pressable>
          {selected ? (
            <Pressable onPress={() => setSelected(null)}>
              <Text style={styles.clear}>{tr('Clear selection')}</Text>
            </Pressable>
          ) : null}

          <Text style={styles.label}>{tr('Work order type')}</Text>
          <View style={styles.chipRowSide}>
            {([[1, 'Corrective (breakdown)'], [2, 'Preventive / planned']] as [1 | 2, string][]).map(([v, l]) => (
              <Pressable key={v} onPress={() => setWoType(v)} style={[styles.chipSel, styles.chipSide, woType === v && styles.chipSelOn]}>
                <Text numberOfLines={2} style={[styles.chipSelText, { textAlign: 'center' }, woType === v && styles.chipSelTextOn]}>{tr(l)}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.label}>{tr('Problem description')}</Text>
          <TextInput
            style={[styles.input, styles.area]}
            value={content}
            onChangeText={setContent}
            placeholder={tr('Describe the fault, error code or request')}
            placeholderTextColor={colors.textDim}
            multiline
          />

          <Text style={styles.label}>{tr('Priority')}</Text>
          <View style={styles.chipRow}>
            {([['1', 'Very low'], ['2', 'Low'], ['3', 'Medium'], ['4', 'High'], ['5', 'Very high']] as [string, string][]).map(([v, l]) => (
              <Pressable key={v} onPress={() => setPriority(v)} style={[styles.chipSel, priority === v && styles.chipSelOn]}>
                <Text style={[styles.chipSelText, priority === v && styles.chipSelTextOn]}>{tr(l)}</Text>
              </Pressable>
            ))}
          </View>

          
      {selected ? (
        <View style={{ marginBottom: 16 }}>
          <Text style={styles.label}>{tr('Equipment status')}</Text>
          <Text style={[styles.hint, { marginBottom: 8 }]}>
            {tr('Updates the equipment status on the CMMS when the work order is created')}
          </Text>
          <View style={styles.toggleRow}>
            <Text style={[styles.toggleLabel, { color: '#C0392B' }]}>{tr('Out of service')}</Text>
            <Switch
              value={assetOpStatus === 'active'}
              onValueChange={(on) => setAssetOpStatus(on ? 'active' : 'down')}
              trackColor={{ false: '#E74C3C', true: '#27AE60' }}
              thumbColor="#FFFFFF"
              ios_backgroundColor="#E74C3C"
            />
            <Text style={[styles.toggleLabel, { color: '#1A8D4A' }]}>{tr('In service')}</Text>
          </View>
        </View>
      ) : null}

          <Text style={styles.label}>{tr('Attachments')}</Text>
          {files.map((f, i) => (
            <View key={`${f.uri}-${i}`} style={styles.fileRow}>
              <Text style={styles.fileName} numberOfLines={1}>📎 {f.name}</Text>
              <Pressable onPress={() => setFiles((a) => a.filter((_, j) => j !== i))} hitSlop={10}>
                <Text style={styles.fileX}>✕</Text>
              </Pressable>
            </View>
          ))}
          <Pressable style={styles.attachBtn} onPress={() => setSheetOpen(true)} disabled={busy}>
            <Text style={styles.attachBtnText}>{tr('Add photo or file')}</Text>
          </Pressable>

          <Modal visible={sheetOpen} transparent animationType="fade" onRequestClose={() => setSheetOpen(false)}>
            <Pressable style={styles.sheetBackdrop} onPress={() => setSheetOpen(false)}>
              <Pressable style={styles.sheetCard} onPress={(e) => e.stopPropagation?.()}>
                <Text style={styles.sheetTitle}>{tr('Add attachment')}</Text>
                {([
                  ['📷  ' + tr('Take photo'), pickFromCamera],
                  ['🖼  ' + tr('Photo / screenshot'), pickFromGallery],
                  ['📄  ' + tr('File'), pickFromFiles],
                ] as [string, () => Promise<PickedFile[]>][]).map(([label, fn]) => (
                  <Pressable
                    key={label}
                    style={styles.sheetRow}
                    onPress={async () => {
                      setSheetOpen(false);
                      try {
                        const picked = await fn();
                        if (picked.length) setFiles((a) => [...a, ...picked].slice(0, 10));
                      } catch (e) {
                        Alert.alert(tr('Permission'), e instanceof Error ? e.message : tr('Error'));
                      }
                    }}
                  >
                    <Text style={styles.sheetRowText}>{label}</Text>
                  </Pressable>
                ))}
                <Pressable style={styles.sheetCancel} onPress={() => setSheetOpen(false)}>
                  <Text style={styles.sheetCancelText}>{tr('Cancel')}</Text>
                </Pressable>
              </Pressable>
            </Pressable>
          </Modal>

          <Pressable style={styles.btn} onPress={submit} disabled={busy}>
            {busy ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <ActivityIndicator color={colors.chipOnText} />
                {progress ? <Text style={styles.btnText}>{tr('Uploading')} {progress}</Text> : null}
              </View>
            ) : (
              <Text style={styles.btnText}>{tr('Create work order')}</Text>
            )}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>

      <Modal visible={pickerOpen} animationType="slide">
        <View style={[styles.modal, { backgroundColor: colors.bg }]}>
          <Text style={styles.modalTitle}>{tr('Select asset')}</Text>
          <TextInput
            style={styles.search}
            placeholder={tr('Search SN, location, name…')}
            placeholderTextColor={colors.textDim}
            value={query}
            onChangeText={setQuery}
            autoCapitalize="none"
          />
          {loadingAssets && !assets.length ? (
            <ActivityIndicator color={colors.accent} style={{ marginTop: 24 }} />
          ) : null}
          <FlatList
            data={filtered}
            keyExtractor={(a) => `${a.itemtype}-${a.id}`}
            ListEmptyComponent={
              <Text style={styles.empty}>
                {loadingAssets ? 'Loading…' : 'No assets loaded'}
              </Text>
            }
            renderItem={({ item }) => (
              <Pressable
                style={styles.assetRow}
                onPress={() => {
                  setSelected(item);
                  setPickerOpen(false);
                  setQuery('');
                }}
              >
                <Text style={styles.assetType}>{item.type_label}</Text>
                <Text style={styles.assetName}>{item.name}</Text>
                <Text style={styles.assetMeta}>
                  SN {item.serial || '—'}
                  {item.location_name ? ` · ${item.location_name}` : ''}
                  {item.entity_name ? ` · ${item.entity_name}` : ''}
                </Text>
              </Pressable>
            )}
          />
          <Pressable
            style={styles.cancelBtn}
            onPress={() => {
              setPickerOpen(false);
              void loadAssets();
            }}
          >
            <Text style={styles.cancelText}>
              {assets.length ? 'Cancel' : 'Retry / Cancel'}
            </Text>
          </Pressable>
        </View>
      </Modal>
    </>
  );
}

function makeStyles(colors: ReturnType<typeof useTheme>['colors']) {
  return StyleSheet.create({
    pad: { padding: 16 },
    label: { fontWeight: '700', color: colors.accent, marginBottom: 6, marginTop: 8 },
    input: {
      backgroundColor: colors.bgCard,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 10,
      padding: 12,
      color: colors.text,
      marginBottom: 8,
    },
    area: { minHeight: 100, textAlignVertical: 'top' },
    pickerBtn: {
      backgroundColor: colors.bgCard,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 10,
      padding: 14,
      marginBottom: 4,
    },
    pickerValue: { color: colors.text, fontWeight: '600' },
    pickerPlaceholder: { color: colors.textDim },
    clear: { color: colors.danger, fontSize: 13, marginBottom: 8, marginTop: 4 },
    toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    paddingVertical: 8,
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#C5D9E8',
  },
  fileRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.bgCard, borderRadius: 12, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: 12, paddingVertical: 10, marginBottom: 8,
  },
  fileName: { color: colors.text, flex: 1, fontSize: 13 },
  fileX: { color: colors.danger, fontSize: 18, fontWeight: '800', paddingLeft: 12 },
  attachBtn: {
    borderWidth: 1.5, borderColor: colors.accent, borderRadius: 12, alignItems: 'center',
    paddingVertical: 13, marginBottom: 18, backgroundColor: colors.bgCardAlt,
  },
  attachBtnText: { color: colors.accent, fontWeight: '800', fontSize: 15 },
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 24 },
  sheetCard: { backgroundColor: colors.bgCard, borderRadius: 16, padding: 16 },
  sheetTitle: { color: colors.text, fontSize: 17, fontWeight: '800', marginBottom: 8, textAlign: 'center' },
  sheetRow: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border },
  sheetRowText: { color: colors.text, fontSize: 16, fontWeight: '600' },
  sheetCancel: { alignItems: 'center', paddingVertical: 14, marginTop: 4 },
  sheetCancelText: { color: colors.textMuted, fontWeight: '700', fontSize: 15 },
  chipRowSide: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  chipSide: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 48 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
    chipSel: {
      paddingHorizontal: 14, paddingVertical: 9, borderRadius: 18, borderWidth: 1,
      borderColor: colors.border, backgroundColor: colors.chip,
    },
    chipSelOn: { backgroundColor: colors.chipOn, borderColor: colors.chipOn },
    chipSelText: { color: colors.text, fontWeight: '700', fontSize: 13 },
    chipSelTextOn: { color: colors.chipOnText },
  toggleLabel: { fontSize: 14, fontWeight: '800', minWidth: 52, textAlign: 'center' },
  statusChoice: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#C5D9E8',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  statusChoiceOnActive: { backgroundColor: '#1A8D4A', borderColor: '#1A8D4A' },
  statusChoiceOnDown: { backgroundColor: '#C0392B', borderColor: '#C0392B' },
  statusChoiceText: { fontWeight: '700', fontSize: 14, color: '#0D1B2A' },
  hint: { fontSize: 12, color: '#8AA8BF' },
  btn: {
      marginTop: 16,
      backgroundColor: colors.accent,
      padding: 16,
      borderRadius: 10,
      alignItems: 'center',
    },
    btnText: { color: colors.chipOnText, fontWeight: '700', fontSize: 16 },
    modal: { flex: 1, paddingTop: 48 },
    modalTitle: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.accent,
      paddingHorizontal: 16,
      marginBottom: 8,
    },
    search: {
      marginHorizontal: 12,
      marginBottom: 8,
      backgroundColor: colors.bgCard,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 12,
      color: colors.text,
    },
    assetRow: {
      backgroundColor: colors.bgCard,
      marginHorizontal: 12,
      marginTop: 8,
      padding: 12,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.border,
    },
    assetType: { fontSize: 11, color: colors.primary, fontWeight: '700' },
    assetName: { fontWeight: '700', color: colors.text, marginTop: 2 },
    assetMeta: { color: colors.textMuted, fontSize: 12, marginTop: 4 },
    empty: { textAlign: 'center', color: colors.textMuted, marginTop: 40 },
    cancelBtn: { padding: 16, alignItems: 'center', marginBottom: 24 },
    cancelText: { color: colors.accent, fontWeight: '700' },
  });
}
