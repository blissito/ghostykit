/**
 * La caja de escribir: textarea que crece, Enter envía y Shift+Enter hace salto. Adjuntos (botón o
 * soltar en cualquier parte), nota de voz, referencias y selector de modelo. Mientras el agente
 * responde, enviar se vuelve parar; se puede seguir escribiendo (entra al turno como corrección).
 */
import { ArrowUp, Check, ChevronDown, Cpu, FileText, Image as ImageIcon, Loader2, Mic, Paperclip, Square, X } from "lucide-react";
import { useCallback, useEffect, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from "react";
import type { Attachment, Reference } from "../core/types";

/** Un modelo que la app ofrece elegir (AG-UI no lo define: la app lo manda en `forwardedProps`). */
export interface ModelOption {
  value: string;
  name: string;
}
import { ReferenceChips } from "./Chips";
import { usePiloto } from "./context";

const MAX_HEIGHT = 240;

/** Lo que devuelve la app al subir un archivo: su URL (y su id, si lo guarda). */
export interface UploadResult {
  url: string;
  id?: string;
}

/** Un adjunto en la caja: un archivo por subir, o uno que ya viene listo (`att`, p. ej. de «Mis archivos»). */
type Pending = { id: number; name: string; mime: string; size?: number; url: string; file?: File; att?: Attachment };

/** Lo que se puede hacer con la caja desde afuera (`ctx.addAttachments`). */
export interface ComposerHandle {
  addAttachments: (items: (File | Attachment)[]) => void;
}

const BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
  pdf: "application/pdf",
  csv: "text/csv",
  txt: "text/plain",
  md: "text/markdown",
  json: "application/json",
};

/** El tipo del archivo, deducido del nombre cuando el navegador no lo dice (pasa más de lo que parece). */
export function mimeOf(file: File): string {
  if (file.type) return file.type;
  const ext = (file.name.match(/\.([A-Za-z0-9]+)$/)?.[1] || "").toLowerCase();
  return BY_EXTENSION[ext] ?? "application/octet-stream";
}

const isText = (mime: string) => mime.startsWith("text/") || mime === "application/json" || mime.endsWith("+json") || mime.endsWith("+xml");

function shortSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function readInline(file: File): Promise<Attachment> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => {
      const result = String(fr.result);
      const comma = result.indexOf(",");
      resolve({ name: file.name, mimeType: mimeOf(file), data: comma === -1 ? result : result.slice(comma + 1) });
    };
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(file);
  });
}

export interface ComposerProps {
  onSubmit: (text: string, attachments: Attachment[]) => void;
  onStop?: () => void;
  busy?: boolean;
  /** ¿Se puede mandar texto con el turno en vuelo? (el servidor lo mete al turno). Default sí. */
  canSteer?: boolean;
  placeholder?: string;
  initialValue?: string;
  autoFocus?: boolean;
  /** ¿El agente ve imágenes? Si no, el botón de imagen se apaga en vez de fingir. */
  canSeeImages?: boolean;
  /** Adjuntos: imágenes y texto viajan dentro del turno; lo demás se sube con `upload`. */
  attachments?: boolean;
  upload?: (file: File) => Promise<UploadResult>;
  /** Nota de voz: con esto aparece el micrófono. */
  transcribe?: (audio: Blob) => Promise<string>;
  /** Cómo viaja lo dicho (p. ej. con un envoltorio para el agente). Default: tal cual. */
  voiceNoteText?: (transcript: string) => string;
  models?: ModelOption[];
  currentModel?: string | null;
  onModelChange?: (value: string) => void;
  references?: Reference[];
  onRemoveReference?: (id: string) => void;
  onActivateReference?: (ref: Reference) => void;
  /** Botones propios entre la imagen y el clip. */
  extras?: ReactNode;
  /** Botones propios después del clip. */
  extrasEnd?: ReactNode;
  /** Para agregar adjuntos desde afuera. */
  handleRef?: Ref<ComposerHandle>;
  maxFiles?: number;
  maxFileMb?: number;
}

