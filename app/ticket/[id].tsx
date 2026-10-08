import { tr, trf } from '../../src/i18n';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ProcessTimeline } from '../../src/components/ProcessTimeline';
import { statusUi } from '../../src/theme';
import { priorityLabel, priorityColor, shortDate } from '../../src/uiHelpers';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  Pressable,
  ActivityIndicator,
  Alert,
  Linking,
  Share,
  Switch,
  Modal,
} from 'react-native';
import { useLocalSearchParams, Stack, useFocusEffect, useRouter } from 'expo-router';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { useAuth } from '../../src/context/AuthContext';
import { useTheme } from '../../src/context/ThemeContext';
import type { GlpiTicketDetails, TaskTemplate, SolutionTemplate, StockPart, StockTool } from '../../src/api/glpiClient';
import { STATUS_LABELS } from '../../src/api/glpiClient';
import { cache } from '../../src/cache';
import { enqueueFollowup, flushQueue } from '../../src/offlineQueue';
import { getPrefs, QUALITY_VALUE } from '../../src/preferences';

const STATUS_ACTIONS: { status: number; label: string; color: string }[] = [
  { status: 1, label: 'New', color: '#0284c7' },
  { status: 2, label: 'Assigned', color: '#d97706' },
  { status: 3, label: 'Planned', color: '#ea580c' },
  { status: 4, label: 'Pending', color: '#7c3aed' },
  { status: 5, label: 'Solved', color: '#059669' },
  { status: 6, label: 'Closed', color: '#64748b' },
];

