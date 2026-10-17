import { sql } from "drizzle-orm";

// These definitions are applied by the hand-authored follow-up SQL migration.
export const preventDeletingVotedOptionSql = sql`
  create or replace function prevent_deleting_voted_option()
  returns trigger as $$
  begin
    if exists (
      select 1 from votes
      where votes.option_id = old.id and votes.event_id = old.event_id
    ) or exists (
      select 1 from vote_picks
      where vote_picks.option_id = old.id and vote_picks.event_id = old.event_id
    ) then
      raise exception 'Cannot delete an option that has submitted picks';
    end if;

    if exists (
      select 1 from events
      where events.id = old.event_id
        and events.status <> 'draft'
        and events.pick_type = 'top_n'
        and events.max_picks > (
          select count(*) - 1 from options where options.event_id = old.event_id
        )
    ) then
      raise exception 'Cannot delete an option while the configured rank limit exceeds the remaining options';
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
    if old.is_submitted = false
      and new.is_submitted = true
      and row(
        new.id, new.event_id, new.option_id, new.voter_user_id,
        new.guest_session_id, new.guest_handle, new.guest_handle_platform,
        new.created_at
      ) is not distinct from row(
        old.id, old.event_id, old.option_id, old.voter_user_id,
        old.guest_session_id, old.guest_handle, old.guest_handle_platform,
        old.created_at
      ) then
      return new;
    end if;

    raise exception 'Submitted votes are immutable';
  end;
  $$ language plpgsql;

  drop trigger if exists prevent_updating_vote_trigger on votes;

  create trigger prevent_updating_vote_trigger
  before update on votes
  for each row
  execute function prevent_updating_vote();
`;

export const preventDeletingSubmittedVoteSql = sql`
  create or replace function prevent_deleting_submitted_vote()
  returns trigger as $$
  begin
    -- Permit cascades from deleting a whole event; otherwise a ballot is final.
    if pg_trigger_depth() = 1 then
      raise exception 'Submitted votes cannot be deleted';
    end if;
    return old;
  end;
  $$ language plpgsql;

  drop trigger if exists prevent_deleting_submitted_vote_trigger on votes;

  create trigger prevent_deleting_submitted_vote_trigger
  before delete on votes
  for each row
  execute function prevent_deleting_submitted_vote();
`;

export const preventMutatingVotePickSql = sql`
  create or replace function prevent_mutating_vote_pick()
  returns trigger as $$
  begin
    if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
      return old;
    end if;

    raise exception 'Submitted picks are immutable';
  end;
  $$ language plpgsql;

  drop trigger if exists prevent_updating_vote_pick_trigger on vote_picks;
  drop trigger if exists prevent_deleting_vote_pick_trigger on vote_picks;

  create trigger prevent_updating_vote_pick_trigger
  before update on vote_picks
  for each row
  execute function prevent_mutating_vote_pick();

  create trigger prevent_deleting_vote_pick_trigger
  before delete on vote_picks
  for each row
  execute function prevent_mutating_vote_pick();
`;

export const validateVoteShapeSql = sql`
  create or replace function validate_vote_shape()
  returns trigger as $$
  declare
    event_pick_type pick_type;
    event_max_picks integer;
    event_status event_status;
    opens_at timestamptz;
    closes_at timestamptz;
  begin
    select pick_type, max_picks, status, events.opens_at, events.closes_at
      into event_pick_type, event_max_picks, event_status, opens_at, closes_at
      from events where events.id = new.event_id;

    if not found then
      raise exception 'Question not found';
    end if;
    if event_status not in ('open', 'scheduled')
      or opens_at > now() or closes_at <= now() then
      raise exception 'Voting is not open';
    end if;

    if event_pick_type = 'single' then
      if new.option_id is null or new.is_submitted is not true then
        raise exception 'Single-choice ballots require one option';
      end if;
    else
      if new.option_id is not null or new.is_submitted is not false then
        raise exception 'Top-N ballots must be created pending with no single option';
      end if;
    end if;

    return new;
  end;
  $$ language plpgsql;

  drop trigger if exists validate_vote_shape_trigger on votes;
  create trigger validate_vote_shape_trigger
  before insert on votes
  for each row execute function validate_vote_shape();
`;

