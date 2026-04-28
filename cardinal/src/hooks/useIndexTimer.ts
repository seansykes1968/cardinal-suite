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
    if (lifecycleState === 'Initializing') {
      // New index cycle starting — begin timing from here.
      startTimeRef.current = Date.now();
      startFileCountRef.current = scannedFiles;
    } else if (lifecycleState === 'Updating') {
      // Safety net: if the first event we receive is Updating (no prior Initializing).
      // Do NOT reset if the timer is already running — scannedFiles fires repeatedly
      // during indexing and resetting here would collapse the elapsed time to ~0ms.
      if (startTimeRef.current === null) {
        startTimeRef.current = Date.now();
        startFileCountRef.current = scannedFiles;
      }
    } else if (lifecycleState === 'Ready' && startTimeRef.current !== null) {
      const elapsed = Date.now() - startTimeRef.current;
      const filesIndexed = scannedFiles - startFileCountRef.current;
      startTimeRef.current = null;
      // Sub-second completions are cache loads — showing "0s" is misleading,
      // so we leave the previous label (or null) unchanged.
      if (elapsed >= 1000) {
        // Fall back to total count when the delta is 0 (e.g. cache hits where
        // the full count was emitted before Updating fired).
        const displayCount = filesIndexed <= 0 ? scannedFiles : filesIndexed;
        setLabel(formatIndexDuration(elapsed, displayCount));
      }
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
