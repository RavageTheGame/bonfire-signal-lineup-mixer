import type { Client } from "@notionhq/client";

export type EditorialDecision = "" | "Keep" | "Banked" | "Ruled out";

const DECISIONS = ["Keep", "Banked", "Ruled out"] as const;

/** Missing metadata from older Pieces means the candidate is still available. */
export function normalizeEditorialDecision(value: unknown): EditorialDecision {
  return typeof value === "string" && (DECISIONS as readonly string[]).includes(value)
    ? (value as EditorialDecision)
    : "";
}

export function isAvailableCandidate(item: { editorialDecision?: string; status?: string }): boolean {
  const decision = normalizeEditorialDecision(item.editorialDecision);
  return item.status !== "Archived" && decision !== "Banked" && decision !== "Ruled out";
}

export class EditorialDecisionError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "EditorialDecisionError";
    this.status = status;
  }
}

export function validatePieceId(value: string): void {
  if (!/^(?:[\da-f]{32}|[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12})$/i.test(value)) {
    throw new EditorialDecisionError("Invalid piece id");
  }
}

/** Unlike display normalization, malformed write input must never clear a decision. */
export function parseDecisionPayload(payload: unknown): EditorialDecision {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new EditorialDecisionError("Expected a decision object");
  }
  const data = payload as Record<string, unknown>;
  if (Object.keys(data).length !== 1 || !Object.prototype.hasOwnProperty.call(data, "decision")) {
    throw new EditorialDecisionError("Provide only the decision property");
  }
  if (data.decision === null) return "";
  const decision = normalizeEditorialDecision(data.decision);
  if (!decision) throw new EditorialDecisionError("Decision must be Keep, Banked, Ruled out, or null");
  return decision;
}

export function isSameOriginRequest(origin: string | null, requestUrl: string): boolean {
  if (origin === null) return true;
  try {
    return new URL(origin).origin === new URL(requestUrl).origin && origin === new URL(origin).origin;
  } catch {
    return false;
  }
}

type DecisionWriteConfig = {
  piecesDatabaseId: string;
  issuesDatabaseId: string;
  props: { decision: string; status: string; type: string; relatedIssue: readonly string[] };
};

function sameId(first: string, second: string): boolean {
  return first.replace(/-/g, "").toLowerCase() === second.replace(/-/g, "").toLowerCase();
}

function selectName(property: any): string {
  if (property?.type === "select") return property.select?.name || "";
  if (property?.type === "status") return property.status?.name || "";
  return "";
}

/** Change only the editorial select on a current Signal Piece, never its approval or copy. */
export async function updateEditorialDecision(
  notion: Pick<Client, "pages" | "databases">,
  pageId: string,
  decision: EditorialDecision,
  config: DecisionWriteConfig,
): Promise<EditorialDecision> {
  validatePieceId(pageId);
  if (decision !== "" && !normalizeEditorialDecision(decision)) {
    throw new EditorialDecisionError("Invalid decision");
  }

  const page = await notion.pages.retrieve({ page_id: pageId });
  if (!("parent" in page) || page.parent.type !== "database_id"
      || !sameId(page.parent.database_id, config.piecesDatabaseId)
      || page.archived || page.in_trash) {
    throw new EditorialDecisionError("Piece not found in Signal Pieces", 404);
  }
  const props = page.properties as Record<string, any>;
  if (selectName(props[config.props.status]) === "Archived") {
    throw new EditorialDecisionError("Archived Pieces cannot be changed from the current mixer", 409);
  }
  if (!["Big Idea", "Team take", "Field Notes"].includes(selectName(props[config.props.type]))) {
    throw new EditorialDecisionError("This page is not a newsletter candidate", 409);
  }
  if (props[config.props.decision]?.type !== "select") {
    throw new EditorialDecisionError("Signal Pieces needs its Editorial decision select property", 503);
  }

  const issues = await notion.databases.query({
    database_id: config.issuesDatabaseId,
    filter: { property: "Active issue", checkbox: { equals: true } },
    page_size: 2,
  });
  if (issues.results.length !== 1) {
    throw new EditorialDecisionError("Select exactly one Active issue before changing a Piece", 409);
  }
  const issueId = issues.results[0].id;
  const belongs = config.props.relatedIssue.some((name) => {
    const property = props[name];
    return property?.type === "relation"
      && property.relation.some((relation: { id: string }) => sameId(relation.id, issueId));
  });
  if (!belongs) {
    throw new EditorialDecisionError("Piece does not belong to the active issue", 409);
  }

  await notion.pages.update({
    page_id: pageId,
    properties: { [config.props.decision]: { select: decision ? { name: decision } : null } },
  });
  return decision;
}
