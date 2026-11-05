/**
 * Persist the Notion access token so live Pieces survive redeploys.
 *
 * Order:
 * 1. Private Vercel Blob (BLOB_READ_WRITE_TOKEN) — no redeploy needed
 * 2. Optional Vercel env upsert + redeploy when VERCEL_TOKEN is present
 */

import { saveNotionTokenToBlob } from "./notion-token-store";

const PROJECT_ID = process.env.VERCEL_PROJECT_ID || "prj_u7CitNNjbGWUzUInWkPqBGhwyvkK";
const TEAM_ID = process.env.VERCEL_TEAM_ID || "team_R9mjmWCeQlqEAAjePyxZsGOI";
const REPO_ID = process.env.VERCEL_GIT_REPO_ID || "1398497420";

function vercelToken(): string | null {
  return process.env.VERCEL_TOKEN?.trim() || process.env.VERCEL_API_TOKEN?.trim() || null;
}

async function vercelFetch(path: string, init?: RequestInit) {
  const token = vercelToken();
  if (!token) throw new Error("Missing VERCEL_TOKEN for persisting Notion credentials");
  const url = new URL(`https://api.vercel.com${path}`);
  if (TEAM_ID) url.searchParams.set("teamId", TEAM_ID);
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`Vercel API ${res.status}: ${json?.error?.message || text.slice(0, 200)}`);
  }
  return json;
}

export async function persistNotionTokenToVercel(accessToken: string): Promise<{
  envUpserted: boolean;
  blobSaved: boolean;
  redeployId?: string;
}> {
  const blobSaved = await saveNotionTokenToBlob(accessToken).catch(() => false);

  if (!vercelToken()) {
    return { envUpserted: false, blobSaved };
  }

  // Upsert NOTION_TOKEN for production + preview
  await vercelFetch(`/v10/projects/${PROJECT_ID}/env`, {
    method: "POST",
    body: JSON.stringify({
      key: "NOTION_TOKEN",
      value: accessToken,
      type: "sensitive",
      target: ["production", "preview"],
      upsert: true,
    }),
  });

  // Redeploy from main so the new env is active
  const deployment = await vercelFetch("/v13/deployments", {
    method: "POST",
    body: JSON.stringify({
      name: "bonfire-signal-lineup-mixer",
      project: PROJECT_ID,
      target: "production",
      gitSource: {
        type: "github",
        repoId: String(REPO_ID),
        ref: "main",
      },
    }),
  });

  return {
    envUpserted: true,
    blobSaved,
    redeployId: deployment?.id || deployment?.uid,
  };
}
