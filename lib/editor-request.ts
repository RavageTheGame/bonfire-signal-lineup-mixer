export class EditorRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function editorRequest(path: string, key: string, failure: string, body?: object) {
  const response = await fetch(path, {
    cache: "no-store",
    method: body ? "POST" : "GET",
    headers: { "X-Signal-Editor-Key": key, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = response.status === 401 ? "Enter a valid Signal editor key to continue."
      : typeof payload.error === "string" ? payload.error : failure;
    throw new EditorRequestError(message, response.status);
  }
  return payload;
}
