// JSON Patch (RFC 6902) inmutable, para `STATE_DELTA`. Sin dependencias: el estado del agente es
// JSON chico y las seis operaciones caben aquí. Un patch que no aplica regresa el documento tal cual
// (`ok: false`), para que la app pida un `STATE_SNAPSHOT` en vez de quedarse con un estado a medias.

export interface PatchOp {
  op: "add" | "remove" | "replace" | "move" | "copy" | "test";
  path: string;
  value?: unknown;
  from?: string;
}

type Json = unknown;

function parsePath(path: string): string[] {
  if (path === "") return [];
  if (!path.startsWith("/")) throw new Error(`bad path ${path}`);
  return path
    .slice(1)
    .split("/")
    .map((k) => k.replace(/~1/g, "/").replace(/~0/g, "~"));
}

function get(doc: Json, keys: string[]): Json {
  let cur = doc;
  for (const k of keys) {
    if (Array.isArray(cur)) cur = cur[Number(k)];
    else if (cur && typeof cur === "object") cur = (cur as Record<string, Json>)[k];
    else return undefined;
  }
  return cur;
}

/** Copia el camino hasta la llave y aplica `fn` al contenedor. */
function edit(doc: Json, keys: string[], fn: (parent: Json, key: string) => Json): Json {
  if (!keys.length) throw new Error("root");
  const [k, ...rest] = keys;
  if (!rest.length) return fn(doc, k);
  if (Array.isArray(doc)) {
    const i = Number(k);
    if (!(i in doc)) throw new Error(`missing ${k}`);
    const out = [...doc];
    out[i] = edit(doc[i], rest, fn);
    return out;
  }
  if (doc && typeof doc === "object" && k in (doc as object)) {
    return { ...(doc as object), [k]: edit((doc as Record<string, Json>)[k], rest, fn) };
  }
  throw new Error(`missing ${k}`);
}

function add(doc: Json, keys: string[], value: Json): Json {
  if (!keys.length) return value;
  return edit(doc, keys, (parent, k) => {
    if (Array.isArray(parent)) {
      const i = k === "-" ? parent.length : Number(k);
      if (!Number.isInteger(i) || i < 0 || i > parent.length) throw new Error(`index ${k}`);
      const out = [...parent];
      out.splice(i, 0, value);
      return out;
    }
    if (parent && typeof parent === "object") return { ...(parent as object), [k]: value };
    throw new Error("not a container");
  });
}

function remove(doc: Json, keys: string[]): Json {
  return edit(doc, keys, (parent, k) => {
    if (Array.isArray(parent)) {
      const i = Number(k);
      if (!(i in parent)) throw new Error(`index ${k}`);
      return parent.filter((_, j) => j !== i);
    }
    if (parent && typeof parent === "object" && k in (parent as object)) {
      const { [k]: _, ...rest } = parent as Record<string, Json>;
      return rest;
    }
    throw new Error(`missing ${k}`);
  });
}

function replace(doc: Json, keys: string[], value: Json): Json {
  if (!keys.length) return value;
  return edit(doc, keys, (parent, k) => {
    if (Array.isArray(parent)) {
      const i = Number(k);
      if (!(i in parent)) throw new Error(`index ${k}`);
      const out = [...parent];
      out[i] = value;
      return out;
    }
    if (parent && typeof parent === "object" && k in (parent as object)) return { ...(parent as object), [k]: value };
    throw new Error(`missing ${k}`);
  });
}

const equal = (a: Json, b: Json) => JSON.stringify(a) === JSON.stringify(b);

/** Aplica `ops` en orden. Si una falla, regresa el documento original y `ok: false`. */
export function applyJsonPatch<T>(doc: T, ops: PatchOp[]): { doc: T; ok: boolean } {
  let cur: Json = doc;
  try {
    for (const o of ops) {
      const keys = parsePath(o.path);
      if (o.op === "add") cur = add(cur, keys, o.value);
      else if (o.op === "remove") cur = remove(cur, keys);
      else if (o.op === "replace") cur = replace(cur, keys, o.value);
      else if (o.op === "move" || o.op === "copy") {
        const from = parsePath(o.from ?? "");
        const v = get(cur, from);
        if (v === undefined) throw new Error(`missing ${o.from}`);
        if (o.op === "move") cur = remove(cur, from);
        cur = add(cur, keys, v);
      } else if (o.op === "test") {
        if (!equal(get(cur, keys), o.value)) throw new Error(`test ${o.path}`);
      } else throw new Error(`op ${(o as PatchOp).op}`);
    }
    return { doc: cur as T, ok: true };
  } catch {
    return { doc, ok: false };
  }
}
