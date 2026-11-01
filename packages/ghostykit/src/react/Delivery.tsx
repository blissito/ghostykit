import { Download, ExternalLink, FileText } from "lucide-react";
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
const kind = (mime?: string | null, name?: string) => {
  const ext = name?.split(".").pop()?.toUpperCase();
  if (mime === "application/pdf") return "PDF";
  return ext && ext.length <= 5 ? ext : "Archivo";
};

/**
 * La tarjeta estándar de un archivo entregado (`ghosty.delivery`): nombre, tipo y tamaño, «Abrir» y
 * «Descargar». Piloto la pinta sola; un plugin con `message.custom["ghosty.delivery"]` la reemplaza.
 */
export function DeliveryCard({ entry, locale = "es" }: { entry: CustomEntry; locale?: "es" | "en" }) {
  const d = (entry.value ?? {}) as Delivery;
  if (!d.url) return null;
  const name = d.nombre || d.titulo || "archivo";
  const download = d.url + (d.url.includes("?") ? "&" : "?") + "download=1";
  const meta = [kind(d.mime, name), kb(d.size)].filter(Boolean).join(" · ");
  return (
    <div className="piloto-delivery mt-3 flex max-w-md items-center gap-3 rounded-xl border border-irongray/20 bg-irongray/5 p-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-500/10 text-brand-500">
        <FileText size={20} strokeWidth={1.8} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-dark">{d.titulo || name}</p>
        <p className="truncate text-xs text-metal">{meta}</p>
      </div>
      <a href={d.url} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 w-8 items-center justify-center rounded-full text-metal hover:bg-irongray/10 hover:text-dark" title={locale === "en" ? "Open" : "Abrir"} aria-label={locale === "en" ? "Open" : "Abrir"}>
        <ExternalLink size={16} />
      </a>
      <a href={download} className="inline-flex h-8 w-8 items-center justify-center rounded-full text-metal hover:bg-irongray/10 hover:text-dark" title={locale === "en" ? "Download" : "Descargar"} aria-label={locale === "en" ? "Download" : "Descargar"}>
        <Download size={16} />
      </a>
    </div>
  );
}
