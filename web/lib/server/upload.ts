import "server-only";
import { MAX_UPLOAD_BYTES, UPLOAD_MIME } from "../config";
import { sha256Hex } from "../hash";

export type Upload = { bytes: Buffer; mime: string; sha256: string };

/** Detects the real image type from the file's first bytes; the browser's label is not trusted. */
function sniff(b: Buffer): string | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (b.length > 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

/** Reads and validates the "file" part of a form. Returns an error message instead of throwing. */
export async function readUpload(form: FormData): Promise<Upload | string> {
  const file = form.get("file");
  if (!(file instanceof File)) return "No file was sent.";
  if (file.size === 0) return "The file is empty.";
  if (file.size > MAX_UPLOAD_BYTES) return "The file is larger than 5 MB.";
  const bytes = Buffer.from(await file.arrayBuffer());
  const mime = sniff(bytes);
  if (!mime || !UPLOAD_MIME.includes(mime)) return "Only JPEG, PNG or WebP images are accepted.";
  return { bytes, mime, sha256: await sha256Hex(bytes) };
}
