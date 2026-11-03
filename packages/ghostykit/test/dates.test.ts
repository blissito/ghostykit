import { describe, expect, it } from "vitest";
import { formatHumanDate, humanizeDates } from "../src/core";

// Los espacios duros (que no dejan partir «11:00 a. m.») se comparan como espacios normales.
const plain = (s: string | null) => s?.replace(/[  ]/g, " ") ?? s;
const now = new Date("2026-11-01T12:00:00Z");

describe("fechas legibles", () => {
  it("ISO con offset: la hora escrita es la hora de pared", () => {
    expect(plain(formatHumanDate("2026-11-02T11:00:00-06:00", { now }))).toBe("lunes 2 de noviembre, 11:00 a. m.");
  });
  it("la tarde sale en p. m.", () => {
    expect(plain(formatHumanDate("2026-11-02T17:30:00-06:00", { now }))).toBe("lunes 2 de noviembre, 5:30 p. m.");
  });
  it("UTC (Z) se convierte a la hora de Ciudad de México", () => {
    expect(plain(formatHumanDate("2026-11-02T17:00:00Z", { now }))).toBe("lunes 2 de noviembre, 11:00 a. m.");
  });
  it("con otra zona pedida", () => {
    expect(plain(formatHumanDate("2026-11-02T17:00:00Z", { now, timeZone: "America/Tijuana" }))).toBe("lunes 2 de noviembre, 9:00 a. m.");
  });
  it("sólo fecha", () => {
    expect(formatHumanDate("2026-11-02", { now })).toBe("lunes 2 de noviembre");
  });
  it("otro año lo escribe", () => {
    expect(plain(formatHumanDate("2027-01-04T09:00", { now }))).toBe("lunes 4 de enero de 2027, 9:00 a. m.");
  });
  it("inglés", () => {
    expect(plain(formatHumanDate("2026-11-02T11:00:00-06:00", { now, locale: "en-US" }))).toBe("Monday, November 2, 11:00 AM");
  });
  it("lo que no es fecha se queda null", () => {
    expect(formatHumanDate("2026-02-31", { now })).toBeNull();
    expect(formatHumanDate("2026-11-02T25:00", { now })).toBeNull();
    expect(formatHumanDate("hola", { now })).toBeNull();
  });
  it("dentro de un texto sólo cambia la fecha", () => {
    expect(plain(humanizeDates("Agendar «URGENTE: Pagar la tarjeta de crédito» el 2026-11-02T11:00:00-06:00", { now }))).toBe(
      "Agendar «URGENTE: Pagar la tarjeta de crédito» el lunes 2 de noviembre, 11:00 a. m.",
    );
    expect(plain(humanizeDates("Mover del 2026-11-02 al 2026-11-03T08:15:00.000Z", { now }))).toBe(
      "Mover del lunes 2 de noviembre al martes 3 de noviembre, 2:15 a. m.",
    );
  });
  it("texto sin fechas o con números que no son fechas, intacto", () => {
    expect(humanizeDates("Correr la purga (purge-notifications)")).toBe("Correr la purga (purge-notifications)");
    expect(humanizeDates("folio 2026-13-45")).toBe("folio 2026-13-45");
  });
});
