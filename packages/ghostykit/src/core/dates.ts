// Fechas legibles dentro de un texto: lo que el agente o el servidor escribe como ISO
// («2026-11-02T11:00:00-06:00») se lee como «lunes 2 de noviembre, 11:00 a. m.».
// Puro y sin estado: el `now` sólo decide si hace falta escribir el año.

export interface HumanDateOptions {
  /** El idioma de la fecha (`es-MX` por default). */
  locale?: string;
  /** La zona para las fechas en UTC (`Z`). Las que traen offset se leen tal como vienen escritas. */
  timeZone?: string;
  /** El «hoy» contra el que se decide si se escribe el año. */
  now?: Date;
}

const DEFAULT_ZONE = "America/Mexico_City";

// AAAA-MM-DD, con hora opcional (T o espacio), segundos/fracción opcionales y zona opcional (Z o ±HH:MM).
const ISO_RE =
  /\b(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?(?![\d:])/g;

// Un formateador por (idioma, zona, opciones), reutilizado: crear `Intl.DateTimeFormat` es caro y un
// hilo largo humaniza muchas fechas en cada render.
const formatters = new Map<string, Intl.DateTimeFormat>();
function fmt(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, options);
    formatters.set(key, f);
  }
  return f;
}

/** El año como se ve en la zona (para no escribirlo si es el de hoy). */
const yearIn = (d: Date, timeZone: string) => Number(fmt("en-US", { timeZone, year: "numeric" }).format(d));

/** «a.m.» → «a. m.» (como lo escribe la RAE) y espacios duros para que la hora no se parta. */
const tidySpanishTime = (s: string) =>
  s
    .replace(/\s*([ap])\.?\s*m\.?(?=$|[^\p{L}])/giu, (_m, ap: string) => ` ${ap.toLowerCase()}. m.`)
    .replace(/[  ]/g, " ");

/**
 * Una fecha ISO como la diría una persona. Devuelve `null` si no es una fecha válida
 * (p. ej. «2026-13-45»), para que quien llama deje el texto como estaba.
 */
export function formatHumanDate(iso: string, opts: HumanDateOptions = {}): string | null {
  const src = iso.trim();
  const m = new RegExp(ISO_RE.source).exec(src);
  if (!m || m.index !== 0 || m[0].length !== src.length) return null;
  const [, y, mo, d, hh, mi, , zone] = m;
  const locale = opts.locale ?? "es-MX";
  const hasTime = hh !== undefined;

  // Con `Z` es un instante: se ve en la zona pedida. Con offset o sin zona, la hora escrita ES la
  // hora de pared: se pinta tal cual (como UTC, sin mover nada).
  const date = new Date(Date.UTC(+y, +mo - 1, +d, +(hh ?? 0), +(mi ?? 0)));
  const timeZone = zone === "Z" ? (opts.timeZone ?? DEFAULT_ZONE) : "UTC";
  // Validación de calendario: «2026-02-31» no existe.
  if (date.getUTCFullYear() !== +y || date.getUTCMonth() !== +mo - 1 || date.getUTCDate() !== +d) return null;
  if (hasTime && (+hh! > 23 || +mi! > 59)) return null;

  const now = opts.now ?? new Date();
  const withYear = yearIn(date, timeZone) !== yearIn(now, opts.timeZone ?? DEFAULT_ZONE);

  const parts = fmt(locale, {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
    ...(withYear ? { year: "numeric" as const } : {}),
  }).formatToParts(date);
  const part = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? "";

  const time = hasTime
    ? fmt(locale, { timeZone, hour: "numeric", minute: "2-digit", hour12: true }).format(date)
    : "";

  if (/^es\b/i.test(locale)) {
    // Español armado a mano: Intl pone coma tras el día de la semana («lunes, 2 de noviembre»).
    const day = `${part("weekday")} ${part("day")} de ${part("month")}${withYear ? ` de ${part("year")}` : ""}`;
    return hasTime ? `${day}, ${tidySpanishTime(time)}` : day;
  }
  const day = fmt(locale, {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
    ...(withYear ? { year: "numeric" as const } : {}),
  }).format(date);
  return hasTime ? `${day}, ${time}` : day;
}

/** Cambia cada fecha ISO de un texto por su forma legible; lo demás queda igual. */
export function humanizeDates(text: string, opts: HumanDateOptions = {}): string {
  if (!text || !/\d{4}-\d{2}-\d{2}/.test(text)) return text;
  return text.replace(ISO_RE, (match) => formatHumanDate(match, opts) ?? match);
}