export default function TicketDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { client, userId } = useAuth();
  const router = useRouter();
  const { colors } = useTheme();
  const [ticket, setTicket] = useState<GlpiTicketDetails | null>(null);
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [rating, setRating] = useState(0);
  /** true = Active, false = Down for linked asset switches */
  const [assetModeMap, setAssetModeMap] = useState<Record<string, boolean>>({});
  const [spareParts, setSpareParts] = useState<StockPart[]>([]);
  const [tools, setTools] = useState<StockTool[]>([]);
  const [stockLoading, setStockLoading] = useState(false);
  const [stockError, setStockError] = useState<string | null>(null);
  const [stockFlash, setStockFlash] = useState<'ok' | 'err' | null>(null);
  const [toolFlash, setToolFlash] = useState<'out' | 'in' | 'err' | null>(null);
  const [selectedPart, setSelectedPart] = useState<StockPart | null>(null);
  const [selectedWh, setSelectedWh] = useState<number | null>(null);
  const [uploading, setUploading] = useState<string | null>(null); // e.g. "2/3" while files upload
  const [selectedTool, setSelectedTool] = useState<StockTool | null>(null);
  const [partQty, setPartQty] = useState(1);
  const [partPickerOpen, setPartPickerOpen] = useState(false);
  const [toolPickerOpen, setToolPickerOpen] = useState(false);
  const [partQuery, setPartQuery] = useState('');
  const [toolQuery, setToolQuery] = useState('');
  const [ticketStockHistory, setTicketStockHistory] = useState<{
    parts: { id?: number; name: string; quantity: number; date?: string; user?: string }[];
    tools: { id?: number; name: string; direction?: string; date?: string; user?: string }[];
  }>({ parts: [], tools: [] });

  const [satComment, setSatComment] = useState('');
  const [taskTemplates, setTaskTemplates] = useState<TaskTemplate[]>([]);
  const [solutionTemplates, setSolutionTemplates] = useState<SolutionTemplate[]>([]);
  const [taskTpl, setTaskTpl] = useState<TaskTemplate | null>(null);
  const [solutionTpl, setSolutionTpl] = useState<SolutionTemplate | null>(null);
  const [isStaff, setIsStaff] = useState(false); // technician tools stay hidden until we know the profile
  const [taskText, setTaskText] = useState('');
  const [solutionText, setSolutionText] = useState('');
  const [tplBusy, setTplBusy] = useState(false);

  useEffect(() => {
    if (!client) return;
    void (async () => {
      try {
        const caps = await client.getCapabilities();
        setIsStaff(caps.isStaff);
        if (!caps.isStaff) return; // requesters never call template / stock endpoints
        const [tt, st] = await Promise.all([client.listTaskTemplates(), client.listSolutionTemplates()]);
        setTaskTemplates(tt);
        setSolutionTemplates(st);
      } catch {
        /* optional */
      }
    })();
  }, [client]);

  const loadStock = useCallback(async (ticketId?: number, linked?: { itemtype: string; items_id: number }[]) => {
    if (!client) return;
    setStockLoading(true);
    setStockError(null);
    client.lastStockError = null;
    try {
      const first = linked && linked.length ? linked[0] : undefined;
      const partsP = client
        .listConsumableStock({ ticketId, itemtype: first?.itemtype, itemsId: first?.items_id })
        .catch((e: unknown) => {
          console.warn('listConsumableStock', e);
          return [] as StockPart[];
        });
      const toolsP = client.listAvailableTools(ticketId).catch((e: unknown) => {
        console.warn('listAvailableTools', e);
        return [] as StockTool[];
      });
      const histP = ticketId
        ? client.getTicketStockHistory(ticketId).catch(() => ({ parts: [], tools: [] }))
        : Promise.resolve({ parts: [], tools: [] });
      const [parts, tls, hist] = await Promise.all([partsP, toolsP, histP]);
      setSpareParts(parts);
      setTools(tls);
      setTicketStockHistory(hist);
      // Say WHY when something is wrong (plugin unreachable / session refused / only server catalogue)
      if (client.lastStockError) {
        setStockError(client.lastStockError);
      } else if (client.lastStockSource === 'server' && parts.length) {
        setStockError(tr('Stock plugin not available — showing the plain server catalogue (stock counts may differ).'));
      }
    } finally {
      setStockLoading(false);
    }
  }, [client]);

  const load = useCallback(async () => {
    if (!client || !id) return;
    setLoading(true);
    try {
      if (typeof client.getTicket !== 'function') {
        throw new Error('Ticket API unavailable — reinstall the latest app build');
      }
      // Show the last known copy immediately while the fresh one loads
      await cache.hydrate();
      const stale = cache.getStale<GlpiTicketDetails>(`ticket:${id}`);
      if (stale) setTicket((prev) => prev ?? stale);
      const data = await client.getTicket(Number(id));
      cache.set(`ticket:${id}`, data);
      void flushQueue(client, userId);
      const linked = (data.linked_assets || [])
        .filter((a: { items_id?: number; itemtype?: string }) => a.items_id && a.itemtype)
        .map((a: { items_id: number; itemtype: string }) => ({
          itemtype: a.itemtype,
          items_id: a.items_id,
        }));
      void client.getCapabilities().then((c) => {
        if (c.isStaff) void loadStock(Number(id), linked);
      });
      setTicket({
        ...data,
        solutions: data.solutions || [],
        solutionRows: data.solutionRows || [],
        followups: data.followups || [],
        documents: data.documents || [],
        tasks: data.tasks || [],
        linked_assets: data.linked_assets || [],
        assigned_names: data.assigned_names || [],
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Load failed';
      Alert.alert(tr('Error'), msg);
    } finally {
      setLoading(false);
    }
  }, [client, id, userId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const sendFollowup = async () => {
    if (!client || !ticket || !note.trim()) return;
    setSending(true);
    try {
      await client.addTicketFollowup(ticket.id, note.trim());
      setNote('');
      Alert.alert(tr('Saved'), tr('Note posted.'));
      await load();
    } catch (e: unknown) {
      if ((e as { isNetworkError?: boolean })?.isNetworkError) {
        await enqueueFollowup({ ticketId: ticket.id, content: note.trim(), userId });
        setNote('');
        Alert.alert(
          'Saved offline',
          'No connection. Your note is saved on this phone and will be sent automatically when you are online.'
        );
      } else {
        Alert.alert(tr('Could not post note'), e instanceof Error ? e.message : 'Unknown error');
      }
    } finally {
      setSending(false);
    }
  };

  const changeStatus = async (status: number) => {
    if (!client || !ticket || status === ticket.status) return;
    const label = STATUS_LABELS[status] || String(status);
    Alert.alert('Update status', `Set ticket to “${label}”?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Update',
        onPress: async () => {
          setStatusBusy(true);
          try {
            await client.updateTicketStatus(ticket.id, status);
            await load();
            Alert.alert(tr('Updated'), `Status is now ${label}`);
          } catch (e: unknown) {
            Alert.alert(
              'Error',
              e instanceof Error ? e.message : 'Could not update status (check rights)'
            );
          } finally {
            setStatusBusy(false);
          }
        },
      },
    ]);
  };



  const chosenWarehouse = (part: StockPart | null, whId: number | null) =>
    part?.warehouses?.find((w) => w.id === whId) || null;

  const pickPart = (p: StockPart) => {
    setSelectedPart(p);
    setSelectedWh(p.warehouses && p.warehouses.length ? [...p.warehouses].sort((a, b) => b.qty - a.qty)[0].id : null);
    setPartQty(1);
    setSelectedTool(null);
  };

  const confirmSparePart = async () => {
    if (!client || !ticket || !selectedPart) return;
    const wh = chosenWarehouse(selectedPart, selectedWh);
    const available = wh ? wh.qty : selectedPart.stock;
    if (available < partQty) {
      Alert.alert(tr('Stock'), trf('Only {n} in stock for {name}', { n: available, name: selectedPart.name }));
      return;
    }
    setActionBusy(true);
    setStockFlash(null);
    try {
      await client.deductSparePart({
        ticketId: ticket.id,
        consumableItemId: selectedPart.id,
        quantity: partQty,
        warehouseId: wh?.id,
        partName: selectedPart.name,
      });
      setStockFlash('ok');
      setSelectedPart(null);
      setSelectedWh(null);
      setPartQty(1);
      await loadStock(ticket.id);
      await load();
    } catch (e: unknown) {
      setStockFlash('err');
      Alert.alert(tr('Stock'), e instanceof Error ? e.message : tr('Could not record replaced part'));
    } finally {
      setActionBusy(false);
    }
  };

  const doCheckoutTool = async () => {
    if (!client || !ticket || !selectedTool) return;
    setActionBusy(true);
    setToolFlash(null);
    try {
      await client.checkoutTool({
        ticketId: ticket.id,
        toolId: selectedTool.id,
        itemtype: selectedTool.itemtype,
        toolName: selectedTool.name,
      });
      setToolFlash('out');
      setSelectedTool(null);
      await loadStock(ticket.id);
      await load();
    } catch (e: unknown) {
      setToolFlash('err');
      Alert.alert(tr('Tool'), e instanceof Error ? e.message : tr('Check-out failed'));
    } finally {
      setActionBusy(false);
    }
  };

  const doReturnTool = async () => {
    if (!client || !ticket || !selectedTool) return;
    setActionBusy(true);
    setToolFlash(null);
    try {
      await client.returnTool({
        ticketId: ticket.id,
        toolId: selectedTool.id,
        itemtype: selectedTool.itemtype,
        toolName: selectedTool.name,
      });
      setToolFlash('in');
      setSelectedTool(null);
      await loadStock(ticket.id);
      await load();
    } catch (e: unknown) {
      setToolFlash('err');
      Alert.alert(tr('Tool'), e instanceof Error ? e.message : tr('Return failed'));
    } finally {
      setActionBusy(false);
    }
  };

  const toggleTask = async (taskId: number, done: boolean) => {
    if (!client) return;
    try {
      await client.setTaskState(taskId, done ? 2 : 1);
      await load();
    } catch (e: unknown) {
      Alert.alert(tr('Error'), e instanceof Error ? e.message : 'Could not change the task');
    }
  };

  const shareTicket = () => {
    if (!client || !ticket) return;
    void Share.share({ message: `#${ticket.id} ${ticket.name}\n${client.ticketWebUrl(ticket.id)}` });
  };

  const assignMyself = async () => {
    if (!client || !ticket) return;
    setActionBusy(true);
    try {
      if (typeof client.assignMyselfToTicket !== 'function') {
        throw new Error('Self-assign not available in this build');
      }
      await client.assignMyselfToTicket(ticket.id);
      Alert.alert('Assigned', tr('You are now assigned to this ticket.'));
      await load();
    } catch (e: unknown) {
      Alert.alert(tr('Error'), e instanceof Error ? e.message : 'Could not assign');
    } finally {
      setActionBusy(false);
    }
  };

  const addTaskFromUi = async () => {
    if (!client || !ticket) return;
    const text = taskText.trim();
    if (!text) {
      Alert.alert(tr('Required'), tr('Enter task text or pick a template'));
      return;
    }
    setTplBusy(true);
    try {
      await client.addTicketTask(
        ticket.id,
        text,
        taskTpl
          ? {
              state: taskTpl.state,
              actiontime: taskTpl.actiontime,
              taskcategories_id: taskTpl.taskcategories_id,
              is_private: taskTpl.is_private,
            }
          : undefined
      );
      setTaskText('');
      setTaskTpl(null);
      Alert.alert(tr('Task added'), tr('Task recorded on the ticket.'));
      await load();
    } catch (e: unknown) {
      Alert.alert(tr('Error'), e instanceof Error ? e.message : 'Could not add task');
    } finally {
      setTplBusy(false);
    }
  };

  const postSolutionFromUi = async () => {
    if (!client || !ticket) return;
    const text = solutionText.trim();
    if (!text) {
      Alert.alert(tr('Required'), tr('Enter solution text or pick a template'));
      return;
    }
    setTplBusy(true);
    try {
      await client.addTicketSolution(ticket.id, text, solutionTpl?.solutiontypes_id);
      setSolutionText('');
      setSolutionTpl(null);
      Alert.alert(tr('Solution posted'), tr('Ticket may move to Solved.'));
      await load();
    } catch (e: unknown) {
      Alert.alert(tr('Error'), e instanceof Error ? e.message : 'Could not post solution');
    } finally {
      setTplBusy(false);
    }
  };

  const approveSolution = () => {
    if (!client || !ticket) return;
    Alert.alert(
      'Approve solution',
      tr('Confirm the repair is acceptable and close this work order?'),
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Approve & close',
          onPress: async () => {
            setActionBusy(true);
            try {
              if (typeof client.approveTicketSolution !== 'function') {
                throw new Error('Approval not available in this build');
              }
              const result = await client.approveTicketSolution(ticket.id);
              Alert.alert(
                result.closed ? 'Approved & closed' : 'Approval recorded',
                result.message
              );
              await load();
            } catch (e: unknown) {
              const msg = e instanceof Error ? e.message : 'Approval failed';
              if ((e as { canOpenBrowser?: boolean })?.canOpenBrowser) {
                Alert.alert(tr('Cannot approve here'), msg, [
                  { text: 'Close', style: 'cancel' },
                  { text: 'Open in browser', onPress: () => Linking.openURL(client.ticketWebUrl(ticket.id)) },
                ]);
              } else {
                Alert.alert(tr('Error'), msg);
              }
            } finally {
              setActionBusy(false);
            }
          },
        },
      ]
    );
  };

  const rejectSolution = () => {
    if (!client || !ticket) return;
    Alert.alert(
      'Request more work',
      tr('Put this work order back on hold so the team can continue?'),
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Request more work',
          style: 'destructive',
          onPress: async () => {
            setActionBusy(true);
            try {
              await client.rejectTicketSolution(
                ticket.id,
                'Requester requested further work after reviewing the solution.'
              );
              Alert.alert(tr('Updated'), tr('Ticket set to Pending.'));
              await load();
            } catch (e: unknown) {
              const msg = e instanceof Error ? e.message : 'Could not update';
              if ((e as { canOpenBrowser?: boolean })?.canOpenBrowser) {
                Alert.alert(tr('Cannot update here'), msg, [
                  { text: 'Close', style: 'cancel' },
                  { text: 'Open in browser', onPress: () => Linking.openURL(client.ticketWebUrl(ticket.id)) },
                ]);
              } else {
                Alert.alert(tr('Error'), msg);
              }
            } finally {
              setActionBusy(false);
            }
          },
        },
      ]
    );
  };

  const submitSatisfaction = async () => {
    if (!client || !ticket || rating < 1) {
      Alert.alert(tr('Rating'), tr('Please select 1 to 5 stars.'));
      return;
    }
    setActionBusy(true);
    try {
      await client.submitTicketSatisfaction(ticket.id, rating, satComment.trim() || undefined);
      Alert.alert(tr('Thank you'), tr('Your satisfaction feedback was saved.'));
      setSatComment('');
      await load();
    } catch (e: unknown) {
      Alert.alert(tr('Error'), e instanceof Error ? e.message : 'Could not save survey');
    } finally {
      setActionBusy(false);
    }
  };

  const [attachSheetOpen, setAttachSheetOpen] = useState(false);

  const extFromMime = (m?: string) =>
    m === 'image/png' ? 'png' : m === 'image/webp' ? 'webp' : m === 'image/heic' ? 'heic' : m === 'application/pdf' ? 'pdf' : 'jpg';
  const withExt = (name: string | null | undefined, mime?: string) => {
    const n = (name || `photo_${Date.now()}`).trim();
    return /\.[A-Za-z0-9]{2,5}$/.test(n) ? n : `${n}.${extFromMime(mime)}`;
  };

  /** Upload one or many files one after the other and report what worked / what failed. */
  const uploadFiles = async (files: { uri: string; name: string; mimeType?: string }[]) => {
    if (!client || !ticket || !files.length) return;
    let ok = 0;
    const errors: string[] = [];
    setActionBusy(true);
    try {
      for (let i = 0; i < files.length; i++) {
        setUploading(`${i + 1}/${files.length}`);
        try {
          await client.uploadTicketDocument(ticket.id, files[i]);
          ok += 1;
        } catch (e: unknown) {
          errors.push(`${files[i].name}: ${e instanceof Error ? e.message : tr('Upload failed')}`);
        }
      }
    } finally {
      setUploading(null);
      setActionBusy(false);
    }
    if (ok) await load();
    if (errors.length) {
      Alert.alert(tr('Upload failed'), errors.join('\n\n'));
    } else {
      Alert.alert(
        tr('Uploaded'),
        ok === 1 ? tr('Attachment added to the ticket.') : trf('{n} files added to the ticket.', { n: ok })
      );
    }
  };

  const attachFromCamera = async () => {
    setAttachSheetOpen(false);
    try {
      const ImagePicker = await import('expo-image-picker');
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(tr('Permission'), tr('Allow camera access to take a photo.'));
        return;
      }
      const res = await ImagePicker.launchCameraAsync({ quality: QUALITY_VALUE[getPrefs().uploadQuality] });
      if (res.canceled || !res.assets?.length) return;
      await uploadFiles(
        res.assets.map((a) => ({
          uri: a.uri,
          name: withExt(a.fileName, a.mimeType || 'image/jpeg'),
          mimeType: a.mimeType || 'image/jpeg',
        }))
      );
    } catch (e: unknown) {
      Alert.alert(tr('Error'), e instanceof Error ? e.message : tr('Upload failed'));
    }
  };

  const attachFromGallery = async () => {
    setAttachSheetOpen(false);
    try {
      const ImagePicker = await import('expo-image-picker');
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(tr('Permission'), tr('Allow photo library access to attach images.'));
        return;
      }
      const mediaTypes =
        (ImagePicker as { MediaTypeOptions?: { Images: unknown } }).MediaTypeOptions?.Images ?? ['images'];
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: mediaTypes as never,
        quality: QUALITY_VALUE[getPrefs().uploadQuality],
        allowsMultipleSelection: true,
        selectionLimit: 5,
      });
      if (res.canceled || !res.assets?.length) return;
      await uploadFiles(
        res.assets.map((a) => ({
          uri: a.uri,
          name: withExt(a.fileName, a.mimeType || 'image/jpeg'),
          mimeType: a.mimeType || 'image/jpeg',
        }))
      );
    } catch (e: unknown) {
      Alert.alert(tr('Error'), e instanceof Error ? e.message : tr('Upload failed'));
    }
  };

  const attachFromFiles = async () => {
    setAttachSheetOpen(false);
    try {
      const DocumentPicker = await import('expo-document-picker');
      const res = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true, // gives a file:// path the upload can read (content:// would fail)
        multiple: true,
      });
      if (res.canceled || !res.assets?.length) return;
      await uploadFiles(
        res.assets.map((a) => ({
          uri: a.uri,
          name: withExt(a.name, a.mimeType),
          mimeType: a.mimeType || undefined,
        }))
      );
    } catch (e: unknown) {
      Alert.alert(tr('Error'), e instanceof Error ? e.message : tr('Upload failed'));
    }
  };

  const attachFile = () => {
    if (!client || !ticket) return;
    if (typeof client.uploadTicketDocument !== 'function') {
      Alert.alert(tr('Update required'), tr('This build cannot upload files. Reinstall the latest app.'));
      return;
    }
    setAttachSheetOpen(true);
  };

  const openDocument = async (docId: number, name: string) => {
    if (!client) return;
    setActionBusy(true);
    try {
      // Prefer opening the ticket on the server (reliable); optional local download
      let downloaded = false;
      try {
        let FileSystem: typeof import('expo-file-system') | null = null;
        try {
          FileSystem = await import('expo-file-system/legacy');
        } catch {
          try {
            FileSystem = await import('expo-file-system');
          } catch {
            FileSystem = null;
          }
        }
        const downloadAsync = FileSystem && (FileSystem as { downloadAsync?: Function }).downloadAsync;
        const cacheDir =
          FileSystem &&
          ((FileSystem as { cacheDirectory?: string }).cacheDirectory ||
            (FileSystem as { Paths?: { cache?: string } }).Paths?.cache);
        if (typeof downloadAsync === 'function' && cacheDir) {
          const url = client.documentDownloadUrl(docId);
          const safe = name.replace(/[^a-zA-Z0-9._-]/g, '_');
          const target = `${cacheDir}doc_${docId}_${safe}`;
          const result = await downloadAsync(url, target, {
            headers: {
              'Session-Token': client.getSessionToken?.() || '',
              'App-Token': client.getAppToken?.() || '',
            },
          });
          if (result && result.status < 400 && result.uri) {
            if (await Sharing.isAvailableAsync()) {
              await Sharing.shareAsync(result.uri, { dialogTitle: name });
              downloaded = true;
            }
          }
        }
      } catch {
        /* fall through to web */
      }
      if (!downloaded) {
        Linking.openURL(client.ticketWebUrl(Number(id)));
      }
    } catch (e: unknown) {
      Alert.alert(
        'Attachment',
        e instanceof Error ? e.message : tr('Open the work order on the server to view files.')
      );
    } finally {
      setActionBusy(false);
    }
  };



  const setLinkedAssetStatus = (asset: { itemtype: string; items_id: number; name: string }, mode: 'active' | 'down') => {
    if (!client || typeof client.setAssetOperationalStatus !== 'function') {
      Alert.alert(tr('Unavailable'), tr('Asset status update is not available in this build.'));
      return;
    }
    Alert.alert(
      mode === 'active' ? 'Set Active' : 'Set Down',
      `Mark "${asset.name}" as ${mode === 'active' ? 'Active' : 'Down'} on the CMMS?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Update',
          onPress: async () => {
            setActionBusy(true);
            try {
              await client.setAssetOperationalStatus(asset.itemtype, asset.items_id, mode, ticket?.id);
              Alert.alert(tr('Updated'), `${asset.name} is now ${mode === 'active' ? 'Active' : 'Down'}.`);
            } catch (e: unknown) {
              Alert.alert(tr('Error'), e instanceof Error ? e.message : 'Could not update asset status');
            } finally {
              setActionBusy(false);
            }
          },
        },
      ]
    );
  };

  // Most recent first ("last in, first shown")
  const byDateDesc = <T extends { date?: string }>(rows: T[]) =>
    [...rows].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

  const sortedTasks: GlpiTicketDetails['tasks'] = ticket ? byDateDesc(ticket.tasks) : [];
  const sortedFollowups: GlpiTicketDetails['followups'] = ticket ? byDateDesc(ticket.followups || []) : [];

  const isClosed = ticket?.status === 6;
  const realLinkedAssets = (ticket?.linked_assets || []).filter((a) => {
    const name = (a.name || '').toLowerCase().trim();
    const sn = (a.serial || '').trim();
    if (!name) return false;
    if (name === 'report an issue' || name.startsWith('report an issue')) return false;
    // Prefer items with a serial; drop empty SN placeholders without real equipment name patterns
    if (!sn || sn === '—' || sn === '-') {
      // keep only if name looks like a real device (not generic IT phrases)
      if (/report|issue|problem|request|ticket/.test(name) && !/[0-9]/.test(name)) return false;
    }
    return true;
  });

  const styles = makeStyles(colors);

  const exportPdf = async () => {
    if (!ticket) return;
    setExporting(true);
    try {
      const esc = (s: unknown) =>
        String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const html = `
        <html><head><meta charset="utf-8" />
        <style>
          body { font-family: -apple-system, Roboto, sans-serif; color: #0D1B2A; padding: 24px; }
          h1 { font-size: 20px; margin-bottom: 4px; }
          .meta { color: #4A6580; font-size: 12px; margin-bottom: 16px; }
          h2 { font-size: 14px; color: #0A3D62; border-bottom: 1px solid #C5D9E8; padding-bottom: 4px; margin-top: 20px; }
          .box { background: #F5F9FC; border: 1px solid #DDE8F0; border-radius: 8px; padding: 10px; margin-bottom: 8px; }
          .date { color: #1A6FA8; font-size: 11px; margin-bottom: 3px; }
          .empty { color: #8AA8BF; font-size: 13px; }
        </style></head>
        <body>
          <h1>Ticket #${ticket.id} — ${esc(ticket.name)}</h1>
          <div class="meta">
            Status: ${esc(ticket.status_label)} &nbsp;·&nbsp; Priority ${ticket.priority}
            ${ticket.date ? `&nbsp;·&nbsp; Opened ${esc(ticket.date)}` : ''}<br/>
            Location: ${esc(ticket.location_name || '—')}<br/>
            Assigned: ${esc(ticket.assigned_names?.length ? ticket.assigned_names.join(', ') : '—')}
          </div>

          <h2>${tr('Linked assets')}</h2>
          ${ticket.linked_assets.length
            ? ticket.linked_assets
                .map((a) => `<div class="box"><b>${esc(a.name)}</b><br/>SN ${esc(a.serial || '—')}</div>`)
                .join('')
            : `<div class=\"empty\">${tr('None linked')}</div>`}

          <h2>${tr('Tasks')}</h2>
          ${sortedTasks.length
            ? sortedTasks
                .map((t) => `<div class="box">${t.date ? `<div class="date">${esc(t.date)}</div>` : ''}${esc(t.content || '—')}</div>`)
                .join('')
            : `<div class=\"empty\">${tr('No tasks yet')}</div>`}

          <h2>${tr('Solution')}</h2>
          ${ticket.solutions.length
            ? ticket.solutions.map((s) => `<div class="box">${esc(s)}</div>`).join('')
            : `<div class=\"empty\">${tr('No solution recorded')}</div>`}

          <h2>${tr('Follow-ups')}</h2>
          ${sortedFollowups.length
            ? sortedFollowups
                .map((f) => `<div class="box">${f.date ? `<div class="date">${esc(f.date)}</div>` : ''}${esc(f.content)}</div>`)
                .join('')
            : `<div class=\"empty\">${tr('No follow-ups')}</div>`}
        </body></html>`;

      const { uri } = await Print.printToFileAsync({ html });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          mimeType: 'application/pdf',
          dialogTitle: `Ticket #${ticket.id} report`,
          UTI: 'com.adobe.pdf',
        });
      } else {
        Alert.alert(tr('Saved'), `Report saved to ${uri}`);
      }
    } catch (e: unknown) {
      Alert.alert(tr('Error'), e instanceof Error ? e.message : 'Could not generate PDF');
    } finally {
      setExporting(false);
    }
  };

  if (loading && !ticket) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }
  if (!ticket) {
    return (
      <View style={styles.center}>
        <Text>{tr('Work order not found')}</Text>
      </View>
    );
  }

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          headerStyle: { backgroundColor: colors.header },
          headerTintColor: '#FFFFFF',
          headerTitle: () => (
            <View>
              <Text style={{ color: '#FFFFFFB3', fontSize: 11 }}>#{ticket.id}</Text>
              <Text style={{ color: '#FFFFFF', fontWeight: '700', fontSize: 15, maxWidth: 230 }} numberOfLines={1}>
                {ticket.name}
              </Text>
            </View>
          ),
          headerRight: () => (
            <Pressable onPress={shareTicket} hitSlop={12} style={{ paddingHorizontal: 6 }}>
              <Text style={{ color: '#FFFFFF', fontSize: 18 }}>⤴</Text>
            </Pressable>
          ),
        }}
      />
      <ScrollView style={styles.root} contentContainerStyle={{ padding: 16, paddingBottom: 110 }}>
        {(() => {
          const ui = statusUi[ticket.status] || statusUi[1];
          const pc = priorityColor(ticket.priority, colors);
          return (
            <View style={styles.metaBox}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={{ backgroundColor: ui.color + '1F', borderColor: ui.color + '66', borderWidth: 1, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 3 }}>
                  <Text style={{ color: ui.color, fontSize: 10, fontWeight: '800', letterSpacing: 0.4 }}>
                    {tr(ui.label).toUpperCase()}
                  </Text>
                </View>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: pc }} />
                <Text style={{ color: colors.textMuted, fontSize: 12, fontWeight: '700' }}>
                  {tr(priorityLabel(ticket.priority))}
                </Text>
              </View>
              {ticket.name.length > 28 ? <Text style={styles.cardTitle}>{ticket.name}</Text> : null}
              {ticket.location_name ? (
                <Text style={styles.metaLine}>{ticket.location_name.split('>').pop()?.trim()}</Text>
              ) : null}
              {ticket.date ? (
                <Text style={styles.metaLine}>
                  {tr('Opened')} {shortDate(ticket.date)}
                </Text>
              ) : null}
              <Text style={[styles.metaLine, { color: colors.text }]}>
                {tr('Assigned')}: {ticket.assigned_names?.length ? ticket.assigned_names.join(', ') : '—'}
              </Text>
              {isStaff && !isClosed ? (
                <Pressable
                  style={[styles.btnOutline, { marginTop: 10, borderColor: colors.accent }]}
                  onPress={assignMyself}
                  disabled={actionBusy}
                >
                  <Text style={[styles.btnOutlineText, { color: colors.accent }]}>{tr('Assign to me')}</Text>
                </Pressable>
              ) : null}
            </View>
          );
        })()}

        {isStaff ? <Text style={styles.section}>{tr('Update status')}</Text> : null}
        {!isStaff ? null : statusBusy ? (
          <ActivityIndicator color="#0B3D5C" style={{ marginVertical: 8 }} />
        ) : (
          <View style={styles.statusRow}>
            {STATUS_ACTIONS.map((s) => {
              const active = ticket.status === s.status;
              return (
                <Pressable
                  key={s.status}
                  onPress={() => changeStatus(s.status)}
                  style={[
                    styles.statusChip,
                    { borderColor: s.color },
                    active && { backgroundColor: s.color },
                  ]}
                >
                  <Text style={[styles.statusChipText, active && { color: '#fff' }, !active && { color: s.color }]}>
                    {tr(s.label)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}

        <ProcessTimeline
          ticket={ticket}
          canEditTasks={isStaff}
          onToggleTask={toggleTask}
          onOpenDocument={openDocument}
        />

        {isStaff && !isClosed ? (
          <View style={{ marginBottom: 8 }}>
            <Text style={[styles.muted, { marginBottom: 6 }]}>{tr('Add task')}</Text>
            {taskTemplates.length > 0 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
                {taskTemplates.map((tpl) => (
                  <Pressable
                    key={tpl.id}
                    style={{
                      paddingHorizontal: 12,
                      paddingVertical: 8,
                      borderRadius: 20,
                      backgroundColor: colors.chip || colors.bgCard,
                      borderWidth: 1,
                      borderColor: colors.border,
                      marginRight: 8,
                    }}
                    onPress={() => {
                      setTaskText(tpl.content || tpl.name);
                      setTaskTpl(tpl);
                    }}
                  >
                    <Text style={{ color: colors.accent, fontSize: 13, fontWeight: '600' }} numberOfLines={1}>
                      {tpl.name}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            ) : null}
            <TextInput
              style={[styles.input, { minHeight: 64, textAlignVertical: 'top' }]}
              placeholder={tr('Task description…')}
              placeholderTextColor={colors.textDim}
              value={taskText}
              onChangeText={setTaskText}
              multiline
            />
            <Pressable
              style={[styles.btn, { marginTop: 8, opacity: tplBusy ? 0.6 : 1 }]}
              onPress={addTaskFromUi}
              disabled={tplBusy}
            >
              {tplBusy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.btnText}>{tr('Add task')}</Text>
              )}
            </Pressable>
          </View>
        ) : null}

        <Text style={styles.section}>{tr('Linked assets')}</Text>
        {realLinkedAssets.length === 0 ? (
          <Text style={styles.muted}>{tr('None linked')}</Text>
        ) : (
          realLinkedAssets.map((a) => (
            <View key={`${a.itemtype}-${a.items_id}`} style={styles.box}>
              <Text style={styles.boxTitle}>{a.name}</Text>
              <Text style={styles.muted}>SN {a.serial || '—'}</Text>
              {(ticket.status === 5 || ticket.status === 6) ? (
                <View style={styles.toggleRow}>
                  <Text style={[styles.toggleLabel, { color: '#C0392B', fontWeight: '700' }]}>{tr('Down')}</Text>
                  <Switch
                    value={assetModeMap[`${a.itemtype}-${a.items_id}`] !== false}
                    onValueChange={(on) => {
                      const key = `${a.itemtype}-${a.items_id}`;
                      setAssetModeMap((m) => ({ ...m, [key]: on }));
                      setLinkedAssetStatus(a, on ? 'active' : 'down');
                    }}
                    disabled={actionBusy}
                    trackColor={{ false: '#E74C3C', true: '#27AE60' }}
                    thumbColor="#FFFFFF"
                    ios_backgroundColor="#E74C3C"
                  />
                  <Text style={[styles.toggleLabel, { color: '#1A8D4A', fontWeight: '700' }]}>{tr('Active')}</Text>
                </View>
              ) : (
                <Text style={[styles.muted, { marginTop: 6, fontSize: 11 }]}>
                  After Solved/Closed, use the switch to set Active or Down
                </Text>
              )}
            </View>
          ))
        )}


        {isStaff && !isClosed ? (
          <>
            <Text style={styles.section}>{tr('Field stock')}</Text>
            <Text style={[styles.muted, { marginTop: -4, marginBottom: 10, fontSize: 12 }]}>
              {tr('Spare parts and tools used on this ticket')}
            </Text>

            {/* Spare part | Tool | QR — side by side */}
            <View style={styles.fieldRow}>
              <Pressable
                style={[
                  styles.fieldBtn,
                  !!selectedPart && { borderColor: colors.accent },
                  stockFlash === 'ok' && { borderColor: colors.success },
                  stockFlash === 'err' && { borderColor: colors.danger },
                ]}
                onPress={() => {
                  setPartPickerOpen(true);
                  if (!spareParts.length || stockError) void loadStock(ticket?.id);
                }}
                disabled={actionBusy}
              >
                <Text style={styles.fieldBtnText} numberOfLines={1}>{tr('Spare part')}</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.fieldBtn,
                  !!selectedTool && { borderColor: colors.accent },
                  toolFlash === 'out' && { borderColor: colors.warning },
                  toolFlash === 'in' && { borderColor: colors.success },
                  toolFlash === 'err' && { borderColor: colors.danger },
                ]}
                onPress={() => {
                  setToolPickerOpen(true);
                  if (!tools.length || stockError) void loadStock(ticket?.id);
                }}
                disabled={actionBusy}
              >
                <Text style={styles.fieldBtnText} numberOfLines={1}>{tr('Tool')}</Text>
              </Pressable>
              <Pressable
                style={styles.fieldQr}
                onPress={() =>
                  router.push({ pathname: '/ticket/scan', params: { ticketId: String(ticket.id) } })
                }
                accessibilityLabel={tr('Scan QR code')}
              >
                <Text style={{ fontSize: 22, color: colors.accent }}>▦</Text>
              </Pressable>
            </View>

            {stockLoading ? <ActivityIndicator color={colors.accent} style={{ marginTop: 10 }} /> : null}

            {stockError ? (
              <View style={[styles.box, { borderColor: colors.warning, marginTop: 10 }]}>
                <Text style={{ color: colors.warning, fontSize: 12, fontWeight: '700' }}>⚠ {stockError}</Text>
                <Pressable style={{ marginTop: 8 }} onPress={() => void loadStock(ticket?.id)}>
                  <Text style={{ color: colors.accent, fontWeight: '700', fontSize: 13 }}>{tr('Retry')}</Text>
                </Pressable>
              </View>
            ) : null}

            {/* Chosen spare part */}
            {selectedPart ? (
              <View style={[styles.box, { marginTop: 10 }]}>
                <Text style={styles.boxTitle} numberOfLines={2}>{selectedPart.name}</Text>
                {(() => {
                  const wh = chosenWarehouse(selectedPart, selectedWh);
                  const avail = wh ? wh.qty : selectedPart.stock;
                  return (
                    <>
                      <Text style={styles.muted}>
                        {tr('In stock')}: {avail}
                      </Text>
                      {selectedPart.warehouses && selectedPart.warehouses.length > 1 ? (
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
                          {selectedPart.warehouses.map((w) => (
                            <Pressable
                              key={w.id}
                              onPress={() => {
                                setSelectedWh(w.id);
                                setPartQty((q) => Math.min(Math.max(1, w.qty), q));
                              }}
                              style={[
                                styles.whChip,
                                selectedWh === w.id && { backgroundColor: colors.chipOn, borderColor: colors.chipOn },
                              ]}
                            >
                              <Text
                                style={{
                                  fontSize: 12,
                                  fontWeight: '700',
                                  color: selectedWh === w.id ? colors.chipOnText : colors.text,
                                }}
                              >
                                {w.name} · {w.qty}
                              </Text>
                            </Pressable>
                          ))}
                        </ScrollView>
                      ) : null}
                      <View style={[styles.qtyRow, { marginTop: 10 }]}>
                        <Pressable style={styles.qtyBtn} onPress={() => setPartQty((q) => Math.max(1, q - 1))}>
                          <Text style={styles.qtyBtnText}>−</Text>
                        </Pressable>
                        <Text style={styles.qtyVal}>{partQty}</Text>
                        <Pressable
                          style={styles.qtyBtn}
                          onPress={() => setPartQty((q) => Math.min(Math.max(1, avail), q + 1))}
                        >
                          <Text style={styles.qtyBtnText}>+</Text>
                        </Pressable>
                        <Pressable
                          style={[styles.miniBtn, { backgroundColor: colors.accent, flex: 1, opacity: avail < 1 ? 0.5 : 1 }]}
                          onPress={confirmSparePart}
                          disabled={actionBusy || avail < 1}
                        >
                          <Text style={styles.miniBtnText}>{tr('Confirm')}</Text>
                        </Pressable>
                        <Pressable style={styles.qtyBtn} onPress={() => setSelectedPart(null)}>
                          <Text style={styles.qtyBtnText}>✕</Text>
                        </Pressable>
                      </View>
                    </>
                  );
                })()}
              </View>
            ) : null}

            {/* Chosen tool */}
            {selectedTool ? (
              <View style={[styles.box, { marginTop: 10 }]}>
                <Text style={styles.boxTitle} numberOfLines={2}>{selectedTool.name}</Text>
                <Text style={styles.muted}>
                  {selectedTool.serial ? `SN ${selectedTool.serial} · ` : ''}
                  {selectedTool.status === 'in_use' ? tr('In use') : tr('Available')}
                </Text>
                <View style={[styles.qtyRow, { marginTop: 10 }]}>
                  {selectedTool.status === 'in_use' ? (
                    <Pressable
                      style={[styles.miniBtn, { backgroundColor: colors.success }]}
                      onPress={doReturnTool}
                      disabled={actionBusy}
                    >
                      <Text style={styles.miniBtnText}>{tr('Return')}</Text>
                    </Pressable>
                  ) : (
                    <Pressable
                      style={[styles.miniBtn, { backgroundColor: colors.warning }]}
                      onPress={doCheckoutTool}
                      disabled={actionBusy}
                    >
                      <Text style={styles.miniBtnText}>{tr('Check out')}</Text>
                    </Pressable>
                  )}
                  <Pressable style={styles.qtyBtn} onPress={() => setSelectedTool(null)}>
                    <Text style={styles.qtyBtnText}>✕</Text>
                  </Pressable>
                </View>
              </View>
            ) : null}

            {/* History on this ticket */}
            {ticketStockHistory.parts.length > 0 || ticketStockHistory.tools.length > 0 ? (
              <View style={[styles.box, { marginTop: 10 }]}>
                <Text style={[styles.muted, { fontWeight: '700', marginBottom: 6 }]}>{tr('On this ticket')}</Text>
                {ticketStockHistory.parts.map((h, i) => (
                  <Text key={`p${i}`} style={styles.metaLine}>
                    {h.name} × {h.quantity}
                    {h.date ? `  ·  ${h.date}` : ''}
                  </Text>
                ))}
                {ticketStockHistory.tools.map((h, i) => (
                  <Text key={`t${i}`} style={styles.metaLine}>
                    {h.name}
                    {h.direction ? `  ·  ${h.direction === 'out' ? tr('Check out') : h.direction === 'in' ? tr('Return') : h.direction}` : ''}
                    {h.date ? `  ·  ${h.date}` : ''}
                  </Text>
                ))}
              </View>
            ) : null}

            {/* Part picker modal */}
            <Modal visible={partPickerOpen} transparent animationType="fade" onRequestClose={() => setPartPickerOpen(false)}>
              <Pressable style={styles.modalBackdrop} onPress={() => setPartPickerOpen(false)}>
                <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation?.()}>
                  <Text style={styles.modalTitle}>{tr('Select spare part')}</Text>
                  <TextInput
                    style={styles.searchInput}
                    placeholder={tr('Search parts…')}
                    placeholderTextColor={colors.textDim}
                    value={partQuery}
                    onChangeText={setPartQuery}
                  />
                  {stockLoading ? (
                    <ActivityIndicator color={colors.accent} style={{ marginVertical: 16 }} />
                  ) : (
                    <ScrollView style={{ maxHeight: 320 }} keyboardShouldPersistTaps="handled">
                      {(() => {
                        const q = partQuery.trim().toLowerCase();
                        const filtered = spareParts.filter((p) => !q || `${p.name} ${p.ref || ''}`.toLowerCase().includes(q));
                        if (!spareParts.length) {
                          return (
                            <Text style={[styles.muted, { textAlign: 'center', paddingVertical: 20 }]}>
                              {stockError || tr('No spare parts found for this ticket')}
                            </Text>
                          );
                        }
                        if (!filtered.length) {
                          return (
                            <Text style={[styles.muted, { textAlign: 'center', paddingVertical: 20 }]}>
                              {tr('No match')} “{partQuery}”
                            </Text>
                          );
                        }
                        return filtered.slice(0, 100).map((p) => (
                          <Pressable
                            key={p.id}
                            style={styles.modalRow}
                            onPress={() => {
                              pickPart(p);
                              setPartPickerOpen(false);
                              setPartQuery('');
                            }}
                          >
                            <Text style={styles.modalRowText} numberOfLines={1}>{p.name}</Text>
                            <Text style={{ fontWeight: '800', color: p.stock > 0 ? colors.success : colors.danger }}>
                              {p.stock}
                            </Text>
                          </Pressable>
                        ));
                      })()}
                    </ScrollView>
                  )}
                  <Pressable style={[styles.modalClose, { marginTop: 4 }]} onPress={() => void loadStock(ticket?.id)}>
                    <Text style={styles.modalCloseText}>{tr('Refresh list')}</Text>
                  </Pressable>
                  <Pressable style={styles.modalClose} onPress={() => setPartPickerOpen(false)}>
                    <Text style={styles.modalCloseText}>{tr('Close')}</Text>
                  </Pressable>
                </Pressable>
              </Pressable>
            </Modal>

            {/* Tool picker modal */}
            <Modal visible={toolPickerOpen} transparent animationType="fade" onRequestClose={() => setToolPickerOpen(false)}>
              <Pressable style={styles.modalBackdrop} onPress={() => setToolPickerOpen(false)}>
                <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation?.()}>
                  <Text style={styles.modalTitle}>{tr('Select tool')}</Text>
                  <TextInput
                    style={styles.searchInput}
                    placeholder={tr('Search tools…')}
                    placeholderTextColor={colors.textDim}
                    value={toolQuery}
                    onChangeText={setToolQuery}
                  />
                  {stockLoading ? (
                    <ActivityIndicator color={colors.accent} style={{ marginVertical: 16 }} />
                  ) : (
                    <ScrollView style={{ maxHeight: 320 }} keyboardShouldPersistTaps="handled">
                      {(() => {
                        const q = toolQuery.trim().toLowerCase();
                        const filtered = tools.filter((t) => !q || `${t.name} ${t.serial || ''}`.toLowerCase().includes(q));
                        if (!tools.length) {
                          return (
                            <Text style={[styles.muted, { textAlign: 'center', paddingVertical: 20 }]}>
                              {stockError || tr('No tools found. Register tools under Assets → Available Tools.')}
                            </Text>
                          );
                        }
                        if (!filtered.length) {
                          return (
                            <Text style={[styles.muted, { textAlign: 'center', paddingVertical: 20 }]}>
                              {tr('No match')} “{toolQuery}”
                            </Text>
                          );
                        }
                        return filtered.slice(0, 100).map((t) => {
                          const inUse = t.status === 'in_use';
                          return (
                            <Pressable
                              key={`${t.itemtype}-${t.id}`}
                              style={styles.modalRow}
                              onPress={() => {
                                setSelectedTool(t);
                                setSelectedPart(null);
                                setToolPickerOpen(false);
                                setToolQuery('');
                              }}
                            >
                              <View style={{ flex: 1 }}>
                                <Text style={styles.modalRowText} numberOfLines={1}>{t.name}</Text>
                                {t.serial ? <Text style={styles.muted}>SN {t.serial}</Text> : null}
                              </View>
                              <Text style={{ fontSize: 12, fontWeight: '700', color: inUse ? colors.warning : colors.success }}>
                                {inUse ? (t.onThisTicket ? tr('On this ticket') : tr('In use')) : tr('Available')}
                              </Text>
                            </Pressable>
                          );
                        });
                      })()}
                    </ScrollView>
                  )}
                  <Pressable style={[styles.modalClose, { marginTop: 4 }]} onPress={() => void loadStock(ticket?.id)}>
                    <Text style={styles.modalCloseText}>{tr('Refresh list')}</Text>
                  </Pressable>
                  <Pressable style={styles.modalClose} onPress={() => setToolPickerOpen(false)}>
                    <Text style={styles.modalCloseText}>{tr('Close')}</Text>
                  </Pressable>
                </Pressable>
              </Pressable>
            </Modal>
          </>
        ) : null}

        {!isClosed ? (
          <>
        <Text style={styles.section}>{tr('Attachments')}</Text>
        {(ticket.documents || []).length === 0 ? (
          <Text style={styles.muted}>{tr('No files or screenshots yet')}</Text>
        ) : (
          (ticket.documents || []).map((d) => (
            <Pressable
              key={d.id}
              style={styles.box}
              onPress={() => openDocument(d.id, d.name)}
            >
              <Text style={styles.boxTitle}>📎 {d.name}</Text>
              {d.filename ? <Text style={styles.muted}>{d.filename}</Text> : null}
              <Text style={[styles.muted, { marginTop: 4 }]}>{tr('Tap to open / share')}</Text>
            </Pressable>
          ))
        )}
        <Pressable
          style={[styles.btn, styles.btnSecondary, { marginTop: 8 }]}
          onPress={attachFile}
          disabled={actionBusy}
        >
          {actionBusy && uploading ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <ActivityIndicator color={colors.accent} />
              <Text style={[styles.btnText, { color: colors.accent }]}>{tr('Uploading')} {uploading}</Text>
            </View>
          ) : actionBusy ? (
            <ActivityIndicator color={colors.accent} />
          ) : (
            <Text style={[styles.btnText, { color: colors.accent }]}>{tr('Add photo or file')}</Text>
          )}
        </Pressable>

        <Modal visible={attachSheetOpen} transparent animationType="fade" onRequestClose={() => setAttachSheetOpen(false)}>
          <Pressable style={styles.modalBackdrop} onPress={() => setAttachSheetOpen(false)}>
            <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation?.()}>
              <Text style={styles.modalTitle}>{tr('Add attachment')}</Text>
              <Pressable style={styles.modalRow} onPress={attachFromCamera}>
                <Text style={styles.modalRowText}>📷  {tr('Take photo')}</Text>
              </Pressable>
              <Pressable style={styles.modalRow} onPress={attachFromGallery}>
                <Text style={styles.modalRowText}>🖼  {tr('Photo / screenshot')}</Text>
              </Pressable>
              <Pressable style={styles.modalRow} onPress={attachFromFiles}>
                <Text style={styles.modalRowText}>📄  {tr('File')}</Text>
              </Pressable>
              <Pressable style={styles.modalClose} onPress={() => setAttachSheetOpen(false)}>
                <Text style={styles.modalCloseText}>{tr('Cancel')}</Text>
              </Pressable>
            </Pressable>
          </Pressable>
        </Modal>

                  </>
        ) : null}

        {isStaff && !isClosed && ticket.status < 5 ? (
          <View style={{ marginBottom: 12 }}>
            <Text style={[styles.muted, { marginBottom: 6 }]}>{tr('Post solution')}</Text>
            {solutionTemplates.length > 0 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
                {solutionTemplates.map((tpl) => (
                  <Pressable
                    key={tpl.id}
                    style={{
                      paddingHorizontal: 12,
                      paddingVertical: 8,
                      borderRadius: 20,
                      backgroundColor: colors.chip || colors.bgCard,
                      borderWidth: 1,
                      borderColor: colors.border,
                      marginRight: 8,
                    }}
                    onPress={() => {
                      setSolutionText(tpl.content || tpl.name);
                      setSolutionTpl(tpl);
                    }}
                  >
                    <Text style={{ color: colors.accent, fontSize: 13, fontWeight: '600' }} numberOfLines={1}>
                      {tpl.name}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            ) : null}
            <TextInput
              style={[styles.input, { minHeight: 72, textAlignVertical: 'top' }]}
              placeholder={tr('Describe the resolution…')}
              placeholderTextColor={colors.textDim}
              value={solutionText}
              onChangeText={setSolutionText}
              multiline
            />
            <Pressable
              style={[styles.btn, { marginTop: 8, backgroundColor: '#059669', opacity: tplBusy ? 0.6 : 1 }]}
              onPress={postSolutionFromUi}
              disabled={tplBusy}
            >
              {tplBusy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.btnText}>{tr('Post solution')}</Text>
              )}
            </Pressable>
          </View>
        ) : null}


        {(ticket.status === 5 || (ticket.solutions || []).length > 0) && ticket.status !== 6 ? (
          <View style={{ marginTop: 10, gap: 8 }}>
            <Text style={styles.muted}>{tr('Requester approval')}</Text>
            <Pressable
              style={[styles.btn, { backgroundColor: colors.success }]}
              onPress={approveSolution}
              disabled={actionBusy}
            >
              <Text style={styles.btnText}>{tr('Approve solution & close')}</Text>
            </Pressable>
            <Pressable
              style={[styles.btn, styles.btnSecondary]}
              onPress={rejectSolution}
              disabled={actionBusy}
            >
              <Text style={[styles.btnText, { color: colors.accent }]}>{tr('Request more work')}</Text>
            </Pressable>
          </View>
        ) : null}

        {/* Satisfaction only after ticket is approved/closed */}
        {ticket.status === 6 ? (
          <>
            <Text style={styles.section}>{tr('Satisfaction survey')}</Text>
            {ticket.satisfaction?.satisfaction ? (
              <View style={styles.box}>
                <Text style={styles.boxTitle}>
                  Your rating: {'★'.repeat(ticket.satisfaction.satisfaction)}
                  {'☆'.repeat(Math.max(0, 5 - ticket.satisfaction.satisfaction))}
                </Text>
                {ticket.satisfaction.comment ? (
                  <Text style={styles.boxBody}>{ticket.satisfaction.comment}</Text>
                ) : null}
              </View>
            ) : (
              <View>
                <Text style={styles.muted}>{tr('Rate the service after approval (1–5)')}</Text>
                <View style={{ flexDirection: 'row', gap: 8, marginVertical: 10 }}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <Pressable
                      key={n}
                      onPress={() => setRating(n)}
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: 22,
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: rating >= n ? colors.warning + '33' : colors.bgCard,
                        borderWidth: 1,
                        borderColor: rating >= n ? colors.warning : colors.border,
                      }}
                    >
                      <Text style={{ fontSize: 18 }}>{rating >= n ? '★' : '☆'}</Text>
                    </Pressable>
                  ))}
                </View>
                <TextInput
                  style={[styles.input, { minHeight: 60 }]}
                  placeholder={tr('Optional comment')}
                  value={satComment}
                  onChangeText={setSatComment}
                />
                <Pressable
                  style={styles.btn}
                  onPress={submitSatisfaction}
                  disabled={actionBusy || rating < 1}
                >
                  <Text style={styles.btnText}>{tr('Submit satisfaction')}</Text>
                </Pressable>
              </View>
            )}
          </>
        ) : null}


        {!isClosed ? (
          <>
        <Text style={styles.section}>{tr('Add field note')}</Text>
        <TextInput
          style={styles.input}
          multiline
          placeholder={tr('What did you check or fix?')}
          value={note}
          onChangeText={setNote}
        />
        <Pressable style={styles.btn} onPress={sendFollowup} disabled={sending || !note.trim()}>
          {sending ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>{tr('Post note')}</Text>}
        </Pressable>

                  </>
        ) : null}

        <Text style={styles.section}>{tr('Reports')}</Text>
        <View style={styles.reportRow}>
          <Pressable
            style={[styles.btn, styles.reportBtn]}
            onPress={exportPdf}
            disabled={exporting}
          >
            {exporting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.btnText} numberOfLines={1}>{tr('Export PDF')}</Text>
            )}
          </Pressable>
          <Pressable
            style={[styles.btn, styles.btnSecondary, styles.reportBtn]}
            onPress={() => {
              if (client && ticket) {
                Linking.openURL(client.ticketWebUrl(ticket.id));
              }
            }}
          >
            <Text style={[styles.btnText, { color: colors.accent }]} numberOfLines={1}>
              {tr('View report')}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
      <Pressable style={styles.fab} onPress={() => router.push('/ticket/new')}>
        <Text style={styles.fabPlus}>+</Text>
      </Pressable>
    </>
  );
}

