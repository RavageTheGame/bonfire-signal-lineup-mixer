export const GENERATION_SECTIONS = {
  "Big Idea": "The Bonfire View",
  "Team take": "From the Bonfire Team",
  "Field Notes": "Field Notes from the Portfolio",
} as const;

export type GenerationSection = keyof typeof GENERATION_SECTIONS;

export type GenerationRequest =
  | { mode: "initial" | "additive" }
  | { mode: "section"; section: GenerationSection }
  | { mode: "move"; pieceId: string; section: GenerationSection };

export const GENERATION_REQUEST_PROPERTY = "Generation request";
