import { Paperclip, X } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { formatBytes } from '@/lib/format';

export interface PendingAttachment {
  file: File;
  /** Set once the file has been read into a data URL, ready to send. */
  dataUrl: string | null;
}

export function AttachmentChip({
  attachment,
  onRemove,
}: {
  attachment: PendingAttachment;
  onRemove: () => void;
}) {
  const { t } = useI18n();
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-hairline)] bg-[var(--color-raised)] py-1 pr-1 pl-2.5 text-xs text-[var(--color-ink-muted)]">
      <Paperclip size={11} className="shrink-0" aria-hidden />
      <span className="max-w-[10rem] truncate">{attachment.file.name}</span>
      <span className="shrink-0 text-[var(--color-ink-faint)]">
        {formatBytes(attachment.file.size)}
      </span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`${t('common.remove')} ${attachment.file.name}`}
        className="shrink-0 rounded-full p-0.5 text-[var(--color-ink-faint)] hover:text-[var(--color-danger)]"
      >
        <X size={11} aria-hidden />
      </button>
    </span>
  );
}
