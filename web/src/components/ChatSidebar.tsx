import { forwardRef, useImperativeHandle, useState, type Ref } from 'react';
import { ChevronLeft, ChevronRight, FolderOpen, ListTodo } from 'lucide-react';
import { TodosPanel, type TodosPanelHandle } from '@/components/TodosPanel';
import { WorkspaceBrowser } from '@/components/WorkspaceBrowser';
import { useI18n } from '@/lib/i18n';

type SidebarTab = 'todos' | 'workspace';

const OPEN_KEY = 'hcc.chatSidebar.open';
const TAB_KEY = 'hcc.chatSidebar.tab';

function readStoredOpen(): boolean {
  return localStorage.getItem(OPEN_KEY) !== 'false';
}

function readStoredTab(): SidebarTab {
  return localStorage.getItem(TAB_KEY) === 'workspace' ? 'workspace' : 'todos';
}

export interface ChatSidebarHandle {
  openTodosTab: () => void;
}

export const ChatSidebar = forwardRef<
  ChatSidebarHandle,
  { sessionId: string | null; todosPanelRef: Ref<TodosPanelHandle> }
>(function ChatSidebar({ sessionId, todosPanelRef }, ref) {
  const { t } = useI18n();
  const [open, setOpen] = useState(readStoredOpen);
  const [tab, setTab] = useState<SidebarTab>(readStoredTab);

  const setOpenPersist = (value: boolean) => {
    setOpen(value);
    localStorage.setItem(OPEN_KEY, String(value));
  };
  const setTabPersist = (value: SidebarTab) => {
    setTab(value);
    localStorage.setItem(TAB_KEY, value);
  };

  useImperativeHandle(ref, () => ({
    openTodosTab: () => {
      setTabPersist('todos');
      setOpenPersist(true);
    },
  }));

  if (!open) {
    return (
      <div className="hidden w-10 shrink-0 flex-col items-center gap-2 pt-1 lg:flex">
        <button
          type="button"
          onClick={() => setOpenPersist(true)}
          title={t('chatSidebar.expand')}
          aria-label={t('chatSidebar.expand')}
          className="rounded-lg p-1.5 text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]"
        >
          <ChevronLeft size={14} aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => {
            setTabPersist('todos');
            setOpenPersist(true);
          }}
          title={t('chatSidebar.todos')}
          aria-label={t('chatSidebar.todos')}
          className="rounded-lg p-1.5 text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]"
        >
          <ListTodo size={16} aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => {
            setTabPersist('workspace');
            setOpenPersist(true);
          }}
          title={t('chatSidebar.workspace')}
          aria-label={t('chatSidebar.workspace')}
          className="rounded-lg p-1.5 text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]"
        >
          <FolderOpen size={16} aria-hidden />
        </button>
      </div>
    );
  }

  return (
    <aside className="hidden w-72 shrink-0 flex-col rounded-2xl border border-[var(--color-hairline)] bg-[var(--color-base)] lg:flex">
      <div className="flex items-center gap-1 border-b border-[var(--color-hairline)] p-2">
        <button
          type="button"
          onClick={() => setTabPersist('todos')}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs transition-colors ${
            tab === 'todos'
              ? 'bg-[var(--color-accent)]/10 text-[var(--color-accent)]'
              : 'text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]'
          }`}
        >
          <ListTodo size={13} aria-hidden />
          {t('chatSidebar.todos')}
        </button>
        <button
          type="button"
          onClick={() => setTabPersist('workspace')}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs transition-colors ${
            tab === 'workspace'
              ? 'bg-[var(--color-accent)]/10 text-[var(--color-accent)]'
              : 'text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]'
          }`}
        >
          <FolderOpen size={13} aria-hidden />
          {t('chatSidebar.workspace')}
        </button>
        <button
          type="button"
          onClick={() => setOpenPersist(false)}
          title={t('chatSidebar.collapse')}
          aria-label={t('chatSidebar.collapse')}
          className="shrink-0 rounded-lg p-1.5 text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]"
        >
          <ChevronRight size={14} aria-hidden />
        </button>
      </div>
      <div className="min-h-0 flex-1">
        {tab === 'todos' ? (
          <TodosPanel ref={todosPanelRef} sessionId={sessionId} />
        ) : (
          <WorkspaceBrowser compact />
        )}
      </div>
    </aside>
  );
});
