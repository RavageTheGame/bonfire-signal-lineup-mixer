import type { Client } from "@notionhq/client";
import { randomUUID } from "node:crypto";
import { belongsToIssue } from "./issue-workflow";
import { GENERATION_REQUEST_PROPERTY, GENERATION_SECTIONS, type GenerationRequest } from "./generation-request";
import { PIECE_PROPS } from "./piece-schema";

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

export function parseIssueGenerationPayload(payload: unknown): GenerationRequest {
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || !("mode" in payload)) {
    throw new IssueGenerationError("Choose a valid Bonnie request");
  }
  const keys = Object.keys(payload);
  if (keys.length === 1 && (payload.mode === "initial" || payload.mode === "additive")) {
    return { mode: payload.mode };
  }
  if (!("section" in payload) || !isGenerationSection(payload.section)) {
    throw new IssueGenerationError("Choose a valid newsletter section");
  }
  if (keys.length === 2 && payload.mode === "section") {
    return { mode: "section", section: payload.section };
  }
  if (keys.length === 3 && payload.mode === "move" && "pieceId" in payload
    && typeof payload.pieceId === "string" && ISSUE_ID.test(payload.pieceId)) {
    return { mode: "move", pieceId: payload.pieceId, section: payload.section };
  }
  throw new IssueGenerationError("Choose a valid Bonnie request");
}

function isGenerationSection(value: unknown): value is keyof typeof GENERATION_SECTIONS {
  return typeof value === "string" && Object.hasOwn(GENERATION_SECTIONS, value);
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

function richText(value: unknown): string {
  if (!value || typeof value !== "object" || !("rich_text" in value) || !Array.isArray(value.rich_text)) return "";
  return value.rich_text.map((part) => {
    const text = part?.plain_text ?? part?.text?.content;
    return typeof text === "string" ? text : "";
  }).join("").trim();
}

function savedLineupProtectsPiece(value: unknown, pieceId: string): boolean {
  const lineup = richText(value);
  if (!lineup) return false;
  try {
    const { bigIdeaId, teamTakeIds, fieldNoteId } = JSON.parse(lineup);
    if (typeof bigIdeaId !== "string" || typeof fieldNoteId !== "string" || !Array.isArray(teamTakeIds)
      || !teamTakeIds.every((id) => typeof id === "string")) return true;
    return belongsToIssue([bigIdeaId, ...teamTakeIds, fieldNoteId], pieceId);
  } catch {
    return true;
  }
}

async function buildScopedRequest(
  notion: GenerationClient,
  request: Exclude<GenerationRequest, { mode: "initial" | "additive" }>,
  issue: { id: string; properties: IssueProperties },
  piecesDatabaseId?: string,
) {
  const requestId = randomUUID();
  if (request.mode === "section") return { ...request, requestId };
  if (!piecesDatabaseId) throw new IssueGenerationError("Connect Signal Pieces before moving an option", 503);

  const source = await notion.pages.retrieve({ page_id: request.pieceId });
  if (!("parent" in source) || source.parent.type !== "database_id"
    || !belongsToIssue([source.parent.database_id], piecesDatabaseId) || source.archived || source.in_trash) {
    throw new IssueGenerationError("Piece not found in Signal Pieces", 404);
  }
  const props = source.properties;
  const issueIds = PIECE_PROPS.relatedIssue.flatMap((name) => {
    const property = props[name];
    return property?.type === "relation" ? property.relation.map(({ id }) => id) : [];
  });
  if (!belongsToIssue(issueIds, issue.id)) throw new IssueGenerationError("Choose a Piece from the active issue", 409);

  const sourceSection = selectName(props[PIECE_PROPS.type]);
  const status = selectName(props[PIECE_PROPS.status]);
  if (!isGenerationSection(sourceSection) || status === "Archived") {
    throw new IssueGenerationError("Choose an available newsletter Piece", 409);
  }
  if (sourceSection === request.section) throw new IssueGenerationError("Choose a different destination section");
  const confidentiality = props["Confidentiality cleared"];
  const preserveSource = status !== "Draft" || Boolean(selectName(props[PIECE_PROPS.editorialDecision]))
    || (confidentiality?.type === "checkbox" && confidentiality.checkbox)
    || savedLineupProtectsPiece(issue.properties["Draft lineup"], source.id);
  return { ...request, pieceId: source.id, requestId, sourceEditedTime: source.last_edited_time, preserveSource };
}

/** Any saved mapping or prior-generation marker makes the request additive. */
export function issueHasGenerated(props: IssueProperties): boolean {
  return Boolean(richText(props["Draft lineup"]) || dateStart(props["Generated at"]));
}

/** Queue only the exact active Issue, by changing the same select as its Notion button. */
export async function queueIssueGeneration(
  notion: GenerationClient,
  issueId: string,
  request: GenerationRequest,
  issuesDatabaseId: string,
  piecesDatabaseId?: string,
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
    if ((request.mode === "initial" || request.mode === "additive")
      && (request.mode === "additive") !== issueHasGenerated(props)) {
      throw new IssueGenerationError("This issue changed. Refresh to see its current generation action.", 409);
    }
    const statusSchema = schema.properties[GENERATION_STATUS];
    const options = statusSchema?.type === "select" ? statusSchema.select.options
      : statusSchema?.type === "status" ? statusSchema.status.options : [];
    const queued = options.find((option) => option.name === "Queued");
    if (!queued || statusSchema.type !== generation.type) {
      throw new IssueGenerationError("Signal Issues needs its existing Queued generation option", 503);
    }
    const scopeReady = props[GENERATION_REQUEST_PROPERTY]?.type === "rich_text"
      && schema.properties[GENERATION_REQUEST_PROPERTY]?.type === "rich_text";
    let requestText = "";
    if (request.mode === "section" || request.mode === "move") {
      if (!scopeReady) throw new IssueGenerationError("Signal Issues needs its Generation request text property", 503);
      requestText = JSON.stringify(await buildScopedRequest(notion, request, issue, piecesDatabaseId));
    }
    // Scope and status change together so Bonnie reads the matching request. Clear old scope for full-issue runs.
    await notion.pages.update({
      page_id: issue.id,
      properties: {
        [GENERATION_STATUS]: generation.type === "select" ? { select: { id: queued.id } } : { status: { id: queued.id } },
        ...(scopeReady ? { [GENERATION_REQUEST_PROPERTY]: {
          rich_text: requestText ? [{ text: { content: requestText } }] : [],
        } } : {}),
      },
    });
    return "Queued";
  } finally {
    queuingIssues.delete(key);
  }
}
