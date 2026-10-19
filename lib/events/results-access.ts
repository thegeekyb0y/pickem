type ResultsAccessEvent = {
  status: string;
  visibility: string;
  creatorUserId: string;
};

export type ResultsAccess = "public" | "private" | "locked" | "not-found";

export function resolveResultsAccess(
  event: ResultsAccessEvent,
  viewer: { userId?: string | null; passcodeUnlocked?: boolean } = {},
): ResultsAccess {
  if (event.status === "draft") {
    return viewer.userId === event.creatorUserId ? "private" : "not-found";
  }
  if (event.visibility === "passcode") {
    return viewer.passcodeUnlocked ? "private" : "locked";
  }
  return "public";
}
