declare module '@env' {
  export const SERVER_URL: string | undefined;
}

declare module 'shared-sms-store' {
  export interface IngestStats {
    shortcutLastRun: string;
    extensionLastRun: string;
    pendingFromShortcut: number;
    pendingFromExtension: number;
    inboxPath: string;
    inboxExists: boolean;
  }

  export interface SharedSMSMessage {
    id: string;
    sender: string;
    body: string;
    receivedAt: string;
    source?: 'shortcut' | 'filter' | 'manual';
  }

  export interface SharedSMSStoreModule {
    readNewMessages(): Promise<SharedSMSMessage[]>;
    peekMessages(): Promise<SharedSMSMessage[]>;
    writeTestValue(): Promise<string>;
    getExtensionLastRun(): Promise<string>;
    getIngestStats(): Promise<IngestStats>;
  }

  const SharedSMSStore: SharedSMSStoreModule;
  export default SharedSMSStore;
}

