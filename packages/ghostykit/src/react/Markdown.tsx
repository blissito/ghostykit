// Markdown en streaming (Streamdown). PORTADO de Ghosty Studio (`Markdown.tsx`, `LinkSafetyModal.tsx`):
// mismo `.ghosty-md`, mismo aviso de enlace externo. Las tarjetas del CRM de Ghosty van por `transform`.
import { Check, ExternalLink, X } from "lucide-react";
import { useContext, useState, type MouseEvent as ReactMouseEvent } from "react";
import { Streamdown, type LinkSafetyModalProps } from "streamdown";
import { rootProps, TurnContext, usePiloto } from "./context";
import { ChunkedBlock, ChunksContext, useChunkRegistry } from "./TextAtPace";

/** El aviso de enlace externo, en la lengua y el tema de Piloto (el de Streamdown llega en inglés). */
export function LinkSafetyModal({ isOpen, onClose, onConfirm, url }: LinkSafetyModalProps) {
  const { strings: t, skin } = usePiloto();
  const [copied, setCopied] = useState(false);
  if (!isOpen) return null;
  const copy = async () => {
    await navigator.clipboard?.writeText(url).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const open = () => {
    window.open(url, "_blank", "noopener,noreferrer");
    onConfirm();
  };
  // Streamdown lo monta en un portal, fuera de `.piloto`: se re-abre el alcance aquí, en oscuro
  // (como en Ghosty: sobre el chat se lee como aviso del sistema, no como otra app).
  return (
    <div {...rootProps("dark", skin)} style={{ display: "contents" }}>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4" onClick={onClose} role="presentation">
        <div
          className="w-full max-w-md rounded-2xl border border-border-primary bg-background-primary p-6 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-label={t.linkTitle}
        >
          <div className="flex items-start justify-between gap-4">
            <h2 className="flex items-center gap-2 text-base text-text-primary">
              <ExternalLink className="h-4 w-4 text-text-secondary" />
              {t.linkTitle}
            </h2>
            <button type="button" onClick={onClose} aria-label={t.close} className="text-text-secondary transition hover:text-text-primary">
              <X className="h-4 w-4" />
            </button>
          </div>
          {/* La URL entera y partible: el peligro de un enlace está en el dominio. */}
          <p className="mt-4 break-all rounded-xl border border-border-primary bg-background-secondary px-3 py-2.5 font-mono text-xs text-text-primary">{url}</p>
          <div className="mt-5 flex gap-2">
            <button
              type="button"
              onClick={copy}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-border-primary bg-background-secondary px-4 py-2 text-sm text-text-primary transition hover:border-text-tertiary"
            >
              {copied ? (
                <>
                  <Check className="h-4 w-4 text-text-success" />
                  {t.linkCopied}
                </>
              ) : (
                t.linkCopy
              )}
            </button>
            <button type="button" onClick={open} className="flex-1 rounded-xl bg-text-primary px-4 py-2 text-sm text-text-inverse transition hover:opacity-90">
              {t.linkOpen}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const linkSafety = { enabled: true, renderModal: (p: LinkSafetyModalProps) => <LinkSafetyModal {...p} /> };

/**
 * `animate`: la respuesta se está escribiendo y entra por tramos con fade. Una vez que animó, se
 * queda con el mismo bloque aunque el turno cierre: cambiarlo re-montaría todo y cortaría el fade.
 */
export function Markdown({ children, animate = false, className }: { children: string; animate?: boolean; className?: string }) {
  const { markdown } = usePiloto();
  const registry = useChunkRegistry();
  const turn = useContext(TurnContext);
  const text = markdown.transform ? markdown.transform(children, turn) : children;
  const onClick = markdown.onLinkClick
    ? (e: ReactMouseEvent) => {
        const a = (e.target as HTMLElement).closest("a[href]") as HTMLAnchorElement | null;
        if (!a) return;
        // Fase de captura y sin propagar: Streamdown no debe abrir su aviso para lo que la app maneja.
        if (markdown.onLinkClick!(a.getAttribute("href") ?? "", e.nativeEvent)) {
          e.preventDefault();
          e.stopPropagation();
        }
      }
    : undefined;
  return (
    // `min-w-0 break-words` y el scroll interno en pre/tablas: una URL larga no ensancha el chat.
    <div
      onClickCapture={onClick}
      className={`ghosty-md min-w-0 max-w-full break-words ${className ?? "text-text-primary"} [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto`}
    >
      {animate ? (
        <ChunksContext.Provider value={{ registry, part: 0 }}>
          <Streamdown BlockComponent={ChunkedBlock} linkSafety={linkSafety} components={markdown.components}>
            {text}
          </Streamdown>
        </ChunksContext.Provider>
      ) : (
        <Streamdown linkSafety={linkSafety} components={markdown.components}>
          {text}
        </Streamdown>
      )}
    </div>
  );
}
