import { getPrefs, QUALITY_VALUE } from './preferences';
import { tr } from './i18n';

export type PickedFile = { uri: string; name: string; mimeType?: string };

const extFromMime = (m?: string) =>
  m === 'image/png' ? 'png' : m === 'image/webp' ? 'webp' : m === 'image/heic' ? 'heic' : m === 'application/pdf' ? 'pdf' : 'jpg';

const withExt = (name: string | null | undefined, mime?: string) => {
  const n = (name || `photo_${Date.now()}`).trim();
  return /\.[A-Za-z0-9]{2,5}$/.test(n) ? n : `${n}.${extFromMime(mime)}`;
};

type PickerAsset = { uri: string; fileName?: string | null; mimeType?: string | null };

const fromAssets = (assets: PickerAsset[]): PickedFile[] =>
  assets.map((a) => ({
    uri: a.uri,
    name: withExt(a.fileName, a.mimeType || 'image/jpeg'),
    mimeType: a.mimeType || 'image/jpeg',
  }));

export async function pickFromCamera(): Promise<PickedFile[]> {
  const ImagePicker = await import('expo-image-picker');
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) throw new Error(tr('Allow camera access to take a photo.'));
  const res = await ImagePicker.launchCameraAsync({ quality: QUALITY_VALUE[getPrefs().uploadQuality], exif: false });
  return res.canceled || !res.assets?.length ? [] : fromAssets(res.assets);
}

export async function pickFromGallery(): Promise<PickedFile[]> {
  const ImagePicker = await import('expo-image-picker');
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) throw new Error(tr('Allow photo library access to attach images.'));
  const mediaTypes = (ImagePicker as { MediaTypeOptions?: { Images: unknown } }).MediaTypeOptions?.Images ?? ['images'];
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: mediaTypes as never,
    quality: QUALITY_VALUE[getPrefs().uploadQuality],
    allowsMultipleSelection: true,
    selectionLimit: 5,
    exif: false,
  });
  return res.canceled || !res.assets?.length ? [] : fromAssets(res.assets);
}

export async function pickFromFiles(): Promise<PickedFile[]> {
  const DocumentPicker = await import('expo-document-picker');
  const res = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: true });
  if (res.canceled || !res.assets?.length) return [];
  return res.assets.map((a) => ({ uri: a.uri, name: withExt(a.name, a.mimeType), mimeType: a.mimeType || undefined }));
}

/** Upload files two at a time (faster than one by one, gentler than all at once on a phone connection). */
export async function uploadAll(
  upload: (f: PickedFile) => Promise<unknown>,
  files: PickedFile[],
  onProgress?: (done: number, total: number) => void
): Promise<{ ok: number; errors: string[] }> {
  let next = 0;
  let done = 0;
  const errors: string[] = [];
  const worker = async () => {
    while (next < files.length) {
      const f = files[next++];
      try {
        await upload(f);
      } catch (e) {
        errors.push(`${f.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
      done += 1;
      onProgress?.(done, files.length);
    }
  };
  await Promise.all([worker(), worker()]);
  return { ok: files.length - errors.length, errors };
}
