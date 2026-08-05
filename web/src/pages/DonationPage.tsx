import { ClipboardCopy, ShieldAlert } from 'lucide-react';
import qrcode from 'qrcode-generator';
import { PageShell } from '@/components/PageShell';
import { useToast } from '@/components/Toast';
import { useI18n } from '@/lib/i18n';

interface DonationAddress {
  id: string;
  titleKey: string;
  subtitleKey: string;
  warningKey: string;
  accent: 'agent' | 'accent' | 'info';
  address: string;
}

const DONATION_ADDRESSES: DonationAddress[] = [
  {
    id: 'evm',
    titleKey: 'donation.evm.title',
    subtitleKey: 'donation.evm.subtitle',
    warningKey: 'donation.evm.warning',
    accent: 'agent',
    address: '0x42669069b16353f400a2aa3462cfbcf8c789bd28',
  },
  {
    id: 'sol',
    titleKey: 'donation.sol.title',
    subtitleKey: 'donation.sol.subtitle',
    warningKey: 'donation.sol.warning',
    accent: 'accent',
    // Restricted to USDC/USDT only — do not send SOL or other SPL tokens to
    // this address (see donation.sol.warning).
    address: 'Bh6seZkPc1JraxXo7V4Bi4mdBkwV3bDji5uvAuEkdzHu',
  },
  {
    id: 'ton',
    titleKey: 'donation.ton.title',
    subtitleKey: 'donation.ton.subtitle',
    warningKey: 'donation.ton.warning',
    accent: 'info',
    // Restricted to USDT only — do not send TON itself (see donation.ton.warning).
    address: 'UQD637kxj-IA7c9OzaeH_Ag4OwIiDeDDgSiz94daJ8Z6VeJZ',
  },
];

/**
 * Rendered once at module load, not per-render: the addresses are static, and
 * generating a QR code client-side (rather than via a third-party image API)
 * keeps these addresses from ever leaving the browser.
 */
const DONATION_QR_SVG: Record<string, string> = Object.fromEntries(
  DONATION_ADDRESSES.map(({ id, address }) => {
    const qr = qrcode(0, 'M');
    qr.addData(address);
    qr.make();
    return [id, qr.createSvgTag({ scalable: true })];
  }),
);

const ACCENT_CLASSES: Record<
  DonationAddress['accent'],
  { ring: string; badge: string; text: string }
> = {
  agent: {
    ring: 'border-[var(--color-agent)]/30',
    badge: 'bg-[var(--color-agent-soft)] text-[var(--color-agent)]',
    text: 'text-[var(--color-agent)]',
  },
  accent: {
    ring: 'border-[var(--color-accent)]/30',
    badge: 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]',
    text: 'text-[var(--color-accent)]',
  },
  info: {
    ring: 'border-[var(--color-info)]/30',
    badge: 'bg-[var(--color-info)]/15 text-[var(--color-info)]',
    text: 'text-[var(--color-info)]',
  },
};

function DonationCard({ entry }: { entry: DonationAddress }) {
  const { t } = useI18n();
  const toast = useToast();
  const accent = ACCENT_CLASSES[entry.accent];

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(entry.address);
      toast.push({ tone: 'success', title: t('prompts.copied') });
    } catch {
      toast.push({
        tone: 'error',
        title: t('prompts.copyFailed'),
        description: t('prompts.copyFailedDesc'),
      });
    }
  };

  return (
    <div className={`card flex flex-col items-center gap-4 border p-6 text-center ${accent.ring}`}>
      <span className={`rounded-full px-2.5 py-1 text-[0.7rem] font-medium ${accent.badge}`}>
        {t(entry.subtitleKey)}
      </span>
      <h3 className="text-base font-semibold">{t(entry.titleKey)}</h3>

      {/* White backdrop is not decorative — a QR code needs strong contrast to
          scan, so this stays white in both the light and dark theme. */}
      <div className="rounded-xl bg-white p-3 shadow-[var(--shadow-card)]">
        <div
          className="size-44"
          dangerouslySetInnerHTML={{ __html: DONATION_QR_SVG[entry.id] ?? '' }}
        />
      </div>

      <code className="w-full rounded-lg border border-[var(--color-hairline)] bg-[var(--color-base)] px-3 py-2 font-mono text-xs break-all">
        {entry.address}
      </code>

      <button
        type="button"
        onClick={() => void copy()}
        aria-label={t('donation.copyAria', { label: t(entry.titleKey) })}
        className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm transition-colors hover:bg-[var(--color-raised)] ${accent.ring} ${accent.text}`}
      >
        <ClipboardCopy size={14} aria-hidden />
        {t('donation.copyButton')}
      </button>

      <p className="text-[0.7rem] font-medium text-[var(--color-warn)]">{t(entry.warningKey)}</p>
    </div>
  );
}

export function DonationPage() {
  const { t } = useI18n();
  return (
    <PageShell title={t('nav.donation')} description={t('page.donation.desc')}>
      <div className="mb-6 flex items-start gap-3 rounded-2xl border border-[var(--color-warn)]/30 bg-[var(--color-warn)]/5 p-4">
        <ShieldAlert size={18} className="mt-0.5 shrink-0 text-[var(--color-warn)]" aria-hidden />
        <p className="text-sm text-[var(--color-ink-muted)]">{t('donation.warning')}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {DONATION_ADDRESSES.map((entry) => (
          <DonationCard key={entry.id} entry={entry} />
        ))}
      </div>
    </PageShell>
  );
}
