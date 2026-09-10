import { NativeModules } from 'react-native';

const { SharedSMSStore } = NativeModules;

const noopModule = {
  readNewMessages: async () => [],
  peekMessages: async () => [],
  writeTestValue: async () => 'not_supported',
  getExtensionLastRun: async () => 'never',
  getIngestStats: async () => ({
    shortcutLastRun: 'never',
    extensionLastRun: 'never',
    pendingFromShortcut: 0,
    pendingFromExtension: 0,
    inboxPath: 'unavailable',
    inboxExists: false,
  }),
};

export default SharedSMSStore || noopModule;

