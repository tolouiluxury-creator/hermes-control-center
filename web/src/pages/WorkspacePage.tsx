import { WorkspaceBrowser } from '@/components/WorkspaceBrowser';
import { PageShell } from '@/components/PageShell';
import { useI18n } from '@/lib/i18n';

export function WorkspacePage() {
  const { t } = useI18n();
  return (
    <PageShell title={t('nav.workspace')} description={t('page.workspace.desc')} wide>
      <WorkspaceBrowser compact={false} />
    </PageShell>
  );
}
