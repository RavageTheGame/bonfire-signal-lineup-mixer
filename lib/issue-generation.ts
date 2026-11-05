import type { Client } from "@notionhq/client";
import { belongsToIssue } from "./issue-workflow";

type GenerationMode = "initial" | "additive";
type GenerationClient = Pick<Client, "databases" | "pages">;
type IssueProperties = Record<string, unknown>;

const GENERATION_STATUS = "Generation status";
const ISSUE_ID = /^(?:[\da-f]{32}|[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12})$/i;
const queuingIssues = new Set<string>();

export class IssueGenerationError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "IssueGenerationError";
    this.status = status;
  }
}

export function parseIssueGenerationPayload(payload: unknown): GenerationMode {
  if (payload && typeof payload === "object" && !Array.isArray(payload)
    && Object.keys(payload).length === 1 && "mode" in payload
    && (payload.mode === "initial" || payload.mode === "additive")) {
    return payload.mode;
  }
  throw new IssueGenerationError("Choose initial draft generation or more options");
}

function dateStart(value: unknown): string {
  if (!value || typeof value !== "object" || !("date" in value)) return "";
  const date = value.date;
  return date && typeof date === "object" && "start" in date && typeof date.start === "string" ? date.start : "";
}

function selectName(value: unknown): string {
  if (!value || typeof value !== "object" || !("type" in value)
    || (value.type !== "select" && value.type !== "status")) return "";
  const choice = (value as Record<string, unknown>)[value.type];
  return choice && typeof choice === "object" && "name" in choice && typeof choice.name === "string" ? choice.name : "";
}

function hasDraftLineup(value: unknown): boolean {
  return Boolean(value && typeof value === "object" && "rich_text" in value && Array.isArray(value.rich_text)
    && value.rich_text.some((part) => {
      const text = part?.plain_text ?? part?.text?.content;
      return typeof text === "string" && text.trim();
    }));
}

/** Any saved mapping or prior-generation marker makes the request additive. */
export function issueHasGenerated(props: IssueProperties): boolean {
  return hasDraftLineup(props["Draft lineup"]) || Boolean(dateStart(props["Generated at"]));
}

/** Queue only the exact active Issue, by changing the same select as its Notion button. */
export async function queueIssueGeneration(
  notion: GenerationClient,
  issueId: string,
  mode: GenerationMode,
  issuesDatabaseId: string,
): Promise<"Queued"> {
  if (!ISSUE_ID.test(issueId)) throw new IssueGenerationError("Invalid issue id");
  const key = issueId.replace(/-/g, "").toLowerCase();
  if (queuingIssues.has(key)) throw new IssueGenerationError("Generation is already being requested for this issue", 409);
  queuingIssues.add(key);
  try {
    const [active, schema] = await Promise.all([
      notion.databases.query({
        database_id: issuesDatabaseId,
        filter: { property: "Active issue", checkbox: { equals: true } },
        page_size: 2,
      }),
      notion.databases.retrieve({ database_id: issuesDatabaseId }),
    ]);
    if (active.results.length !== 1 || !belongsToIssue([active.results[0].id], issueId)) {
      throw new IssueGenerationError("Refresh the mixer and choose its active issue before generating", 409);
    }
    const issue = await notion.pages.retrieve({ page_id: issueId });
    if (!("parent" in issue) || issue.parent.type !== "database_id"
      || !belongsToIssue([issue.parent.database_id], issuesDatabaseId) || issue.archived || issue.in_trash) {
      throw new IssueGenerationError("Issue not found in Signal Issues", 404);
    }
    const props = issue.properties;
    const activeIssue = props["Active issue"];
    if (activeIssue?.type !== "checkbox" || !activeIssue.checkbox) {
      throw new IssueGenerationError("This issue is no longer active", 409);
    }
    if (props["Draft lineup"]?.type !== "rich_text") {
      throw new IssueGenerationError("Signal Issues needs its Draft lineup property", 503);
    }
    const generation = props[GENERATION_STATUS];
    if (generation?.type !== "select" && generation?.type !== "status") {
      throw new IssueGenerationError("Signal Issues needs its Generation status property", 503);
    }
    const status = selectName(generation);
    if (status === "Queued" || status === "Drafting") {
      throw new IssueGenerationError("Bonnie already has a generation request for this issue", 409);
    }
    if (!["", "Idle", "Ready", "Needs attention"].includes(status)) {
      throw new IssueGenerationError("This issue has an unsupported generation status", 409);
    }
    if (["Sent", "Posted", "Repurposing", "Archived"].includes(selectName(props.Status))) {
      throw new IssueGenerationError("Open an active draft issue to generate new material", 409);
    }
    const start = Date.parse(dateStart(props["Source start"]));
    const end = Date.parse(dateStart(props["Source end"]));
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) {
      throw new IssueGenerationError("Set a valid source date range in Notion before generating", 409);
    }
    if ((mode === "additive") !== issueHasGenerated(props)) {
      throw new IssueGenerationError("This issue changed. Refresh to see its current generation action.", 409);
    }
    const statusSchema = schema.properties[GENERATION_STATUS];
    const options = statusSchema?.type === "select" ? statusSchema.select.options
      : statusSchema?.type === "status" ? statusSchema.status.options : [];
    const queued = options.find((option) => option.name === "Queued");
    if (!queued || statusSchema.type !== generation.type) {
      throw new IssueGenerationError("Signal Issues needs its existing Queued generation option", 503);
    }
    // Both request modes use the native Queued trigger. Bonnie checks the issue's saved
    // draft and previous generation state before choosing her initial or additive workflow.
    await notion.pages.update({
      page_id: issue.id,
      properties: {
        [GENERATION_STATUS]: generation.type === "select" ? { select: { id: queued.id } } : { status: { id: queued.id } },
      },
    });
    return "Queued";
  } finally {
    queuingIssues.delete(key);
  }
}
