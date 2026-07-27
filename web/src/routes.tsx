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
import { WissenPage } from '@/pages/WissenPage';
import { IntegrationenPage } from '@/pages/IntegrationenPage';
import { EinstellungenPage } from '@/pages/EinstellungenPage';
import { AgentenPage } from '@/pages/AgentenPage';
import { WorkflowsPage } from '@/pages/WorkflowsPage';
import { ChatsPage } from '@/pages/ChatsPage';
import { NAV_ITEMS } from '@/lib/nav';
import type { ComponentType } from 'react';

/** Every nav item now maps to a real page. */
const PAGES: Record<string, ComponentType> = {
  chats: ChatsPage,
  agenten: AgentenPage,
  workflows: WorkflowsPage,
  aufgaben: TasksPage,
  wissen: WissenPage,
  skills: SkillsPage,
  mcp: McpPage,
  modelle: ModelsPage,
  prompts: PromptsPage,
  integrationen: IntegrationenPage,
  analytics: AnalyticsPage,
  logs: LogsPage,
  einstellungen: EinstellungenPage,
};

/** Fallback copy if a nav item ever lacks a page again. */
const PLANNED: Record<string, string> = {};

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
