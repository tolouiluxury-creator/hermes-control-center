import type { Dict } from './index';

/** German — mirrors the strings the UI shipped with. */
export const de: Dict = {
  // Navigation
  'nav.dashboard': 'Dashboard',
  'nav.chats': 'Chats',
  'nav.agenten': 'Agenten',
  'nav.workflows': 'Workflows',
  'nav.aufgaben': 'Aufgaben',
  'nav.wissen': 'Wissen (RAG)',
  'nav.dokumente': 'Dokumente',
  'nav.skills': 'Skills',
  'nav.mcp': 'MCP Server',
  'nav.modelle': 'Modelle',
  'nav.browser': 'Browser Automation',
  'nav.dateien': 'Dateien',
  'nav.prompts': 'Prompt-Bibliothek',
  'nav.integrationen': 'API & Integrationen',
  'nav.analytics': 'Analytics',
  'nav.logs': 'Logs',
  'nav.einstellungen': 'Einstellungen',

  // Common actions and labels
  'common.save': 'Speichern',
  'common.saving': 'Speichere …',
  'common.cancel': 'Abbrechen',
  'common.delete': 'Löschen',
  'common.remove': 'Entfernen',
  'common.new': 'Neu',
  'common.edit': 'Bearbeiten',
  'common.enable': 'Aktivieren',
  'common.disable': 'Deaktivieren',
  'common.test': 'Testen',
  'common.activate': 'Aktivieren',
  'common.apply': 'Anwenden',
  'common.retry': 'Erneut versuchen',
  'common.search': 'Suchen',
  'common.running': 'Läuft …',
  'common.active': 'aktiv',
  'common.inactive': 'inaktiv',
  'common.enabled': 'aktiviert',
  'common.disabled': 'deaktiviert',
  'common.confirm': 'Bestätigen',
  'common.all': 'Alle',

  // Page descriptions
  'page.chats.desc':
    'Unterhalte dich direkt mit deinem Agenten — über das laufende Dashboard, ohne zusätzliche Server.',
  'page.agenten.desc':
    'Benannte Presets: ein Bündel aus Modell, Werkzeugsatz, Skills und Systemprompt, das du speicherst und anwendest. Sie liegen im Control Center, nicht in Hermes.',
  'page.workflows.desc':
    'Benannte, geordnete Abläufe aus Prompts und geplanten Jobs. Sie werden hier angelegt; das automatische Ausführen der Kette kommt mit dem Hermes-API-Server.',
  'page.aufgaben.desc':
    'Geplante Jobs, die dein Agent von selbst ausführt. Pausieren, Auslösen und Löschen greifen in den laufenden Betrieb ein.',
  'page.wissen.desc':
    'Was dein Agent behält: die eingebauten Notizdateien und die verfügbaren Speicher-Anbieter für Langzeitgedächtnis und Retrieval.',
  'page.skills.desc':
    'Fähigkeiten, die dein Agent nutzen kann. Die Nutzungszahl zeigt, was davon tatsächlich zum Einsatz kommt.',
  'page.mcp.desc':
    'Über das Model Context Protocol angebundene Werkzeugserver. Jeder Server bringt deinem Agenten zusätzliche Werkzeuge bei.',
  'page.modelle.desc':
    'Anbieter, die dein Hermes kennt, und das Modell, mit dem er gerade arbeitet.',
  'page.prompts.desc':
    'Deine eigenen Vorlagen. Sie liegen im Control Center, nicht in Hermes — Hermes hat keine Prompt-Bibliothek.',
  'page.integrationen.desc':
    'Wie dein Agent die Außenwelt erreicht: Messaging-Plattformen, eingehende Webhooks und die dafür freigegebenen Nutzer.',
  'page.einstellungen.desc': 'Konfiguration, Schlüssel, Werkzeuge und Wartung deines Hermes.',

  // Chat
  'chat.newConversation': 'Neue Unterhaltung',
  'chat.noConversations': 'Noch keine Unterhaltungen.',
  'chat.emptyTitle': 'Neue Unterhaltung',
  'chat.emptyHint': 'Schreib unten eine Nachricht, um loszulegen.',
  'chat.placeholder': 'Nachricht an den Agenten … (Enter sendet)',
  'chat.connecting': 'Verbinde …',
  'chat.send': 'Senden',
  'chat.messages': 'Nachr.',
  'chat.conversation': 'Unterhaltung',
  'chat.overDashboard':
    'Der Chat läuft über das Hermes-Dashboard. Prüfe, dass das Dashboard erreichbar ist.',
  'chat.sendFailed': 'Senden fehlgeschlagen',
  'chat.openFailed': 'Öffnen fehlgeschlagen',
  'chat.connectFailed': 'Verbindung fehlgeschlagen',

  // Settings
  'settings.appearance': 'Erscheinungsbild',
  'settings.appearance.desc': 'Gilt nur für dieses Gerät.',
  'settings.language': 'Sprache',
  'settings.language.desc': 'Die Sprache der Oberfläche, für dieses Gerät.',
  'settings.theme.dark': 'Dunkel',
  'settings.theme.light': 'Hell',
  'settings.theme.system': 'System',
  'settings.tools': 'Werkzeuge',
  'settings.tools.desc': 'Werkzeugsätze, die deinem Agenten zur Verfügung stehen.',
  'settings.tools.unavailable': 'nicht verfügbar',
  'settings.maintenance': 'Wartung',
  'settings.maintenance.desc': 'Version und die Pflege des Langzeitgedächtnisses.',
  'settings.version': 'Version',
  'settings.updateAvailable': 'Update verfügbar — auf dem Server: {command}',
  'settings.curator': 'Gedächtnis-Kurator',
  'settings.curator.paused': 'pausiert',
  'settings.curator.off': 'aus',
  'settings.curator.runNow': 'Jetzt ausführen',
  'settings.curator.resume': 'Fortsetzen',
  'settings.curator.pause': 'Pausieren',
  'settings.curator.lastRun': 'zuletzt {time}',
  'settings.env': 'Umgebung & Schlüssel',
  'settings.env.desc':
    'API-Schlüssel und Umgebungsvariablen deines Hermes. Werte werden nie im Klartext angezeigt.',
  'settings.env.set': 'Setzen',
  'settings.env.change': 'Ändern',
  'settings.env.count': '{count} Variablen',
  'settings.env.none': 'Keine Variable passt zu dieser Auswahl.',
  'settings.env.valueFor': 'Wert für {key}',
  'settings.env.removeConfirm': '{key} entfernen? Der Wert geht verloren.',
  'settings.env.scope.set': 'Gesetzt',
  'settings.env.limited': 'Nur die ersten 100 werden gezeigt — suche, um weitere zu finden.',
  'settings.config': 'Rohkonfiguration (YAML)',
  'settings.config.desc':
    'Die vollständige Hermes-Konfiguration. Fehler hier können den Agenten stören — mit Bedacht bearbeiten.',
  'settings.config.empty': '(leer)',
  'settings.config.overwriteConfirm':
    'Konfiguration überschreiben? Ungültiges YAML kann den Agenten beeinträchtigen.',
  'settings.security': 'Sicherheit',
  'settings.security.desc': 'Zugang zum Control Center selbst.',
  'settings.security.password':
    'Das Passwort für das Control Center wird auf dem Server gesetzt: {command}. Solange keins gesetzt ist, bindet der Server nur an localhost.',
};
