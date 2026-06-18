// Shared domain types for ChatGPT Sync.
//
// These describe the data that flows between the runtime surfaces (content
// script → background → popup/offline reader) and the two persisted shapes:
// the in-memory "package" produced by a scan and the offline archive that
// accumulates packages over time. Fields are intentionally optional/loose where
// the data originates from untrusted page scraping or evolving ChatGPT APIs.

/** A ChatGPT account, keyed by a stable identity (email when available). */
export interface Account {
  key: string;
  label: string;
  email?: string;
  name?: string;
}

/** A project link discovered in the sidebar or detected on the current page. */
export interface ProjectScan {
  title?: string;
  url?: string | null;
  instructions?: string;
  current?: boolean;
}

/** A chat link discovered while scanning a page. */
export interface ChatScan {
  title?: string;
  url?: string | null;
  conversationId?: string;
}

/** A single rendered/parsed conversation message. */
export interface MessageScan {
  id?: string;
  role?: string;
  text?: string;
  createTime?: number | null;
}

/** A file/attachment record. Never contains credentials or signed URLs. */
export interface FileScan {
  id?: string;
  name?: string;
  mimeType?: string | null;
  sizeBytes?: number | null;
  width?: number | null;
  height?: number | null;
  conversationId?: string;
  sourceDownloadPath?: string;
  previewStatus?: string;
  dataUrl?: string;
  [extra: string]: unknown;
}

/** Raw result of scanning a ChatGPT page (DOM + same-session API). */
export interface ScanData {
  url?: string | null;
  capturedAt?: string;
  account?: Account;
  project?: ProjectScan;
  projects?: ProjectScan[];
  chats?: ChatScan[];
  messages?: MessageScan[];
  files?: FileScan[];
  captureMethod?: string;
  backendConversationId?: string | null;
  backendProjectId?: string | null;
  backendApiError?: string | null;
  error?: string;
}

/** One step of the assisted-restore checklist. */
export interface RestoreStep {
  id: string;
  label: string;
  done: boolean;
}

/** A portable, restorable capture of a project — the "memory bridge" package. */
export interface MemoryPackage {
  schemaVersion: string;
  app: string;
  mode: string;
  createdAt: string;
  source: {
    platform: string;
    url: string | null;
    account: Account;
  };
  project: {
    title: string;
    instructions: string;
    notes: string;
    detectedFromPage: boolean;
  };
  projects: ProjectScan[];
  chats: ChatScan[];
  messages: MessageScan[];
  files: FileScan[];
  capture: {
    method: string;
    backendConversationId: string | null;
    backendProjectId: string | null;
    backendApiError: string | null;
  };
  restore: {
    steps: RestoreStep[];
  };
}

/** A stored account row in the offline archive. */
export interface AccountRecord extends Account {
  updatedAt?: string;
}

/** A stored project row in the offline archive. */
export interface ProjectRecord {
  key: string;
  title: string;
  instructions?: string;
  notes?: string;
  accountKey?: string;
  accountLabel?: string;
  sourceUrl?: string | null;
  updatedAt?: string;
}

/** A stored chat row in the offline archive. */
export interface ChatRecord {
  key: string;
  url?: string | null;
  title?: string;
  projectKey?: string;
  accountKey?: string;
  accountLabel?: string;
  updatedAt?: string;
}

/** A stored message row in the offline archive. */
export interface MessageRecord {
  id: string;
  chatUrl?: string | null;
  chatKey?: string;
  projectKey?: string;
  accountKey?: string;
  accountLabel?: string;
  role: string;
  text: string;
  capturedAt?: string;
}

/** A stored file row in the offline archive. */
export interface FileRecord extends FileScan {
  key: string;
  projectKey?: string;
  accountKey?: string;
  accountLabel?: string;
  chatUrl?: string | null;
  chatKey?: string;
  capturedAt?: string;
}

/** Everything cached for offline reading, merged across many scans. */
export interface OfflineArchive {
  schemaVersion: string;
  app: string;
  mode: string;
  createdAt: string;
  lastSyncedAt: string | null;
  projects: ProjectRecord[];
  accounts: AccountRecord[];
  chats: ChatRecord[];
  messages: MessageRecord[];
  files: FileRecord[];
}

/** Counts surfaced in the popup/offline-reader headers. */
export interface ArchiveSummary {
  projects: number;
  accounts: number;
  chats: number;
  messages: number;
  files: number;
  lastSyncedAt: string | null;
}

/** A page the gentle/deep sync planner intends to open and scan. */
export interface SyncTarget {
  kind: "project" | "chat";
  title: string;
  url: string;
  waitMs: number;
}

/** One human-readable entry in the gentle-sync activity log. */
export interface GentleSyncEvent {
  label: string;
  detail: string;
  at: string;
}

/** Persisted state of the gentle background-sync job. */
export interface GentleSyncState {
  active: boolean;
  status: string;
  queue: SyncTarget[];
  totalTargets: number;
  seenUrls: string[];
  synced: number;
  opened: number;
  messages: number;
  rateLimitHits: number;
  currentTarget: SyncTarget | null;
  nextRunAt: string | null;
  lastError: string | null;
  startedAt: string;
  updatedAt: string;
  events: GentleSyncEvent[];
  completedAt?: string;
}

/** Result returned by the content script when asked about login state. */
export interface LoginState {
  loggedIn: boolean | null;
  via: string;
  account: Account | null;
  url?: string;
  detail?: string;
}

/** Options accepted by package/archive builders. */
export interface BuildOptions {
  now?: string;
  notes?: string;
}
