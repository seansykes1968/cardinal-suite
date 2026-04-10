import { useEffect, useRef, useState } from 'react';
import type { AppLifecycleStatus } from '../types/ipc';

/**
 * Tracks how long the last index scan took and returns a human-readable string.
 * Displayed in the StatusBar after a scan completes.
 * Example output: "Indexed 1,587,469 files in 4m 32s"
 */
export function useIndexTimer(
  lifecycleState: AppLifecycleStatus,
  scannedFiles: number,
): string | null {
  const startTimeRef = useRef<number | null>(null);
  const startFileCountRef = useRef<number>(0);
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    if (lifecycleState === 'Initializing' || lifecycleState === 'Updating') {
      startTimeRef.current = Date.now();
      startFileCountRef.current = scannedFiles;
    } else if (lifecycleState === 'Ready' && startTimeRef.current !== null) {
      const elapsed = Date.now() - startTimeRef.current;
      const filesIndexed = scannedFiles - startFileCountRef.current;
      startTimeRef.current = null;
      setLabel(formatIndexDuration(elapsed, filesIndexed));
    }
  }, [lifecycleState, scannedFiles]);

  return label;
}

function formatIndexDuration(ms: number, fileCount: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  let timeStr: string;
  if (hours > 0) {
    timeStr = `${hours}h ${minutes}m`;
  } else if (minutes > 0) {
    timeStr = `${minutes}m ${seconds}s`;
  } else {
    timeStr = `${seconds}s`;
  }

  return `Indexed ${fileCount.toLocaleString()} files in ${timeStr}`;
}
