import { Paperclip, X } from 'lucide-react';

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
  const sizeKb = Math.round(attachment.file.size / 1024);
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-hairline)] bg-[var(--color-raised)] py-1 pr-1 pl-2.5 text-xs text-[var(--color-ink-muted)]">
      <Paperclip size={11} className="shrink-0" aria-hidden />
      <span className="max-w-[10rem] truncate">{attachment.file.name}</span>
      <span className="shrink-0 text-[var(--color-ink-faint)]">{sizeKb} KB</span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${attachment.file.name}`}
        className="shrink-0 rounded-full p-0.5 text-[var(--color-ink-faint)] hover:text-[var(--color-danger)]"
      >
        <X size={11} aria-hidden />
      </button>
    </span>
  );
}
