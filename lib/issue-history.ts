import type { Client } from "@notionhq/client";
import { renderSavedDraftHtml } from "./blocks-to-html";
import { belongsToIssue } from "./issue-workflow";
import { IssueDraftError, locateIssueDraftRegion, readIssueDraftSnapshot } from "./issue-draft-writeback";
import type { IssueHistoryEntry, PiecesPayload } from "./types";

type Page = Extract<Awaited<ReturnType<Client["pages"]["retrieve"]>>, { properties: unknown }>;

function metadata(page: Page): IssueHistoryEntry {
  const props = page.properties;
  const title = Object.values(props).find((prop) => prop.type === "title");
  const statusProperty = props.Status;
  const status = statusProperty?.type === "select" ? statusProperty.select?.name ?? ""
    : statusProperty?.type === "status" ? statusProperty.status?.name ?? "" : "";
  const date = (key: string) => {
    const property = props[key];
    return property?.type === "date" ? property.date?.start ?? null : null;
  };

  return {
    id: page.id,
    name: title?.title.map((part) => part.plain_text).join("").trim() || "Untitled issue",
    url: page.url,
    status,
    targetSend: date("Target send"),
    sourceStart: date("Source start"),
    sourceEnd: date("Source end"),
    archived: /^(archive|archived)$/i.test(status),
  };
}

function isPastIssue(page: Awaited<ReturnType<Client["pages"]["retrieve"]>>, databaseId: string): page is Page {
  if (!("properties" in page) || page.archived || page.in_trash
    || page.parent.type !== "database_id" || !belongsToIssue([page.parent.database_id], databaseId)) return false;
  const active = page.properties["Active issue"];
  return active?.type === "checkbox" && !active.checkbox;
}

export async function listPastIssues(notion: Client, databaseId: string): Promise<IssueHistoryEntry[]> {
  const issues: IssueHistoryEntry[] = [];
  let cursor: string | undefined;
  do {
    const response = await notion.databases.query({
      database_id: databaseId,
      filter: { property: "Active issue", checkbox: { equals: false } },
      sorts: [{ property: "Target send", direction: "descending" }, { timestamp: "created_time", direction: "descending" }],
      start_cursor: cursor,
      page_size: 100,
    });
    for (const page of response.results) {
      if (page.object === "page" && isPastIssue(page, databaseId)) issues.push(metadata(page));
    }
    cursor = response.has_more ? response.next_cursor ?? undefined : undefined;
  } while (cursor);
  return issues;
}

export async function loadPastIssue(notion: Client, id: string, databaseId: string): Promise<PiecesPayload> {
  const page = await notion.pages.retrieve({ page_id: id });
  if (!isPastIssue(page, databaseId)) throw new IssueDraftError("This past issue is unavailable.", 404);

  const { name, ...issue } = metadata(page);
  let savedDraftHtml = "";
  try {
    const { blocks } = await readIssueDraftSnapshot(notion, page);
    savedDraftHtml = renderSavedDraftHtml(locateIssueDraftRegion(blocks).content);
  } catch (error) {
    // Older issues may use a different layout. Let the editor open them in Notion.
    if (!(error instanceof IssueDraftError) || error.status !== 409) throw error;
  }
  return {
    issue: { ...issue, title: name, active: false },
    savedDraftHtml,
    syncedAt: new Date().toISOString(),
    source: "notion-live",
    pieces: [],
  };
}
