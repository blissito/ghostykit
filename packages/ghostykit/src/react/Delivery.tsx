import { Download, ExternalLink } from "lucide-react";
import type { CustomEntry } from "../core/types";

/** Lo que manda gs en `CUSTOM ghosty.delivery` (un archivo que el agente entregó). */
export interface Delivery {
  id?: string;
  tipo?: string;
  nombre?: string;
  titulo?: string;
  url?: string;
  mime?: string | null;
  size?: number | null;
}

const kb = (n?: number | null) => (!n ? null : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
/** Color de la etiqueta por tipo de archivo (como Drive/Gmail). */
const KIND_COLORS: Record<string, string> = {
  PDF: "#E5252A",
  XLSX: "#1D6F42",
  XLS: "#1D6F42",
  CSV: "#1D6F42",
  DOCX: "#2B579A",
  DOC: "#2B579A",
  PPTX: "#C43E1C",
  HTML: "#E8710A",
  PNG: "#7C3AED",
  JPG: "#7C3AED",
  ZIP: "#6B7280",
};

const kind = (mime?: string | null, name?: string) => {
  const ext = name?.split(".").pop()?.toUpperCase();
  if (mime === "application/pdf") return "PDF";
  return ext && ext.length <= 5 ? ext : "Archivo";
};

/** Ícono de archivo: hoja con esquina doblada y renglones, del color del tipo sobre un fondo tenue. */
function FileKindIcon({ type }: { type: string }) {
  const color = KIND_COLORS[type] ?? "#6B7280";
  return (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg" style={{ background: `${color}1A` }} aria-hidden>
      <svg width="22" height="26" viewBox="0 0 22 26" fill="none">
        <path d="M3 1h10l7 7v15a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2Z" fill="#fff" stroke={color} strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M13 1v5a2 2 0 0 0 2 2h5" stroke={color} strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M6 14h10M6 18h10M6 22h6" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    </span>
  );
}

/**
 * La tarjeta estándar de un archivo entregado (`ghosty.delivery`): nombre, tipo y tamaño, «Abrir» y
 * «Descargar». Piloto la pinta sola; un plugin con `message.custom["ghosty.delivery"]` la reemplaza.
 */
export function DeliveryCard({ entry, locale = "es" }: { entry: CustomEntry; locale?: "es" | "en" }) {
  const d = (entry.value ?? {}) as Delivery;
  if (!d.url) return null;
  const name = d.nombre || d.titulo || "archivo";
  const download = d.url + (d.url.includes("?") ? "&" : "?") + "download=1";
  const type = kind(d.mime, name);
  const meta = [type, kb(d.size)].filter(Boolean).join(" · ");
  const openLabel = locale === "en" ? "Open" : "Abrir";
  const downloadLabel = locale === "en" ? `Download ${name}` : `Descargar ${name}`;
  // Toda la tarjeta descarga; el ícono de la derecha abre en otra pestaña.
  return (
    <div className="piloto-delivery mt-3 flex max-w-md items-center gap-1 rounded-xl border border-irongray/20 bg-irongray/5 pr-2 transition-colors hover:border-brand-500/40 hover:bg-brand-500/5">
      <a href={download} download={name} className="flex min-w-0 flex-1 items-center gap-3 p-3" title={downloadLabel} aria-label={downloadLabel}>
        <FileKindIcon type={type} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-dark">{d.titulo || name}</span>
          <span className="block truncate text-xs text-metal">{meta}</span>
        </span>
        <Download size={16} className="shrink-0 text-metal" />
      </a>
      <a href={d.url} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-metal hover:bg-irongray/10 hover:text-dark" title={openLabel} aria-label={openLabel}>
        <ExternalLink size={16} />
      </a>
    </div>
  );
}
