import { sql } from "drizzle-orm";

export const preventDeletingVotedOptionSql = sql`
  create or replace function prevent_deleting_voted_option()
  returns trigger as $$
  begin
    if exists (select 1 from votes where votes.option_id = old.id) then
      raise exception 'Cannot delete an option that has votes';
    end if;

    return old;
  end;
  $$ language plpgsql;

  drop trigger if exists prevent_deleting_voted_option_trigger on options;

  create trigger prevent_deleting_voted_option_trigger
  before delete on options
  for each row
  execute function prevent_deleting_voted_option();
`;

export const preventUpdatingVoteSql = sql`
  create or replace function prevent_updating_vote()
  returns trigger as $$
  begin
    raise exception 'Votes are immutable';
  end;
  $$ language plpgsql;

  drop trigger if exists prevent_updating_vote_trigger on votes;

  create trigger prevent_updating_vote_trigger
  before update on votes
  for each row
  execute function prevent_updating_vote();
`;
