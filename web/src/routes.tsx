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
import { WorkflowsPage } from '@/pages/WorkflowsPage';
import { ChatsPage } from '@/pages/ChatsPage';
import { ProfilePage } from '@/pages/ProfilePage';
import { TelegramPage } from '@/pages/TelegramPage';
import { TerminalPage } from '@/pages/TerminalPage';
import { WorkspacePage } from '@/pages/WorkspacePage';
import { NAV_ITEMS } from '@/lib/nav';
import { useI18n } from '@/lib/i18n';
import type { ComponentType } from 'react';

/** Every nav item now maps to a real page. */
const PAGES: Record<string, ComponentType> = {
  chats: ChatsPage,
  workflows: WorkflowsPage,
  aufgaben: TasksPage,
  wissen: WissenPage,
  skills: SkillsPage,
  mcp: McpPage,
  modelle: ModelsPage,
  profile: ProfilePage,
  prompts: PromptsPage,
  workspace: WorkspacePage,
  terminal: TerminalPage,
  telegram: TelegramPage,
  integrationen: IntegrationenPage,
  analytics: AnalyticsPage,
  logs: LogsPage,
  einstellungen: EinstellungenPage,
};

/** Fallback dictionary key if a nav item ever lacks a page again. */
const PLANNED: Record<string, string> = {};

export function AppRoutes() {
  const { t } = useI18n();

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
                    planned={t(PLANNED[item.id] ?? 'placeholder.planned')}
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
                <h2 className="text-lg font-semibold">{t('notFound.title')}</h2>
                <p className="mt-2 text-sm text-[var(--color-ink-muted)]">{t('notFound.desc')}</p>
              </div>
            </div>
          }
        />
      </Route>
    </Routes>
  );
}
