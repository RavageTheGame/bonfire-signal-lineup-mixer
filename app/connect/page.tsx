"use client";

import { useState } from "react";
import "../mixer.css";

export default function ConnectNotionPage() {
  const [code, setCode] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  const exchange = async () => {
    const trimmed = code.trim();
    if (!trimmed) {
      setStatus("Paste the code from the Notion redirect URL first.");
      return;
    }
    setBusy(true);
    setStatus("Exchanging code…");
    try {
      const res = await fetch("/api/notion/oauth/exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: trimmed,
          redirectUri: "https://blackopsonly.com",
        }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || `HTTP ${res.status}`);
      const workspace = payload.workspaceName || payload.workspaceId || "Notion";
      setStatus(
        payload.persisted
          ? `Connected to ${workspace}. Token saved — redeploying. Open the mixer and Refresh now in about a minute.`
          : `Connected to ${workspace} for this instance. Ask ops to confirm NOTION_TOKEN is on Vercel if Refresh still shows Cached snapshot.`,
      );
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Exchange failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="app" style={{ maxWidth: 720 }}>
      <p className="eyebrow">Bonfire Signal</p>
      <h1>Connect Notion</h1>
      <p className="deck">
        This workspace cannot create classic Notion API keys, so the mixer uses a Notion OAuth
        public integration instead. After connecting, share the Signal Pieces database with the
        integration if Notion prompts you.
      </p>

      <section className="panel" style={{ marginTop: 24, padding: 20, maxHeight: "none" }}>
        <h2 style={{ marginTop: 0, fontSize: 16 }}>Option A — redirect to the mixer</h2>
        <p style={{ color: "var(--body-2)", fontSize: 14, lineHeight: 1.45 }}>
          In the Notion OAuth integration settings, add this redirect URI, then click Connect:
        </p>
        <p>
          <code style={{ fontSize: 12, wordBreak: "break-all" }}>
            https://bonfire-signal-lineup-mixer.vercel.app/api/notion/oauth/callback
          </code>
        </p>
        <p style={{ marginTop: 16 }}>
          <a className="action primary" href="/api/notion/oauth/start" style={{ textDecoration: "none" }}>
            Connect with Notion
          </a>
        </p>
      </section>

      <section className="panel" style={{ marginTop: 18, padding: 20, maxHeight: "none" }}>
        <h2 style={{ marginTop: 0, fontSize: 16 }}>Option B — paste code from blackopsonly.com</h2>
        <p style={{ color: "var(--body-2)", fontSize: 14, lineHeight: 1.45 }}>
          If Notion still redirects to <strong>blackopsonly.com</strong>, open this authorize link,
          finish the Notion prompt, then copy the <code>code</code> query param from the address bar
          and paste it below.
        </p>
        <p style={{ marginTop: 12 }}>
          <a
            className="action"
            style={{ textDecoration: "none" }}
            href={`/api/notion/oauth/start?redirect_uri=${encodeURIComponent("https://blackopsonly.com")}`}
          >
            Open Notion authorize (blackopsonly.com redirect)
          </a>
        </p>
        <label style={{ display: "block", marginTop: 18, fontSize: 13, fontWeight: 700 }}>
          Authorization code
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Paste code=… value here"
            style={{
              display: "block",
              width: "100%",
              marginTop: 8,
              padding: "10px 12px",
              border: "1px solid var(--rule-2)",
              borderRadius: 8,
              font: "inherit",
              fontSize: 14,
            }}
          />
        </label>
        <p style={{ marginTop: 14 }}>
          <button type="button" className="action primary" disabled={busy} onClick={() => void exchange()}>
            {busy ? "Connecting…" : "Exchange code"}
          </button>
          <a className="action" href="/" style={{ textDecoration: "none", marginLeft: 8 }}>
            Back to mixer
          </a>
        </p>
        {status ? (
          <p style={{ marginTop: 14, color: "var(--ember)", fontWeight: 700, fontSize: 13 }}>{status}</p>
        ) : null}
      </section>
    </main>
  );
}