export function Composer({
  onSubmit,
  onStop,
  busy = false,
  canSteer = true,
  placeholder,
  initialValue = "",
  autoFocus = true,
  canSeeImages = true,
  attachments: withFiles = false,
  upload,
  transcribe,
  voiceNoteText,
  models = [],
  currentModel = null,
  onModelChange,
  references = [],
  onRemoveReference,
  onActivateReference,
  extras,
  extrasEnd,
  handleRef,
  maxFiles = 8,
  maxFileMb = 25,
}: ComposerProps) {
  const { strings: t } = usePiloto();
  const [value, setValue] = useState(initialValue);
  const [files, setFiles] = useState<Pending[]>([]);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const nextId = useRef(0);
  const urls = useRef(new Set<string>());

  const releaseUrl = (url: string) => {
    urls.current.delete(url);
    URL.revokeObjectURL(url);
  };

  // rAF es más confiable que autoFocus cuando el render cruza una frontera async.
  useEffect(() => {
    if (!autoFocus) return;
    const id = requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      // Sin desplazar la página: en un panel lateral, enfocar movía la app anfitriona (EasyBits).
      el.focus({ preventScroll: true });
      // Con texto inicial (una sugerencia a medias) el cursor va al FINAL.
      el.setSelectionRange(el.value.length, el.value.length);
    });
    return () => cancelAnimationFrame(id);
  }, [autoFocus]);

  useEffect(
    () => () => {
      for (const url of urls.current) URL.revokeObjectURL(url);
      urls.current.clear();
    },
    [],
  );

  // Crece con el contenido; vacío se queda en una línea.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!value) {
      el.style.height = "";
      return;
    }
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  }, [value]);

  const addFiles = useCallback(
    (list: FileList | File[]) => {
      if (busy) return;
      // Un archivo que se descarta EN SILENCIO se lee como «la aplicación no funciona».
      const rejected: string[] = [];
      setFiles((prev) => {
        const next = [...prev];
        for (const file of Array.from(list)) {
          const mime = mimeOf(file);
          if (file.size > maxFileMb * 1024 * 1024) {
            rejected.push(t.tooBig(file.name, maxFileMb));
            continue;
          }
          if (next.length >= maxFiles) {
            rejected.push(t.tooMany(maxFiles));
            break;
          }
          if (mime.startsWith("image/") && !canSeeImages) {
            rejected.push(t.cantSeeImage(file.name));
            continue;
          }
          if (!mime.startsWith("image/") && !isText(mime) && !upload) {
            rejected.push(t.cantUpload(file.name));
            continue;
          }
          const url = URL.createObjectURL(file);
          urls.current.add(url);
          next.push({ id: ++nextId.current, name: file.name, mime, size: file.size, url, file });
        }
        return next;
      });
      setNotice(rejected.length ? rejected.join(" · ") : null);
      ref.current?.focus({ preventScroll: true });
    },
    [busy, canSeeImages, upload, maxFiles, maxFileMb, t],
  );

  // Soltar archivos en CUALQUIER parte: la capa cubre la pantalla mientras se arrastra. Sólo si lo
  // que viene son ARCHIVOS (arrastrar texto dentro de la página no debe pintarla).
  useEffect(() => {
    if (!withFiles) return;
    let inside = 0;
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      inside++;
      if (!busy) setDragging(true);
    };
    const over = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      inside = Math.max(0, inside - 1);
      if (inside === 0) setDragging(false);
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      inside = 0;
      setDragging(false);
      if (e.dataTransfer?.files.length) addFiles(e.dataTransfer.files);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, [withFiles, busy, addFiles]);

  useImperativeHandle(
    handleRef,
    () => ({
      addAttachments: (items) => {
        const files = items.filter((x): x is File => typeof File !== "undefined" && x instanceof File);
        const ready = items.filter((x): x is Attachment => !(typeof File !== "undefined" && x instanceof File));
        if (files.length) addFiles(files);
        if (ready.length)
          setFiles((prev) => [
            ...prev,
            ...ready.slice(0, Math.max(0, maxFiles - prev.length)).map((att) => ({
              id: ++nextId.current,
              name: att.name ?? "archivo",
              mime: att.mimeType,
              url: att.url ?? (att.data ? `data:${att.mimeType};base64,${att.data}` : ""),
              att,
            })),
          ]);
        ref.current?.focus({ preventScroll: true });
      },
    }),
    [addFiles, maxFiles],
  );

  const removeFile = (id: number) =>
    setFiles((prev) => {
      const out = prev.find((a) => a.id === id);
      if (out?.file) releaseUrl(out.url);
      return prev.filter((a) => a.id !== id);
    });

  const submit = async () => {
    const body = value.trim();
    if (!body && files.length === 0 && references.length === 0) return;
    // Con un run en vuelo no se manda nada (AG-UI no mete mensajes a un run vivo): primero detener.
    if (busy && (files.length > 0 || !canSteer)) return;
    if (uploading) return;
    let atts: Attachment[] = [];
    if (files.length) setUploading(true);
    try {
      atts = await Promise.all(
        files.map(async (a) => {
          if (a.att || !a.file) return a.att!;
          const mime = a.mime;
          if (mime.startsWith("image/") || isText(mime)) return readInline(a.file);
          // Binario: se sube y viaja la URL (y su id); sin bytes en el turno.
          const up = await upload!(a.file);
          return { name: a.file.name, mimeType: mime, url: up.url };
        }),
      );
    } catch (e) {
      setNotice(e instanceof Error ? e.message : t.uploadFailed);
      return;
    } finally {
      setUploading(false);
    }
    onSubmit(body, atts);
    setValue("");
    setNotice(null);
    for (const a of files) if (a.file) releaseUrl(a.url);
    setFiles([]);
  };

  // ── Nota de voz ──────────────────────────────────────────────────────────────
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [wave, setWave] = useState<number[]>([]);
  const [seconds, setSeconds] = useState(0);
  const recRef = useRef<MediaRecorder | null>(null);
  const pieces = useRef<Blob[]>([]);
  const cancelRef = useRef(false);
  const meter = useRef<{ ctx: AudioContext; raf: number; timer: number } | null>(null);
  // Se decide DESPUÉS de montar: en el servidor no hay `window` (error de hidratación).
  const [hasMic, setHasMic] = useState(false);
  useEffect(() => setHasMic(typeof window !== "undefined" && "MediaRecorder" in window && Boolean(navigator.mediaDevices?.getUserMedia)), []);
  const canRecord = Boolean(transcribe) && hasMic;

  const toggleRecording = async () => {
    if (recording) {
      cancelRef.current = false;
      recRef.current?.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      pieces.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) pieces.current.push(e.data);
      };
      // La onda: el nivel RMS cada 80 ms. Dice «te estoy oyendo» sin mirar el reloj.
      const ctx = new AudioContext();
      const an = ctx.createAnalyser();
      an.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(an);
      const buf = new Uint8Array(an.fftSize);
      let lastTick = 0;
      const tick = (time: number) => {
        if (time - lastTick > 80) {
          lastTick = time;
          an.getByteTimeDomainData(buf);
          let acc = 0;
          for (let i = 0; i < buf.length; i++) {
            const v = (buf[i] - 128) / 128;
            acc += v * v;
          }
          setWave((w) => [...w.slice(-59), Math.min(1, Math.sqrt(acc / buf.length) * 4)]);
        }
        if (meter.current) meter.current.raf = requestAnimationFrame(tick);
      };
      const start = Date.now();
      meter.current = { ctx, raf: requestAnimationFrame(tick), timer: window.setInterval(() => setSeconds(Math.floor((Date.now() - start) / 1000)), 250) };
      rec.onstop = async () => {
        stream.getTracks().forEach((tr) => tr.stop());
        if (meter.current) {
          cancelAnimationFrame(meter.current.raf);
          clearInterval(meter.current.timer);
          void meter.current.ctx.close();
          meter.current = null;
        }
        setRecording(false);
        setWave([]);
        setSeconds(0);
        if (cancelRef.current) return;
        const type = rec.mimeType || mime || "audio/webm";
        const blob = new Blob(pieces.current, { type });
        if (blob.size < 1000) return; // un toque sin decir nada
        setTranscribing(true);
        try {
          const ext = type.includes("mp4") ? "m4a" : "webm";
          const name = `nota-de-voz-${new Date().toISOString().replace(/[:.]/g, "-")}.${ext}`;
          const [said, up] = await Promise.all([transcribe!(blob), upload ? upload(new File([blob], name, { type })) : Promise.resolve(null)]);
          const text = said.trim();
          if (!text) throw new Error(t.voiceEmpty);
          const atts: Attachment[] = up ? [{ name, mimeType: type, url: up.url }] : [];
          onSubmit(voiceNoteText ? voiceNoteText(text) : text, atts);
          setNotice(null);
        } catch (e) {
          setNotice(e instanceof Error ? e.message : t.voiceFailed);
        } finally {
          setTranscribing(false);
        }
      };
      recRef.current = rec;
      rec.start();
      setRecording(true);
    } catch {
      setNotice(t.micDenied);
    }
  };

  const canSend = Boolean(value.trim() || files.length > 0 || references.length > 0);

  // ── PORTADO de `ChatInputCard` + `ChatInput` de Ghosty Studio: mismo markup y clases. Lo que era
  // de Ghosty (biblioteca de archivos, programar, conectores, navegador, tareas, plan) va por `extras`.
  return (
    <div className="gc-input rounded-(--piloto-radius-input) border-(length:--piloto-border-width) border-outlines bg-(--piloto-composer-bg) shadow-(--piloto-shadow-input) transition-colors focus-within:border-brand-300">
      <div className={`flex flex-col gap-2 p-3 transition-shadow ${withFiles && dragging ? "rounded-2xl bg-background-secondary/40 ring-2 ring-inset ring-ring-info" : ""}`}>
        {withFiles && dragging && (
          <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-background-primary/80 p-6 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-2 rounded-3xl border-2 border-dashed border-brand-500 bg-background-primary px-10 py-8 text-center shadow-lg">
              <Paperclip className="size-7 text-brand-500" />
              <p className="text-base font-semibold text-text-primary">{t.dropFiles}</p>
              <p className="text-xs text-text-secondary">{t.dropHint}</p>
            </div>
          </div>
        )}
        <input
          ref={fileRef}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        {notice && <p className="text-xs text-text-danger">{notice}</p>}
        {uploading && (
          <p className="flex items-center gap-1.5 text-xs text-text-secondary">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {files.length > 1 ? t.uploadingN(files.length) : t.uploading}
          </p>
        )}
        {files.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {files.map((a) => (
              <div key={a.id} className="relative h-16 w-16 overflow-hidden rounded-lg border border-border-primary bg-background-secondary">
                {a.mime.startsWith("image/") && a.url ? (
                  <img src={a.url} alt={a.name} className="h-full w-full object-cover" />
                ) : (
                  // Un PDF pintado con <img> es un recuadro roto: nombre, extensión y peso.
                  <span className="flex h-full w-full flex-col items-center justify-center gap-1 px-1 text-center" title={a.name}>
                    <FileText className="h-4 w-4 shrink-0 text-text-tertiary" />
                    <span className="w-full truncate text-[9px] font-medium uppercase leading-none text-text-secondary">{a.name.match(/\.([A-Za-z0-9]+)$/)?.[1] ?? "file"}</span>
                    {a.size !== undefined && <span className="w-full truncate text-[9px] leading-none text-text-tertiary">{shortSize(a.size)}</span>}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => removeFile(a.id)}
                  aria-label={t.removeAttachment}
                  className="absolute top-0.5 right-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-background-inverse/80 text-text-inverse shadow-sm transition-colors hover:bg-background-inverse"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        <ReferenceChips references={references} onRemove={(id) => onRemoveReference?.(id)} onActivate={onActivateReference} />
        {recording ? (
          // Grabando: la barra sustituye al campo de texto — punto rojo, reloj, la onda y las dos salidas.
          <div className="flex min-h-[24px] items-center gap-3 px-1">
            <button
              type="button"
              onClick={() => {
                cancelRef.current = true;
                recRef.current?.stop();
              }}
              aria-label={t.cancelVoice}
              title={t.cancelVoice}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-text-secondary hover:bg-background-secondary hover:text-text-primary"
            >
              <X className="h-4 w-4" />
            </button>
            <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-red-500" />
            <span className="w-10 shrink-0 font-mono text-xs tabular-nums text-text-secondary">
              {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
            </span>
            <div className="flex h-6 min-w-0 flex-1 items-center gap-[2px] overflow-hidden">
              {Array.from({ length: 60 }, (_, i) => wave[wave.length - 60 + i] ?? 0).map((v, i) => (
                <span key={i} className="w-[3px] shrink-0 rounded-full bg-text-secondary/70" style={{ height: `${Math.max(3, Math.round(v * 22))}px` }} />
              ))}
            </div>
            <button
              type="button"
              onClick={toggleRecording}
              aria-label={t.stopAndSendVoice}
              title={t.send}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-500 text-white hover:bg-brand-600"
            >
              <ArrowUp className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <textarea
            ref={ref}
            rows={1}
            value={value}
            placeholder={placeholder}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void submit();
              } else if (e.key === "Backspace" && !value && references.length) {
                // Backspace con el texto vacío quita la última referencia.
                e.preventDefault();
                onRemoveReference?.(references[references.length - 1].id);
              }
            }}
            className="max-h-60 min-h-[24px] w-full flex-none resize-none overflow-y-auto bg-transparent px-1 text-sm leading-6 text-text-primary outline-none placeholder:text-text-tertiary"
          />
        )}
        <div className="flex items-center justify-between gap-2">
          <div className="@container flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
            {withFiles && (
              <>
                {/* Dos botones: «imagen» depende de que el modelo VEA; «archivo», no. */}
                <button
                  type="button"
                  onClick={() => {
                    if (!fileRef.current) return;
                    fileRef.current.accept = "image/*";
                    fileRef.current.click();
                  }}
                  disabled={busy || !canSeeImages || files.length >= maxFiles}
                  aria-label={canSeeImages ? t.attachImage : t.noImages}
                  title={canSeeImages ? t.attachImage : t.noImages}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-text-secondary transition-colors hover:bg-background-secondary hover:text-text-primary disabled:opacity-30"
                >
                  <ImageIcon className="h-4 w-4" />
                </button>
                {/* Lo propio de la app (en Ghosty, «Mis archivos») va entre imagen y archivo. */}
                {extras}
                <button
                  type="button"
                  onClick={() => {
                    if (!fileRef.current) return;
                    fileRef.current.accept = "";
                    fileRef.current.click();
                  }}
                  disabled={busy || files.length >= maxFiles}
                  aria-label={t.attachFile}
                  title={t.attachFile}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-text-secondary transition-colors hover:bg-background-secondary hover:text-text-primary disabled:opacity-40"
                >
                  <Paperclip className="h-4 w-4" />
                </button>
              </>
            )}
            {!withFiles && extras}
            {extrasEnd}
            {models.length > 0 && onModelChange && <ModelPicker models={models} current={currentModel} onChange={onModelChange} />}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {/* El micrófono junto a «Enviar», como en la app y en WhatsApp: es una forma de mandar. */}
            {canRecord && !recording && (
              <button
                type="button"
                onClick={toggleRecording}
                disabled={busy || transcribing}
                aria-label={t.recordVoice}
                title={t.voiceNote}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-text-secondary transition-colors hover:bg-background-secondary hover:text-text-primary disabled:opacity-40"
              >
                {transcribing ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <Mic className="h-4 w-4" />}
              </button>
            )}
            <button
              type="button"
              onClick={busy ? onStop : () => void submit()}
              disabled={(!busy && !canSend) || uploading}
              aria-label={busy ? t.stop : uploading ? t.uploading : t.send}
              className={`gc-send flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
                busy || canSend || uploading ? "bg-brand-500 text-white hover:bg-brand-600" : "bg-background-disabled text-text-disabled"
              }`}
            >
              {busy ? <Square className="h-3 w-3 fill-current" /> : uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * El selector de modelo. PORTADO de Ghosty (`ModelPicker.tsx`): dropdown discreto hacia arriba, sin
 * Radix; cierra con clic fuera y con Escape.
 */
export function ModelPicker({ models, current, onChange }: { models: ModelOption[]; current: string | null; onChange: (value: string) => void }) {
  const { strings: t } = usePiloto();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  if (models.length === 0) return null;
  const active = models.find((m) => m.value === current) ?? null;
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex max-w-56 items-center gap-1.5 rounded-full border border-border-primary px-2.5 py-1 text-xs text-text-secondary transition-colors outline-none hover:bg-background-secondary hover:text-text-primary"
      >
        <Cpu className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{active?.name ?? t.model}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-70" />
      </button>
      {open && (
        // Hacia ARRIBA: el selector vive pegado al borde inferior del input.
        <div className="absolute bottom-full left-0 z-20 mb-1 max-h-80 min-w-52 overflow-y-auto rounded-xl border border-border-primary bg-background-primary py-1 shadow-lg">
          {models.map((m) => (
            <button
              key={m.value}
              type="button"
              onClick={() => {
                onChange(m.value);
                setOpen(false);
              }}
              className="flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-xs text-text-secondary transition-colors hover:bg-background-secondary hover:text-text-primary"
            >
              <span className="truncate">{m.name}</span>
              {m.value === current && <Check className="h-3.5 w-3.5 shrink-0 text-text-success" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
