import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getWatchRootValidation, isPathInputValid } from '../utils/watchRoot';
import ThemeSwitcher from './ThemeSwitcher';
import LanguageSwitcher from './LanguageSwitcher';

type PreferencesOverlayProps = {
  open: boolean;
  onClose: () => void;
  sortThreshold: number;
  defaultSortThreshold: number;
  onSortThresholdChange: (value: number) => void;
  trayIconEnabled: boolean;
  onTrayIconEnabledChange: (enabled: boolean) => void;
  watchRoot: string;
  defaultWatchRoot: string;
  onWatchConfigChange: (next: { watchRoot: string; ignorePaths: string[] }) => void;
  ignorePaths: string[];
  defaultIgnorePaths: string[];
  onReset: () => void;
  themeResetToken: number;
};

export function PreferencesOverlay({
  open,
  onClose,
  sortThreshold,
  defaultSortThreshold,
  onSortThresholdChange,
  trayIconEnabled,
  onTrayIconEnabledChange,
  watchRoot,
  defaultWatchRoot,
  onWatchConfigChange,
  ignorePaths,
  defaultIgnorePaths,
  onReset,
  themeResetToken,
}: PreferencesOverlayProps): React.JSX.Element | null {
  const { t } = useTranslation();
  const [thresholdInput, setThresholdInput] = useState<string>(() => sortThreshold.toString());
  const [watchRootInput, setWatchRootInput] = useState<string>(() => watchRoot);

  // ---------------------------------------------------------------------------
  // Include / exclude mode
  // ---------------------------------------------------------------------------
  // "exclude" (original behaviour) — list folders to ignore.
  // "include" — list only the folders you want to search; everything else is
  //             automatically excluded.
  type FolderMode = 'exclude' | 'include';
  const [folderMode, setFolderMode] = useState<FolderMode>('exclude');
  const [ignorePathsInput, setIgnorePathsInput] = useState<string>(() => ignorePaths.join('\n'));
  const [includePathsInput, setIncludePathsInput] = useState<string>('');

  // ---------------------------------------------------------------------------
  // Bug fix: prevent the overlay from closing when the user drags the textarea
  // resize handle outside the card boundary.
  //
  // Root cause: macOS triggers a click event on the overlay element when a
  // mousedown starts inside the card and the mouseup lands on the overlay
  // background (which happens naturally when dragging a resize handle to the
  // edge of the window). The original code closed the dialog on any click
  // whose target was the overlay element — including these drag-release clicks.
  //
  // Fix: record where the mousedown occurred. Only close if BOTH the mousedown
  // AND the subsequent click happened directly on the overlay backdrop.
  // ---------------------------------------------------------------------------
  const mouseDownTargetRef = useRef<EventTarget | null>(null);

  const handleOverlayMouseDown = (event: React.MouseEvent<HTMLDivElement>): void => {
    mouseDownTargetRef.current = event.target;
  };

  const handleOverlayClick = (event: React.MouseEvent<HTMLDivElement>): void => {
    if (
      event.target === event.currentTarget &&
      mouseDownTargetRef.current === event.currentTarget
    ) {
      onClose();
    }
  };

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose();
        event.preventDefault();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    setThresholdInput(sortThreshold.toString());
  }, [open, sortThreshold]);

  useEffect(() => {
    if (!open) return;
    setWatchRootInput(watchRoot);
    setIgnorePathsInput(ignorePaths.join('\n'));
  }, [open, watchRoot, ignorePaths]);

  const commitThreshold = useCallback(() => {
    const numericText = thresholdInput.replace(/[^\d]/g, '');
    if (!numericText) {
      setThresholdInput(sortThreshold.toString());
      return;
    }
    const parsed = Number.parseInt(numericText, 10);
    if (Number.isNaN(parsed)) {
      setThresholdInput(sortThreshold.toString());
      return;
    }
    const normalized = Math.max(1, Math.round(parsed));
    onSortThresholdChange(normalized);
    setThresholdInput(normalized.toString());
  }, [onSortThresholdChange, sortThreshold, thresholdInput]);

  const handleThresholdChange = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const value = event.target.value;
    if (/^\d*$/.test(value)) {
      setThresholdInput(value);
    }
  };

  const { errorKey: watchRootErrorKey } = getWatchRootValidation(watchRootInput);
  const watchRootErrorMessage = watchRootErrorKey ? t(watchRootErrorKey) : null;

  const handleWatchRootKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Escape') setWatchRootInput(watchRoot);
  };

  // Paths parsed from whichever textarea is active in the current mode.
  const parsedIgnorePaths = ignorePathsInput
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const parsedIncludePaths = includePathsInput
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const ignorePathsErrorMessage = (() => {
    const lines = folderMode === 'exclude' ? parsedIgnorePaths : parsedIncludePaths;
    const invalid = lines.find((line) => !isPathInputValid(line));
    return invalid ? t('ignorePaths.errors.absolute') : null;
  })();

  const handleIgnorePathsKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Escape') setIgnorePathsInput(ignorePaths.join('\n'));
  };

  const handleIncludePathsKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Escape') setIncludePathsInput('');
  };

  // ---------------------------------------------------------------------------
  // When saving in "include" mode we need to know every top-level folder under
  // watchRoot so we can exclude the ones the user did NOT list.
  //
  // We use Tauri's `readDir` to list immediate children of watchRoot, then
  // subtract the include list to produce the ignore list.
  // ---------------------------------------------------------------------------
  const computeIgnorePathsFromIncludes = useCallback(async (): Promise<string[]> => {
    try {
      // Tauri v2 path: invoke the readDir command exposed by the shell.
      const { readDir } = await import('@tauri-apps/plugin-fs');
      const entries = await readDir(watchRootInput.trim());
      const allTopLevel = entries
        .filter((e) => e.isDirectory)
        .map((e) => `${watchRootInput.trim()}/${e.name}`);

      const normalised = parsedIncludePaths.map((p) => p.replace(/\/$/, ''));
      return allTopLevel.filter((dir) => !normalised.includes(dir.replace(/\/$/, '')));
    } catch {
      // If the readDir fails (permissions, non-existent path, older Tauri API)
      // fall back to an empty ignore list — safer than crashing.
      return [];
    }
  }, [watchRootInput, parsedIncludePaths]);

  const handleSave = useCallback(async (): Promise<void> => {
    if (watchRootErrorMessage || ignorePathsErrorMessage) return;
    commitThreshold();

    const trimmedWatchRoot = watchRootInput.trim();
    let finalIgnorePaths: string[];

    if (folderMode === 'include') {
      finalIgnorePaths = await computeIgnorePathsFromIncludes();
    } else {
      finalIgnorePaths = parsedIgnorePaths;
    }

    onWatchConfigChange({ watchRoot: trimmedWatchRoot, ignorePaths: finalIgnorePaths });
    setWatchRootInput(trimmedWatchRoot);
    setIgnorePathsInput(finalIgnorePaths.join('\n'));
    onClose();
  }, [
    watchRootErrorMessage,
    ignorePathsErrorMessage,
    commitThreshold,
    watchRootInput,
    folderMode,
    computeIgnorePathsFromIncludes,
    parsedIgnorePaths,
    onWatchConfigChange,
    onClose,
  ]);

  const handleReset = (): void => {
    setThresholdInput(defaultSortThreshold.toString());
    setWatchRootInput(defaultWatchRoot);
    setIgnorePathsInput(defaultIgnorePaths.join('\n'));
    setIncludePathsInput('');
    setFolderMode('exclude');
    onReset();
  };

  if (!open) return null;

  return (
    <div
      className="preferences-overlay"
      role="dialog"
      aria-modal="true"
      onMouseDown={handleOverlayMouseDown}
      onClick={handleOverlayClick}
    >
      <div className="preferences-card">
        <header className="preferences-card__header">
          <h1 className="preferences-card__title">{t('preferences.title')}</h1>
        </header>

        <div className="preferences-section">
          {/* Appearance */}
          <div className="preferences-row">
            <p className="preferences-label">{t('preferences.appearance')}</p>
            <ThemeSwitcher className="preferences-control" resetToken={themeResetToken} />
          </div>

          {/* Language */}
          <div className="preferences-row">
            <p className="preferences-label">{t('preferences.language')}</p>
            <LanguageSwitcher className="preferences-control" />
          </div>

          {/* Tray icon */}
          <div className="preferences-row">
            <p className="preferences-label">{t('preferences.trayIcon.label')}</p>
            <div className="preferences-control">
              <label className="preferences-switch">
                <input
                  className="preferences-switch__input"
                  type="checkbox"
                  checked={trayIconEnabled}
                  onChange={(event) => onTrayIconEnabledChange(event.target.checked)}
                  aria-label={t('preferences.trayIcon.label')}
                />
                <span className="preferences-switch__track" aria-hidden="true" />
              </label>
            </div>
          </div>

          {/* Sorting limit */}
          <div className="preferences-row">
            <div className="preferences-row__details">
              <p className="preferences-label">{t('preferences.sortingLimit.label')}</p>
            </div>
            <div className="preferences-control">
              <input
                className="preferences-field preferences-number-input"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={thresholdInput}
                onChange={handleThresholdChange}
                aria-label={t('preferences.sortingLimit.label')}
              />
            </div>
          </div>

          {/* Watch root */}
          <div className="preferences-row">
            <div className="preferences-row__details">
              <p className="preferences-label" title={t('watchRoot.help')}>
                {t('watchRoot.label')}
              </p>
            </div>
            <div className="preferences-control">
              <input
                className="preferences-field preferences-number-input preferences-watch-root-input"
                type="text"
                value={watchRootInput}
                onChange={(event) => setWatchRootInput(event.target.value)}
                onKeyDown={handleWatchRootKeyDown}
                aria-label={t('watchRoot.label')}
                autoComplete="off"
                spellCheck={false}
              />
              {watchRootErrorMessage ? (
                <p
                  className="permission-status permission-status--error preferences-field-error"
                  role="status"
                  aria-live="polite"
                >
                  {watchRootErrorMessage}
                </p>
              ) : null}
            </div>
          </div>

          {/* Folder mode toggle */}
          <div className="preferences-row">
            <div className="preferences-row__details">
              <p className="preferences-label">Folder mode</p>
            </div>
            <div className="preferences-control preferences-folder-mode">
              <label className="preferences-folder-mode__option">
                <input
                  type="radio"
                  name="folderMode"
                  value="include"
                  checked={folderMode === 'include'}
                  onChange={() => setFolderMode('include')}
                />
                <span>Search only these folders</span>
              </label>
              <label className="preferences-folder-mode__option">
                <input
                  type="radio"
                  name="folderMode"
                  value="exclude"
                  checked={folderMode === 'exclude'}
                  onChange={() => setFolderMode('exclude')}
                />
                <span>Exclude these folders</span>
              </label>
            </div>
          </div>

          {/* Folder paths textarea — changes label based on mode */}
          <div className="preferences-row">
            <div className="preferences-row__details">
              <p className="preferences-label">
                {folderMode === 'include' ? 'Search folders' : t('ignorePaths.label')}
              </p>
              <p className="preferences-label-hint">
                {folderMode === 'include'
                  ? 'One folder per line. Only these folders will be indexed.'
                  : 'One folder per line. These folders will be skipped.'}
              </p>
            </div>
            <div className="preferences-control">
              {folderMode === 'exclude' ? (
                <textarea
                  className="preferences-field preferences-textarea"
                  value={ignorePathsInput}
                  onChange={(event) => setIgnorePathsInput(event.target.value)}
                  onKeyDown={handleIgnorePathsKeyDown}
                  aria-label={t('ignorePaths.label')}
                  autoComplete="off"
                  spellCheck={false}
                />
              ) : (
                <textarea
                  className="preferences-field preferences-textarea"
                  value={includePathsInput}
                  onChange={(event) => setIncludePathsInput(event.target.value)}
                  onKeyDown={handleIncludePathsKeyDown}
                  aria-label="Search folders"
                  placeholder={`${watchRootInput}/01_Images\n${watchRootInput}/02_Design`}
                  autoComplete="off"
                  spellCheck={false}
                />
              )}
              {ignorePathsErrorMessage ? (
                <p
                  className="permission-status permission-status--error preferences-field-error"
                  role="status"
                  aria-live="polite"
                >
                  {ignorePathsErrorMessage}
                </p>
              ) : null}
            </div>
          </div>
        </div>

        <footer className="preferences-card__footer">
          <button
            className="preferences-save"
            type="button"
            onClick={() => void handleSave()}
            disabled={Boolean(watchRootErrorMessage || ignorePathsErrorMessage)}
          >
            {t('preferences.save')}
          </button>
          <button className="preferences-reset" type="button" onClick={handleReset}>
            {t('preferences.reset')}
          </button>
        </footer>
      </div>
    </div>
  );
}

export default PreferencesOverlay;
