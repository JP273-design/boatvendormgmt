import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Uploaded documents go to Supabase Storage when it is configured.
 * Without it (local dev) we keep only the extracted fields, which is all the workflow needs.
 */
export async function storeFile(path: string, bytes: Buffer, contentType: string): Promise<string | null> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const bucket = process.env.SUPABASE_BUCKET || "vms-files";
  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const { error } = await supabase.storage.from(bucket).upload(path, bytes, { contentType, upsert: true });
  if (error) {
    console.error("storage upload failed", error.message);
    return null;
  }
  return `${bucket}/${path}`;
}
