import { useEffect, useRef, useState } from 'react';

type LifecycleState = 'initializing' | 'updating' | 'ready';

/**
 * Tracks how long the last index scan took and returns a human-readable string.
 *
 * Usage in StatusBar:
 *
 *   const indexDurationLabel = useIndexTimer(lifecycleState, scannedFiles);
 *
 * Then render it somewhere in the status bar, e.g.:
 *
 *   {indexDurationLabel && (
 *     <span className="status-bar__index-time">{indexDurationLabel}</span>
 *   )}
 */
export function useIndexTimer(
  lifecycleState: LifecycleState,
  scannedFiles: number,
): string | null {
  const startTimeRef = useRef<number | null>(null);
  const startFileCountRef = useRef<number>(0);
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    if (lifecycleState === 'initializing' || lifecycleState === 'updating') {
      // Scan started — record the start time and file count.
      startTimeRef.current = Date.now();
      startFileCountRef.current = scannedFiles;
    } else if (lifecycleState === 'ready' && startTimeRef.current !== null) {
      // Scan finished — calculate elapsed time and files indexed.
      const elapsed = Date.now() - startTimeRef.current;
      const filesIndexed = scannedFiles - startFileCountRef.current;
      startTimeRef.current = null;
      setLabel(formatIndexDuration(elapsed, filesIndexed));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lifecycleState]);

  return label;
}

/**
 * Formats elapsed milliseconds and file count into a readable label.
 *
 * Examples:
 *   formatIndexDuration(4320000, 1587469) → "Indexed 1,587,469 files in 1h 12m"
 *   formatIndexDuration(94000, 45000)     → "Indexed 45,000 files in 1m 34s"
 *   formatIndexDuration(8200, 1200)       → "Indexed 1,200 files in 8s"
 */
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

  const formattedCount = fileCount.toLocaleString();
  return `Indexed ${formattedCount} files in ${timeStr}`;
}
