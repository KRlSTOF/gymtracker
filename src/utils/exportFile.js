import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

/**
 * Export text through the native Android share sheet when packaged by
 * Capacitor, and retain a normal browser download for the web/PWA build.
 */
export async function exportTextFile({ data, filename, mimeType }) {
  if (Capacitor.isNativePlatform()) {
    const { uri } = await Filesystem.writeFile({
      path: filename,
      data,
      directory: Directory.Cache,
      encoding: Encoding.UTF8
    });

    await Share.share({
      title: filename,
      files: [uri],
      dialogTitle: `Export ${filename}`
    });
    return;
  }

  const blob = new Blob([data], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
