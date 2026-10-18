import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { InlineMarkdown } from "../src/react/InlineMarkdown";

const html = (s: string) => renderToString(<InlineMarkdown>{s}</InlineMarkdown>);

describe("InlineMarkdown", () => {
  it("negritas, itálicas, código y enlaces; lo demás queda como texto (escapado)", () => {
    expect(html("Leo **el historial** de `monitor` y *luego* [la doc](https://x.dev/a)")).toBe(
      'Leo <strong>el historial</strong> de <code>monitor</code> y <em>luego</em> <a href="https://x.dev/a" target="_blank" rel="noopener noreferrer">la doc</a>',
    );
    expect(html("2 * 3 = 6 y <b>no</b>")).toBe("2 * 3 = 6 y &lt;b&gt;no&lt;/b&gt;");
    expect(html("un enlace [raro](javascript:alert(1))")).toBe("un enlace [raro](javascript:alert(1))");
  });
});
