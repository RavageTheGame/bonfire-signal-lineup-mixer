/**
 * Durable Notion access-token storage for serverless.
 *
 * Prefer env NOTION_TOKEN when present. Otherwise read/write a private
 * Vercel Blob object so OAuth survives redeploys without VERCEL_TOKEN.
 */

import { get, put } from "@vercel/blob";
import { resolveNotionToken, setRuntimeNotionToken } from "./notion-oauth";

const BLOB_PATH = "mixer/notion-access-token.txt";

function blobConfigured(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim());
}

export async function saveNotionTokenToBlob(accessToken: string): Promise<boolean> {
  if (!blobConfigured()) return false;
  const token = accessToken.trim();
  if (!token) return false;

  await put(BLOB_PATH, token, {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "text/plain; charset=utf-8",
    token: process.env.BLOB_READ_WRITE_TOKEN,
  });
  setRuntimeNotionToken(token);
  return true;
}

export async function loadNotionTokenFromBlob(): Promise<string | null> {
  if (!blobConfigured()) return null;
  try {
    const result = await get(BLOB_PATH, {
      access: "private",
      useCache: false,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
    if (!result?.stream) return null;

    const reader = result.stream.getReader();
    const chunks: Uint8Array[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
    const token = Buffer.concat(chunks.map((c) => Buffer.from(c)))
      .toString("utf8")
      .trim();
    if (!token) return null;
    setRuntimeNotionToken(token);
    return token;
  } catch {
    return null;
  }
}

/**
 * Resolve a usable Notion token: env -> runtime -> private blob.
 * Hydrates the in-process runtime cache when loading from blob.
 */
export async function ensureNotionToken(): Promise<string | null> {
  const fromEnv = process.env.NOTION_TOKEN?.trim();
  if (fromEnv) {
    setRuntimeNotionToken(fromEnv);
    return fromEnv;
  }

  const runtime = resolveNotionToken();
  if (runtime) return runtime;

  return loadNotionTokenFromBlob();
}