export const validateVotePickSql = sql`
  create or replace function validate_vote_pick()
  returns trigger as $$
  declare
    parent_submitted boolean;
    parent_event_id uuid;
    event_pick_type pick_type;
    event_max_picks integer;
  begin
    select votes.is_submitted, votes.event_id
      into parent_submitted, parent_event_id
      from votes where votes.id = new.vote_id;
    if not found or parent_submitted is not false then
      raise exception 'Picks can only be added while a ballot is being submitted';
    end if;
    if parent_event_id <> new.event_id then
      raise exception 'Pick and ballot must belong to the same question';
    end if;

    select pick_type, max_picks
      into event_pick_type, event_max_picks
      from events where events.id = new.event_id;
    if event_pick_type <> 'top_n' then
      raise exception 'Ranked picks are only valid for top-N questions';
    end if;
    if new.rank_position > event_max_picks then
      raise exception 'Rank exceeds the question maximum';
    end if;

    return new;
  end;
  $$ language plpgsql;

  drop trigger if exists validate_vote_pick_trigger on vote_picks;
  create trigger validate_vote_pick_trigger
  before insert on vote_picks
  for each row execute function validate_vote_pick();
`;

export const validateSubmittedBallotSql = sql`
  create or replace function validate_submitted_ballot()
  returns trigger as $$
  declare
    ballot_id uuid;
    ballot_event_id uuid;
    ballot_option_id uuid;
    ballot_submitted boolean;
    event_pick_type pick_type;
    event_max_picks integer;
    pick_count integer;
    min_rank integer;
    max_rank integer;
  begin
    if tg_table_name = 'votes' then
      ballot_id := new.id;
      ballot_event_id := new.event_id;
    else
      ballot_id := new.vote_id;
      ballot_event_id := new.event_id;
    end if;

    select is_submitted, option_id
      into ballot_submitted, ballot_option_id
      from votes where id = ballot_id;
    if not found then
      return null;
    end if;
    if ballot_submitted is not true then
      raise exception 'A ballot must be fully submitted before commit';
    end if;

    select pick_type, max_picks into event_pick_type, event_max_picks
      from events where id = ballot_event_id;

    select count(*)::integer, min(rank_position), max(rank_position)
      into pick_count, min_rank, max_rank
      from vote_picks where vote_id = ballot_id;

    if event_pick_type = 'single' then
      if ballot_option_id is null or pick_count <> 0 then
        raise exception 'Single-choice ballot must contain exactly one option';
      end if;
    else
      if ballot_option_id is not null or pick_count < 1 or pick_count > event_max_picks
        or min_rank <> 1 or max_rank <> pick_count then
        raise exception 'Top-N ballot must contain 1 to max_picks contiguous ranks';
      end if;
    end if;

    return null;
  end;
  $$ language plpgsql;

  drop trigger if exists validate_submitted_vote_trigger on votes;
  drop trigger if exists validate_submitted_vote_pick_trigger on vote_picks;

  create constraint trigger validate_submitted_vote_trigger
  after insert or update on votes
  deferrable initially deferred
  for each row execute function validate_submitted_ballot();

  create constraint trigger validate_submitted_vote_pick_trigger
  after insert on vote_picks
  deferrable initially deferred
  for each row execute function validate_submitted_ballot();
`;

export const validatePublishedTopNQuestionSql = sql`
  create or replace function validate_published_top_n_question()
  returns trigger as $$
  declare
    option_count integer;
  begin
    if new.pick_type = 'top_n' and new.status <> 'draft' then
      select count(*)::integer into option_count
        from options where options.event_id = new.id;
      if option_count < new.max_picks then
        raise exception 'Top-N maximum cannot exceed the number of question options';
      end if;
    end if;

    if tg_op = 'UPDATE'
      and (new.pick_type is distinct from old.pick_type or new.max_picks is distinct from old.max_picks)
      and exists (select 1 from votes where votes.event_id = new.id) then
      raise exception 'Pick type and maximum cannot change after ballots exist';
    end if;

    return new;
  end;
  $$ language plpgsql;

  drop trigger if exists validate_published_top_n_question_trigger on events;
  create constraint trigger validate_published_top_n_question_trigger
  after insert or update on events
  deferrable initially deferred
  for each row execute function validate_published_top_n_question();
`;
