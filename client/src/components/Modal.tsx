import { ReactNode, useEffect, useId } from "react";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  variant?: "default" | "chat";
}

export default function Modal({
  isOpen,
  onClose,
  title,
  children,
  variant = "default",
}: ModalProps) {
  const titleId = useId();

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    document.body.style.overflow = "hidden";

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = "unset";
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const isChat = variant === "chat";
  const overlayClassName = isChat
    ? "modal-shell modal-shell-chat"
    : "fixed inset-0 z-50 overflow-y-auto bg-[#0a2540]/40 backdrop-blur-[3px] p-4 sm:p-6";
  const dialogClassName = isChat
    ? "modal-dialog modal-dialog-chat"
    : "relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-[var(--color-border)] bg-white shadow-2xl";
  const headerClassName = isChat
    ? "modal-header modal-header-chat"
    : "sticky top-0 z-10 surface-muted border-b border-[var(--color-border)] px-6 py-4 flex items-center justify-between rounded-t-2xl";
  const titleClassName = isChat
    ? "modal-title modal-title-chat"
    : "text-xl font-bold text-[var(--color-text)]";
  const closeButtonClassName = isChat ? "modal-close modal-close-chat" : "icon-btn";
  const contentClassName = isChat ? "modal-content modal-content-chat" : "p-6";

  return (
    <div
      className={overlayClassName}
      onClick={onClose}
    >
      <div className="flex min-h-full items-center justify-center">
        <div
          className={dialogClassName}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          onClick={(e) => e.stopPropagation()}
        >
          <div className={headerClassName}>
            <h2 id={titleId} className={titleClassName}>
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              className={closeButtonClassName}
              aria-label="Lukk modal"
              title="Lukk"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden="true">
                <path
                  d="M6 6l12 12M18 6 6 18"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
          <div className={contentClassName}>{children}</div>
        </div>
      </div>
    </div>
  );
}

