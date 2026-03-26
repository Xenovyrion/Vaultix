import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { type Screen, type DatabaseMeta } from "./types";
import { useSettings } from "./hooks/useSettings";
import { addRecentDb } from "./utils/recentDbs";
import { initLogger, log } from "./utils/logger";
import SetupScreen from "./components/SetupScreen";
import UnlockScreen from "./components/UnlockScreen";
import SecuritySetupScreen from "./components/SecuritySetupScreen";
import Vault from "./components/Vault";

export default function App() {
  const [screen, setScreen] = useState<Screen>("setup");
  const [dbPath, setDbPath] = useState<string | null>(null);
  const [dbMeta, setDbMeta] = useState<DatabaseMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [showSecuritySetup, setShowSecuritySetup] = useState(false);
  const [creationPassword, setCreationPassword] = useState<string | null>(null);
  const { settings, updateSettings } = useSettings();

  const checkState = useCallback(async () => {
    try {
      const result = await invoke<{ db_path: string | null; is_unlocked: boolean }>("get_app_state");
      if (result.db_path) {
        setDbPath(result.db_path);
        if (result.is_unlocked) {
          const meta = await invoke<DatabaseMeta>("get_db_meta");
          setDbMeta(meta);
          setScreen("vault");
        } else {
          setScreen("unlock");
        }
      } else {
        setScreen("setup");
      }
    } catch {
      setScreen("setup");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { checkState(); }, [checkState]);

  // Called when user opens an existing DB (goes to unlock screen)
  const handleDatabaseOpened = useCallback((path: string) => {
    setDbPath(path);
    setScreen("unlock");
  }, []);

  // Called after creation: DB is already unlocked, skip unlock screen
  const handleCreatedAndUnlocked = useCallback(async (path: string, masterPassword: string) => {
    setDbPath(path);
    const meta = await invoke<DatabaseMeta>("get_db_meta");
    setDbMeta(meta);
    addRecentDb(path, meta.name);
    setCreationPassword(masterPassword);
    setShowSecuritySetup(true);
    setScreen("vault");
  }, []);

  // Called after normal unlock (existing DB)
  const handleUnlocked = useCallback(async () => {
    const meta = await invoke<DatabaseMeta>("get_db_meta");
    setDbMeta(meta);
    if (dbPath) addRecentDb(dbPath, meta.name);
    setScreen("vault");
  }, [dbPath]);

  const handleLock = useCallback(async () => {
    await invoke("lock_database");
    setScreen("unlock");
    setDbMeta(null);
  }, []);

  // Init / update debug logger whenever the debug settings change
  useEffect(() => {
    initLogger(settings.debugMode, settings.logPath);
  }, [settings.debugMode, settings.logPath]);

  // Sync system tray visibility whenever the setting changes
  useEffect(() => {
    log("App", `systemTrayEnabled changed → ${settings.systemTrayEnabled}`);
    invoke("set_tray_visible", { visible: settings.systemTrayEnabled }).catch(() => {});
  }, [settings.systemTrayEnabled]);

  // Listen for lock trigger from tray menu
  useEffect(() => {
    const unlisten = listen("tray-lock", () => { handleLock(); });
    return () => { unlisten.then(fn => fn()); };
  }, [handleLock]);

  // Listen for show trigger from tray click/double-click.
  // Window is minimized (not hidden) when sent to tray, so unminimize() is the
  // correct restore call. show() is also called as a safety net.
  useEffect(() => {
    const unlisten = listen("tray-show", async () => {
      log("App", "tray-show event received → unminimize + show + setFocus");
      const win = getCurrentWindow();
      try {
        await win.unminimize(); // restore from minimized state (close-to-tray behaviour)
        await win.show();       // safety net in case it was hidden for another reason
        await win.setFocus();
        log("App", "tray-show: window restored successfully");
      } catch (err) {
        log("App", `tray-show ERROR: ${err}`);
      }
    });
    return () => { unlisten.then(fn => fn()); };
  }, []);

  const handleCloseDatabase = useCallback(async () => {
    await invoke("close_database");
    setDbPath(null);
    setDbMeta(null);
    setScreen("setup");
  }, []);

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "var(--bg-primary)" }}>
        <div className="spinner" />
      </div>
    );
  }

  if (screen === "setup") {
    return (
      <SetupScreen
        onCreated={() => {}} // unused — creation now goes through onCreatedAndUnlocked
        onOpened={handleDatabaseOpened}
        onCreatedAndUnlocked={handleCreatedAndUnlocked}
        recentDbsCount={settings.recentDbsCount}
      />
    );
  }

  if (screen === "unlock") {
    return <UnlockScreen dbPath={dbPath!} onUnlocked={handleUnlocked} onClose={handleCloseDatabase} />;
  }

  if (showSecuritySetup && creationPassword !== null) {
    return (
      <SecuritySetupScreen
        masterPassword={creationPassword}
        onDone={() => { setShowSecuritySetup(false); setCreationPassword(null); }}
      />
    );
  }

  return (
    <Vault
      dbMeta={dbMeta!}
      dbPath={dbPath!}
      settings={settings}
      onSettingsChange={updateSettings}
      onLock={handleLock}
      onClose={handleCloseDatabase}
    />
  );
}
