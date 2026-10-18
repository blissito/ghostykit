// ghosty-autopilot/pointer — «Señalar» con `@ghostystudio/pointer`: un elemento elegido en una página se
// vuelve una referencia del mensaje, con el renglón exacto que el agente sabe leer.
import { pickedKind, pickedLineLabel, pickedSnippet } from "@ghostystudio/pointer/kind";
import { pickedElementLine, type PickedElement } from "@ghostystudio/pointer/picked";
import { cleanUserText } from "../core/text";
import type { Reference } from "../core/types";

/** Un elemento señalado → referencia: chip «Título «…»» y el renglón `[Elemento señalado …]` antes del mensaje. */
export function elementReference(picked: PickedElement, fileName: string): Reference {
  return {
    id: `pick:${fileName}:${picked.id ?? picked.selector}`,
    label: pickedKind(picked.tag).label,
    hint: picked.text ? pickedSnippet(picked.text) : undefined,
    prompt: pickedElementLine(picked, fileName),
  };
}

/** Qué pedirle a lo señalado («¿Qué le cambio a este título? Ej.: …»), para el placeholder. */
export function pickedPlaceholder(picked: PickedElement): string {
  const k = pickedKind(picked.tag);
  return `¿Qué le cambio a ${k.this}? Ej.: ${k.example}`;
}

/** `formatUserText` que además pinta el renglón señalado como etiqueta corta (`↳ Título «…»`). */
export function formatWithPicked(text: string): string {
  return cleanUserText(pickedLineLabel(text));
}

export type { PickedElement };
