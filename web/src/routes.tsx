import { Route, Routes } from 'react-router';
import { AppShell } from '@/components/shell/AppShell';
import { DashboardPage } from '@/pages/DashboardPage';
import { PlaceholderPage } from '@/pages/PlaceholderPage';
import { SkillsPage } from '@/pages/SkillsPage';
import { McpPage } from '@/pages/McpPage';
import { ModelsPage } from '@/pages/ModelsPage';
import { LogsPage } from '@/pages/LogsPage';
import { AnalyticsPage } from '@/pages/AnalyticsPage';
import { TasksPage } from '@/pages/TasksPage';
import { PromptsPage } from '@/pages/PromptsPage';
import { NAV_ITEMS } from '@/lib/nav';
import type { ComponentType } from 'react';

/** Pages that exist. Everything else in the nav still shows a placeholder. */
const PAGES: Record<string, ComponentType> = {
  skills: SkillsPage,
  mcp: McpPage,
  modelle: ModelsPage,
  logs: LogsPage,
  analytics: AnalyticsPage,
  aufgaben: TasksPage,
  prompts: PromptsPage,
};

/**
 * What each not-yet-built page will contain. Written per page rather than as one
 * generic sentence, so the placeholder still tells the reader something true.
 */
const PLANNED: Record<string, string> = {
  chats: 'Unterhaltungen mit deinem Agenten, live gestreamt, mit Sitzungsverlauf und Suche.',
  agenten: 'Deine Agenten mit Auslastung, Modellzuordnung und laufenden Aufträgen.',
  workflows: 'Wiederkehrende Abläufe: anlegen, planen, pausieren und Verlauf einsehen.',
  wissen: 'Wissensdatenbank: Dokumente, Einbettungen und was der Agent daraus gelernt hat.',
  dokumente: 'Hochgeladene Dokumente mit Vorschau, Verschlagwortung und Verwendung.',
  browser: 'Browser-Automatisierung: Sitzungen beobachten, Abläufe starten, Ergebnisse ansehen.',
  dateien: 'Dateibrowser deines Hermes-Verzeichnisses mit Vorschau und Upload.',
  integrationen: 'Telegram, Discord, Webhooks und API-Zugänge einrichten und prüfen.',
  einstellungen: 'Konfiguration, Profile, Passwort und Erscheinungsbild.',
};

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<DashboardPage />} />

        {NAV_ITEMS.filter((item) => item.path !== '/').map((item) => {
          const Page = PAGES[item.id];

          return (
            <Route
              key={item.id}
              path={`${item.path}/*`}
              element={
                Page ? (
                  <Page />
                ) : (
                  <PlaceholderPage
                    item={item}
                    planned={
                      PLANNED[item.id] ?? 'Diese Seite entsteht in einem der nächsten Schritte.'
                    }
                  />
                )
              }
            />
          );
        })}

        <Route
          path="*"
          element={
            <div className="mx-auto max-w-3xl px-6 py-12">
              <div className="card p-8 text-center">
                <h2 className="text-lg font-semibold">Seite nicht gefunden</h2>
                <p className="mt-2 text-sm text-[var(--color-ink-muted)]">
                  Diese Adresse gehört zu keiner Seite des Control Centers.
                </p>
              </div>
            </div>
          }
        />
      </Route>
    </Routes>
  );
}
