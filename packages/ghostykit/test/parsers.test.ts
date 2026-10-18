import { describe, expect, it } from "vitest";
import {
  TOOL_VERBS_ES,
  applyReferences,
  cleanReplyOption,
  cleanUserText,
  extractReplyOptions,
  formatDuration,
  groupSteps,
  narrationToMarkdown,
  splitNarration,
  stepLabel,
  summarizeTools,
  systemNoteOf,
  toolName,
  toolNames,
} from "../src/core";

describe("narración", () => {
  it("en vivo, por cortes: lo de antes de cada herramienta es avance", () => {
    const text = "Reviso tus archivos.Armo el reporte.\n\nAquí está.";
    expect(splitNarration(text, [20, 36])).toEqual({ steps: ["Reviso tus archivos.", "Armo el reporte."], rest: "Aquí está." });
  });

  it("un tramo largo o con párrafos no es narración", () => {
    const text = "Uno.\n\nDos.Fin";
    expect(splitNarration(text, [10])).toEqual({ steps: [], rest: text });
  });

  it("la copia guardada (`- ✓ …`) se lee igual y se escribe igual", () => {
    const md = narrationToMarkdown(["Reviso.", "Armo."], "Listo.");
    expect(md).toBe("- ✓ Reviso.\n- ✓ Armo.\n\nListo.");
    expect(splitNarration(md)).toEqual({ steps: ["Reviso.", "Armo."], rest: "Listo." });
  });
});

describe("opciones de respuesta", () => {
  it("una oferta con lista corta al final se vuelve botones", () => {
    const o = extractReplyOptions("Ya quedó.\n\nSi quieres, puedo:\n- **Mandarlo** por correo.\n- o guardarlo en PDF");
    expect(o).toEqual({ before: "Ya quedó.\n\nSi quieres, puedo:", items: ["**Mandarlo** por correo.", "o guardarlo en PDF"], numbered: false });
    expect(o!.items.map(cleanReplyOption)).toEqual(["Mandarlo por correo", "Guardarlo en PDF"]);
  });

  it("una lista cualquiera, con ligas o demasiado larga, no", () => {
    expect(extractReplyOptions("Ingredientes\n- harina\n- huevo")).toBeNull();
    expect(extractReplyOptions("Elige:\n- https://a.com\n- b")).toBeNull();
    expect(extractReplyOptions("Elige:\n- a\n- b\n- c\n- d\n- e\n- f")).toBeNull();
  });
});

describe("pasos", () => {
  it("resume por clase y humaniza lo desconocido", () => {
    const tools = [
      { id: "1", kind: "read" },
      { id: "2", kind: "read" },
      { id: "3", kind: "web_search" },
      { id: "4", kind: "rare_kind" },
    ];
    expect(summarizeTools(tools, TOOL_VERBS_ES)).toBe("Leí 2 archivos · Busqué en la web · 1 × rare kind");
  });

  it("los verbos propios de la app van por NOMBRE de herramienta (también tras `mcp__srv__`)", () => {
    const verbs = { ...TOOL_VERBS_ES, run_cron: { one: "Corrí un cron", many: "Corrí %n crons", running: "Corriendo el cron…" } };
    const t = { id: "1", title: "mcp__easy_bits__run_cron", status: "in_progress" };
    expect(toolName(t)).toBe("run_cron");
    expect(stepLabel(t, verbs)).toBe("Corriendo el cron…");
    expect(stepLabel({ ...t, status: "completed" }, verbs)).toBe("Corrí un cron");
    expect(summarizeTools([t, { ...t, id: "2" }], verbs)).toBe("Corrí 2 crons");
  });

  it("agrupa pasos iguales y el que corre o falla manda", () => {
    const tools = [
      { id: "a", title: "Consultando la hoja", detail: "Guardias.xlsx", status: "completed" },
      { id: "b", title: "Consultando la hoja", detail: "Guardias.xlsx", status: "failed" },
      { id: "c", title: "Consultando la hoja", detail: "Guardias.xlsx", status: "completed" },
    ];
    const g = groupSteps(tools, (t) => stepLabel(t, {}));
    expect(g).toEqual([{ tool: { ...tools[1], id: "a" }, times: 3 }]);
  });
});

describe("texto", () => {
  it("referencias: renglones con prompt primero, etiquetas juntas después", () => {
    expect(applyReferences("¿cuál cierra?", [{ id: "12", label: "#12 Rosa" }, { id: "7", label: "#7 Javier" }])).toBe("[#12 Rosa, #7 Javier] ¿cuál cierra?");
    expect(applyReferences("más corto", [{ id: "n", label: "Título", prompt: "[Elemento señalado …]" }])).toBe("[Elemento señalado …]\nmás corto");
  });

  it("nota de voz, línea de sistema y duraciones", () => {
    expect(cleanUserText("[Nota de voz transcrita por la plataforma (whisper).]\n«hola qué tal»")).toBe("hola qué tal");
    expect(systemNoteOf("⏰ Tarea programada (Reporte diario). Instrucciones…")).toBe("reporte diario");
    expect(systemNoteOf("hola")).toBeNull();
    expect([45, 180, 3900].map(formatDuration)).toEqual(["45 s", "3 min", "1 h 05 min"]);
  });
});

describe("nombres de herramienta de MCP", () => {
  it("`mcp_servidor_tool` (un guion bajo, como en EasyBits) también encuentra su verbo", () => {
    const verbs = { list_crons: { one: "Revisé los crons", many: "Revisé los crons" } };
    expect(stepLabel({ id: "1", title: "mcp_easybits_list_crons", status: "completed" }, verbs)).toBe("Revisé los crons");
    expect(stepLabel({ id: "1", title: "mcp_easy_bits_list_crons", status: "completed" }, verbs)).toBe("Revisé los crons");
    expect(stepLabel({ id: "1", title: "mcp__easybits__list_crons", status: "completed" }, verbs)).toBe("Revisé los crons");
    expect(toolNames({ id: "1", title: "mcp_a_b_c" })).toEqual(["mcp_a_b_c", "a_b_c", "b_c", "c"]);
  });
});
