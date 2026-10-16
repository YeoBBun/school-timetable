-- 날짜별 시간표 변경 기능 추가 (schema.sql 을 이미 실행한 경우 이 파일만 실행하세요)
create table if not exists timetable_changes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  date date not null,
  period int not null check (period between 1 and 12),
  class_id uuid references classes on delete cascade,
  note text not null default '',
  created_at timestamptz not null default now(),
  unique (user_id, date, period)
);

alter table timetable_changes enable row level security;
drop policy if exists "own rows" on timetable_changes;
create policy "own rows" on timetable_changes for all using (user_id = auth.uid()) with check (user_id = auth.uid());

do $$
begin
  alter publication supabase_realtime add table timetable_changes;
exception when duplicate_object then null;
end $$;
