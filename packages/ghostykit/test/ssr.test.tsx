// Piloto se puede renderizar en el servidor (React Router, Next): nada toca `window` al montar.
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Piloto } from "../src/react";

describe("SSR", () => {
  it("renderiza vacío con defaults y con el hilo guardado", () => {
    const empty = renderToString(<Piloto transport={null} welcome="Hola" suggestions={["Uno"]} />);
    expect(empty).toContain('class="piloto ');
    expect(empty).toContain("Hola");
    const thread = renderToString(
      <Piloto
        transport={null}
        locale="en"
        initialTurns={[
          { role: "user", text: "hi" },
          { role: "assistant", text: "- ✓ Checked.\n\n**Done**", tools: [{ id: "a", kind: "read", status: "completed" }], seconds: 3 },
        ]}
      />,
    );
    expect(thread).toContain("Checked.");
    expect(thread).toContain("Worked 3 s");
  });
});

describe("0.2.1 — lo que encontró el primer adoptante", () => {
  it("la narración entre pasos pinta su markdown en línea (no `**` crudos)", () => {
    const html = renderToString(
      <Piloto
        transport={null}
        initialTurns={[
          { role: "user", text: "hola" },
          { role: "assistant", text: "Reviso **los crons** y `monitor`.Listo.", cuts: [33], tools: [{ id: "a", status: "completed" }] },
        ]}
      />,
    );
    expect(html).toContain("<strong>los crons</strong>");
    expect(html).toContain("<code>monitor</code>");
    expect(html).not.toContain("**los crons**");
  });

  it("`draft` deja la pregunta escrita en la caja", () => {
    const html = renderToString(<Piloto transport={null} draft={{ text: "¿Por qué falló el monitor?", key: 1 }} />);
    expect(html).toContain("¿Por qué falló el monitor?</textarea>");
  });

  it("un saludo largo va en letra de lectura", () => {
    const html = renderToString(<Piloto transport={null} welcome={"Pregúntame por qué falló un cron, cuándo corre o qué pasó en sus últimas corridas."} />);
    expect(html).toMatch(/piloto-welcome-text" data-long=""/);
    expect(html).toContain('class="piloto-empty"');
  });
});
