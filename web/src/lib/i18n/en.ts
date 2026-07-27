import type { Dict } from './index';

/** English — the source language and the fallback for any missing key. */
export const en: Dict = {
  // Navigation
  'nav.dashboard': 'Dashboard',
  'nav.chats': 'Chats',
  'nav.agenten': 'Agents',
  'nav.workflows': 'Workflows',
  'nav.aufgaben': 'Tasks',
  'nav.wissen': 'Knowledge (RAG)',
  'nav.dokumente': 'Documents',
  'nav.skills': 'Skills',
  'nav.mcp': 'MCP Servers',
  'nav.modelle': 'Models',
  'nav.browser': 'Browser Automation',
  'nav.dateien': 'Files',
  'nav.prompts': 'Prompt Library',
  'nav.integrationen': 'API & Integrations',
  'nav.analytics': 'Analytics',
  'nav.logs': 'Logs',
  'nav.einstellungen': 'Settings',

  // Common actions and labels
  'common.save': 'Save',
  'common.saving': 'Saving …',
  'common.cancel': 'Cancel',
  'common.delete': 'Delete',
  'common.remove': 'Remove',
  'common.new': 'New',
  'common.edit': 'Edit',
  'common.enable': 'Enable',
  'common.disable': 'Disable',
  'common.test': 'Test',
  'common.activate': 'Activate',
  'common.apply': 'Apply',
  'common.retry': 'Try again',
  'common.search': 'Search',
  'common.running': 'Running …',
  'common.active': 'active',
  'common.inactive': 'inactive',
  'common.enabled': 'enabled',
  'common.disabled': 'disabled',
  'common.confirm': 'Confirm',
  'common.all': 'All',

  // Page descriptions
  'page.chats.desc': 'Talk to your agent directly — over the running dashboard, no extra server.',
  'page.agenten.desc':
    'Named presets: a bundle of model, toolset, skills and system prompt that you save and apply. They live in the control center, not in Hermes.',
  'page.workflows.desc':
    'Named, ordered sequences of prompts and scheduled jobs. Created here; automatic execution of the chain arrives with the Hermes API server.',
  'page.aufgaben.desc':
    'Scheduled jobs your agent runs on its own. Pausing, triggering and deleting affect live operation.',
  'page.wissen.desc':
    'What your agent remembers: the built-in note files and the available memory providers for long-term memory and retrieval.',
  'page.skills.desc':
    'Abilities your agent can use. The usage count shows what actually gets used.',
  'page.mcp.desc':
    'Tool servers connected over the Model Context Protocol. Each one teaches your agent new tools.',
  'page.modelle.desc':
    'The providers your Hermes knows, and the model it is working with right now.',
  'page.prompts.desc':
    'Your own templates. They live in the control center, not in Hermes — Hermes has no prompt library.',
  'page.integrationen.desc':
    'How your agent reaches the outside world: messaging platforms, incoming webhooks and the users cleared for them.',
  'page.einstellungen.desc': 'Configuration, keys, tools and maintenance of your Hermes.',

  // Chat
  'chat.newConversation': 'New conversation',
  'chat.noConversations': 'No conversations yet.',
  'chat.emptyTitle': 'New conversation',
  'chat.emptyHint': 'Write a message below to get started.',
  'chat.placeholder': 'Message the agent … (Enter sends)',
  'chat.connecting': 'Connecting …',
  'chat.send': 'Send',
  'chat.messages': 'msgs',
  'chat.conversation': 'Conversation',
  'chat.overDashboard':
    'Chat runs over the Hermes dashboard. Check that the dashboard is reachable.',
  'chat.sendFailed': 'Sending failed',
  'chat.openFailed': 'Failed to open',
  'chat.connectFailed': 'Connection failed',

  // Settings
  'settings.appearance': 'Appearance',
  'settings.appearance.desc': 'Applies to this device only.',
  'settings.language': 'Language',
  'settings.language.desc': 'The interface language, for this device.',
  'settings.theme.dark': 'Dark',
  'settings.theme.light': 'Light',
  'settings.theme.system': 'System',
  'settings.tools': 'Tools',
  'settings.tools.desc': 'The toolsets available to your agent.',
  'settings.tools.unavailable': 'unavailable',
  'settings.maintenance': 'Maintenance',
  'settings.maintenance.desc': 'Version and the upkeep of long-term memory.',
  'settings.version': 'Version',
  'settings.updateAvailable': 'Update available — on the server: {command}',
  'settings.curator': 'Memory curator',
  'settings.curator.paused': 'paused',
  'settings.curator.off': 'off',
  'settings.curator.runNow': 'Run now',
  'settings.curator.resume': 'Resume',
  'settings.curator.pause': 'Pause',
  'settings.curator.lastRun': 'last run {time}',
  'settings.env': 'Environment & keys',
  'settings.env.desc':
    'API keys and environment variables of your Hermes. Values are never shown in clear text.',
  'settings.env.set': 'Set',
  'settings.env.change': 'Change',
  'settings.env.count': '{count} variables',
  'settings.env.none': 'No variable matches this selection.',
  'settings.env.valueFor': 'Value for {key}',
  'settings.env.removeConfirm': 'Remove {key}? The value is lost.',
  'settings.env.scope.set': 'Set',
  'settings.env.limited': 'Only the first 100 are shown — search to find more.',
  'settings.config': 'Raw configuration (YAML)',
  'settings.config.desc':
    'The full Hermes configuration. Mistakes here can disturb the agent — edit with care.',
  'settings.config.empty': '(empty)',
  'settings.config.overwriteConfirm':
    'Overwrite the configuration? Invalid YAML can affect the agent.',
  'settings.security': 'Security',
  'settings.security.desc': 'Access to the control center itself.',
  'settings.security.password':
    'The control center password is set on the server: {command}. Until one is set, the server only binds to localhost.',
};
