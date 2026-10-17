// Lo que todos los componentes de Piloto leen: textos, verbos e íconos de los pasos, tema.
import { createContext, useContext, type ComponentType } from "react";
import { TOOL_VERBS_ES, type ToolVerbs } from "../core/steps";
import { cleanUserText } from "../core/text";
import { STRINGS_ES, type PilotStrings } from "./strings";

/** Un ícono: cualquier componente que acepte `className` (los de lucide-react sirven tal cual). */
export type PilotIcon = ComponentType<{ className?: string }>;

export type PilotTheme = "light" | "dark" | "auto";

/** Ajustes del markdown de las respuestas. */
export interface MarkdownOptions {
  /** Reescribe el markdown antes de pintarlo (p. ej. `#12` → `[#12](#folio-12)`). */
  transform?: (md: string) => string;
  /** Un clic en un enlace. Devuelve `true` si la app lo manejó (no se abre el aviso de salida). */
  onLinkClick?: (href: string, event: MouseEvent) => boolean;
}

export interface PilotoConfig {
  strings: PilotStrings;
  toolVerbs: ToolVerbs;
  /** Ícono por `kind` de paso o por NOMBRE de herramienta. */
  toolIcons: Record<string, PilotIcon>;
  formatUserText: (text: string) => string;
  theme: PilotTheme;
  /** La piel: `ghosty` (default), `easybits`, `neutral` o una propia (`data-skin`). */
  skin: string;
  markdown: MarkdownOptions;
}

export const PilotoContext = createContext<PilotoConfig>({
  strings: STRINGS_ES,
  toolVerbs: TOOL_VERBS_ES,
  toolIcons: {},
  formatUserText: cleanUserText,
  theme: "light",
  skin: "ghosty",
  markdown: {},
});

export const usePiloto = () => useContext(PilotoContext);

/** Las clases de la raíz: el alcance de los estilos y el tema. Lo usan también los portales. */
export function rootProps(theme: PilotTheme, skin = "ghosty"): { className: string; "data-theme": PilotTheme; "data-skin": string } {
  return { className: "piloto", "data-theme": theme, "data-skin": skin };
}