function makeStyles(colors: ReturnType<typeof useTheme>['colors']) {
  return StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bg },
  title: { fontSize: 20, fontWeight: '700', color: colors.text },
  metaBox: {
    marginTop: 12,
    backgroundColor: colors.bgCard,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  bold: { fontWeight: '700', color: colors.text },
  section: { marginTop: 22, fontWeight: '700', color: colors.accent, marginBottom: 8, fontSize: 15 },
  statusRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  statusChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1.5,
    marginBottom: 4,
  },
  statusChipText: { fontSize: 12, fontWeight: '700' },
  muted: { color: colors.textDim, fontSize: 13 },
  box: {
    backgroundColor: colors.bgCard,
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  solutionBox: { borderColor: colors.success, backgroundColor: colors.bgCard },
  boxTitle: { fontWeight: '700', color: colors.text },
  boxDate: { fontSize: 11, color: colors.primary, marginBottom: 4 },
  boxBody: { color: colors.text, fontSize: 14, lineHeight: 20 },
  input: {
    minHeight: 100,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 12,
    backgroundColor: colors.bgCard,
    textAlignVertical: 'top',
    color: colors.text,
  },
  btn: {
    marginTop: 12,
    backgroundColor: colors.primary,
    padding: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  btnSecondary: {
    backgroundColor: colors.bgCardAlt,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  btnText: { color: colors.white, fontWeight: '700' },
  btnOutline: {
    borderWidth: 1.5,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  btnOutlineText: { fontWeight: '700', fontSize: 15 },

  fieldRow: { flexDirection: 'row', gap: 10, alignItems: 'stretch' },
  fieldBtn: {
    flex: 1, minHeight: 48, borderRadius: 12, borderWidth: 1.5, borderColor: colors.border,
    backgroundColor: colors.bgCardAlt, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8,
  },
  fieldBtnText: { color: colors.text, fontWeight: '800', fontSize: 14 },
  fieldQr: {
    width: 48, minHeight: 48, borderRadius: 12, borderWidth: 1.5, borderColor: colors.border,
    backgroundColor: colors.bgCardAlt, alignItems: 'center', justifyContent: 'center',
  },
  whChip: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, borderWidth: 1,
    borderColor: colors.border, backgroundColor: colors.chip, marginRight: 8,
  },
  selectBtn: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.bgCard, borderRadius: 14, borderWidth: 1.5, borderColor: colors.border,
    paddingVertical: 12, paddingHorizontal: 14,
  },
  selectCaption: { color: colors.textDim, fontSize: 10, fontWeight: '800', letterSpacing: 0.6 },
  selectValue: { color: colors.text, fontSize: 15, fontWeight: '700', marginTop: 2 },
  selectChevron: { color: colors.textMuted, fontSize: 12, marginLeft: 8 },
  metaLine: { color: colors.textMuted, fontSize: 12, marginTop: 6 },
  cardTitle: { color: colors.text, fontSize: 15, fontWeight: '700', marginTop: 10 },
  fab: {
    position: 'absolute', right: 18, bottom: 22, width: 56, height: 56, borderRadius: 28,
    backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', elevation: 6,
    shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 6, shadowOffset: { width: 0, height: 3 },
  },
  fabPlus: { color: colors.chipOnText, fontSize: 30, fontWeight: '400', marginTop: -2 },
  modalBackdrop: {
    flex: 1, backgroundColor: 'rgba(13,27,42,0.45)', justifyContent: 'center', alignItems: 'center', padding: 24,
  },
  modalCard: {
    width: '100%', maxWidth: 380, backgroundColor: colors.bgCard, borderRadius: 18,
    paddingTop: 16, paddingBottom: 12, paddingHorizontal: 14, borderWidth: 1, borderColor: colors.border,
  },
  modalTitle: { textAlign: 'center', color: colors.text, fontSize: 17, fontWeight: '800', marginBottom: 10 },
  modalRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 12, paddingHorizontal: 10, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  modalRowText: { color: colors.text, fontSize: 14, fontWeight: '600', flex: 1, marginRight: 8 },
  modalClose: { marginTop: 10, paddingVertical: 12, alignItems: 'center', borderRadius: 12, backgroundColor: colors.chip },
  modalCloseText: { color: colors.text, fontWeight: '700' },
  searchInput: {
    backgroundColor: colors.bg, borderRadius: 10, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: 12, paddingVertical: 10, color: colors.text, marginBottom: 8, fontSize: 14,
  },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  qtyBtn: {
    width: 36, height: 36, borderRadius: 10, backgroundColor: colors.chip,
    alignItems: 'center', justifyContent: 'center',
  },
  qtyBtnText: { fontSize: 18, fontWeight: '700', color: colors.text },
  qtyVal: { minWidth: 28, textAlign: 'center', fontWeight: '800', fontSize: 16, color: colors.text },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    marginTop: 12,
    paddingVertical: 4,
  },
  toggleLabel: { fontSize: 13, minWidth: 48, textAlign: 'center' },
  miniBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center' },
  miniBtnText: { color: colors.chipOnText, fontWeight: '700', fontSize: 12 },
  reportRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  reportBtn: { flex: 1, marginTop: 0 },
  pdfBtn: {
    marginTop: 20,
    backgroundColor: colors.accent,
    padding: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  pdfBtnText: { color: colors.chipOnText, fontWeight: '700' },
  linkBtn: { marginTop: 16, alignItems: 'center', padding: 10 },
  linkBtnText: { color: colors.accent, fontWeight: '600', fontSize: 13 },
});
}
