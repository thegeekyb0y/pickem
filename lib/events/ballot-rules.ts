export type VoteWindowEvent = {
  status: string;
  opensAt: Date;
  closesAt: Date;
};

export function isVoteWindowOpen(event: VoteWindowEvent, dbNow: Date) {
  return (
    (event.status === "open" || event.status === "scheduled") &&
    event.opensAt <= dbNow &&
    event.closesAt > dbNow
  );
}
