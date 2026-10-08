import { tr } from '../../src/i18n';
import { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  ActivityIndicator,
  Alert,
  ScrollView,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useAuth } from '../../src/context/AuthContext';
import { useTheme } from '../../src/context/ThemeContext';

type LookupResult = {
  ok: boolean;
  type?: 'consumable' | 'tool';
  id?: number;
  name?: string;
  code?: string;
  serial?: string;
  status?: string;
  stock?: { warehouse_id: number; name: string; qty: number }[];
  error?: string;
};

export default function ScanStockScreen() {
  const { colors } = useTheme();
  const { client } = useAuth();
  const router = useRouter();
  const { ticketId } = useLocalSearchParams<{ ticketId: string }>();
  const tid = Number(ticketId || 0);

  const [permission, requestPermission] = useCameraPermissions();
  const [scanning, setScanning] = useState(true);
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState('');
  const [result, setResult] = useState<LookupResult | null>(null);
  const [warehouseId, setWarehouseId] = useState<number | null>(null);
  const [qty, setQty] = useState(1);
  const [lastCode, setLastCode] = useState('');

  const runLookup = useCallback(
    async (code: string) => {
      if (!client || !code.trim()) return;
      setBusy(true);
      setScanning(false);
      try {
        const res = await client.lookupStockCode(code.trim(), tid || undefined);
        setResult(res);
        setLastCode(code.trim());
        if (res.ok && res.type === 'consumable' && res.stock?.length) {
          const first = res.stock.find((s) => s.qty > 0) || res.stock[0];
          setWarehouseId(first.warehouse_id);
          setQty(1);
        }
        if (!res.ok) {
          Alert.alert(tr('Not found'), res.error === 'not_found' ? `No item for code “${code}”` : String(res.error));
          setScanning(true);
        }
      } catch (e: unknown) {
        Alert.alert(tr('Lookup failed'), e instanceof Error ? e.message : 'Network error');
        setScanning(true);
      } finally {
        setBusy(false);
      }
    },
    [client, tid]
  );

  const onBarcode = useCallback(
    ({ data }: { data: string }) => {
      if (!scanning || busy || !data) return;
      if (data === lastCode) return;
      void runLookup(data);
    },
    [scanning, busy, lastCode, runLookup]
  );

  const confirm = async () => {
    if (!client || !result?.ok || !result.id || !tid) return;
    setBusy(true);
    try {
      if (result.type === 'tool') {
        if (String(result.status || '').toLowerCase() === 'in_use') {
          await client.returnTool({ ticketId: tid, toolId: result.id, toolName: result.name });
          Alert.alert(tr('Done'), `${result.name} — ${tr('Return')}`);
        } else {
          await client.checkoutTool({ ticketId: tid, toolId: result.id, toolName: result.name });
          Alert.alert(tr('Done'), `${result.name} — ${tr('Check out')}`);
        }
      } else {
        if (!warehouseId) {
          Alert.alert('Warehouse', tr('Select a warehouse'));
          setBusy(false);
          return;
        }
        const wh = result.stock?.find((s) => s.warehouse_id === warehouseId);
        if (wh && qty > wh.qty) {
          Alert.alert(tr('Stock'), `Only ${wh.qty} available in ${wh.name}`);
          setBusy(false);
          return;
        }
        await client.deductSparePart({
          ticketId: tid,
          consumableItemId: result.id,
          quantity: qty,
          warehouseId,
          partName: result.name,
        });
        Alert.alert(tr('Done'), `${result.name} × ${qty}`);
      }
      router.back();
    } catch (e: unknown) {
      Alert.alert(tr('Failed'), e instanceof Error ? e.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  };

  const styles = makeStyles(colors);

  if (!permission) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: 'Scan QR' }} />
        <Text style={styles.msg}>{tr('Camera access is needed to scan part and tool codes.')}</Text>
        <Pressable style={styles.btn} onPress={requestPermission}>
          <Text style={styles.btnText}>{tr('Allow camera')}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ title: 'Scan QR', headerShown: true }} />
      {scanning && !result?.ok ? (
        <View style={styles.cameraWrap}>
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr', 'code128', 'code39', 'ean13'] }}
            onBarcodeScanned={onBarcode}
          />
          <View style={styles.overlay}>
            <View style={styles.frame} />
            <Text style={styles.hint}>{tr('Point at the shelf / tool QR')}</Text>
          </View>
        </View>
      ) : null}

      <ScrollView contentContainerStyle={styles.panel} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>{tr('Or type code')}</Text>
        <View style={styles.row}>
          <TextInput
            style={styles.input}
            placeholder={tr('e.g. BBPP or CI:4 or TOOL:3')}
            placeholderTextColor={colors.textDim}
            value={manual}
            onChangeText={setManual}
            autoCapitalize="characters"
            autoCorrect={false}
          />
          <Pressable
            style={styles.btn}
            onPress={() => void runLookup(manual)}
            disabled={busy || !manual.trim()}
          >
            <Text style={styles.btnText}>Go</Text>
          </Pressable>
        </View>

        {busy ? <ActivityIndicator color={colors.accent} style={{ marginVertical: 12 }} /> : null}

        {result?.ok ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{result.name}</Text>
            <Text style={styles.muted}>
              {result.type === 'tool' ? 'Tool' : 'Spare part'} · {result.code}
              {result.serial ? ` · SN ${result.serial}` : ''}
            </Text>

            {result.type === 'consumable' && result.stock ? (
              <>
                <Text style={[styles.label, { marginTop: 12 }]}>{tr('Warehouse')}</Text>
                {result.stock.map((w) => (
                  <Pressable
                    key={w.warehouse_id}
                    style={[
                      styles.whRow,
                      warehouseId === w.warehouse_id && styles.whOn,
                    ]}
                    onPress={() => setWarehouseId(w.warehouse_id)}
                  >
                    <Text style={styles.whName}>{w.name}</Text>
                    <Text style={{ fontWeight: '800', color: w.qty > 0 ? colors.success : colors.danger }}>
                      {w.qty}
                    </Text>
                  </Pressable>
                ))}
                <Text style={[styles.label, { marginTop: 12 }]}>{tr('Quantity')}</Text>
                <View style={styles.row}>
                  <Pressable style={styles.qtyBtn} onPress={() => setQty((q) => Math.max(1, q - 1))}>
                    <Text style={styles.qtyTxt}>−</Text>
                  </Pressable>
                  <Text style={styles.qtyVal}>{qty}</Text>
                  <Pressable style={styles.qtyBtn} onPress={() => setQty((q) => q + 1)}>
                    <Text style={styles.qtyTxt}>+</Text>
                  </Pressable>
                </View>
              </>
            ) : null}

            <Pressable style={[styles.btn, styles.confirm]} onPress={confirm} disabled={busy}>
              <Text style={styles.btnText}>
                {result.type === 'tool' ? 'Check out tool' : 'Confirm deduct'}
              </Text>
            </Pressable>
            <Pressable
              style={[styles.btn, styles.secondary]}
              onPress={() => {
                setResult(null);
                setLastCode('');
                setScanning(true);
              }}
            >
              <Text style={[styles.btnText, { color: colors.text }]}>{tr('Scan again')}</Text>
            </Pressable>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

function makeStyles(colors: any) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, backgroundColor: colors.bg },
    msg: { color: colors.text, textAlign: 'center', marginBottom: 16 },
    cameraWrap: { height: 280, margin: 12, borderRadius: 16, overflow: 'hidden', backgroundColor: '#000' },
    overlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center' },
    frame: {
      width: 200,
      height: 200,
      borderWidth: 2,
      borderColor: '#2ECC71',
      borderRadius: 16,
      backgroundColor: 'transparent',
    },
    hint: {
      marginTop: 12,
      color: '#fff',
      fontWeight: '700',
      backgroundColor: 'rgba(0,0,0,0.45)',
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 8,
    },
    panel: { padding: 16, paddingBottom: 40 },
    label: { color: colors.textMuted, fontSize: 12, fontWeight: '700', marginBottom: 6 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    input: {
      flex: 1,
      backgroundColor: colors.bgCard,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 12,
      paddingVertical: 10,
      color: colors.text,
    },
    btn: {
      backgroundColor: colors.accent,
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderRadius: 12,
      alignItems: 'center',
    },
    btnText: { color: '#fff', fontWeight: '800' },
    confirm: { marginTop: 16 },
    secondary: { marginTop: 8, backgroundColor: colors.chip },
    card: {
      marginTop: 16,
      backgroundColor: colors.bgCard,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 14,
    },
    cardTitle: { color: colors.text, fontSize: 17, fontWeight: '800' },
    muted: { color: colors.textMuted, fontSize: 12, marginTop: 4 },
    whRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingVertical: 12,
      paddingHorizontal: 10,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: 6,
    },
    whOn: { borderColor: colors.accent, backgroundColor: colors.accent + '18' },
    whName: { color: colors.text, fontWeight: '600', flex: 1 },
    qtyBtn: {
      width: 40,
      height: 40,
      borderRadius: 10,
      backgroundColor: colors.chip,
      alignItems: 'center',
      justifyContent: 'center',
    },
    qtyTxt: { fontSize: 20, fontWeight: '700', color: colors.text },
    qtyVal: { minWidth: 36, textAlign: 'center', fontSize: 18, fontWeight: '800', color: colors.text },
  });
}
