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
