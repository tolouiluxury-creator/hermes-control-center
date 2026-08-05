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

/**
 * A file reference inside an already-sent message: just the name, never the
 * full path, with a thumbnail when a preview is available (only for images
 * attached during the current session — reopened history has no bytes to
 * show a thumbnail from, so it falls back to the plain chip).
 */
export function SentAttachment({ name, previewUrl }: { name: string; previewUrl?: string }) {
  if (previewUrl) {
    return (
      <img
        src={previewUrl}
        alt={name}
        className="max-h-40 max-w-[12rem] rounded-lg border border-[var(--color-hairline)] object-cover"
      />
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-hairline)] bg-[var(--color-base)] px-2 py-1 text-xs text-[var(--color-ink-muted)]">
      <Paperclip size={11} className="shrink-0" aria-hidden />
      <span className="max-w-[10rem] truncate">{name}</span>
    </span>
  );
}
