-- 진도관리 앱 DB 스키마
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 Run 하세요.

-- 수업반 (예: 2-3반 국어)
create table if not exists classes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null,
  subject text not null,
  color text not null default '#4f7cff',
  sort int not null default 0,
  created_at timestamptz not null default now()
);

-- 교육과정: 단원 > 차시
create table if not exists curriculum_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  subject text not null,
  unit text not null default '',
  title text not null,
  seq int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists curriculum_items_subject_idx on curriculum_items (user_id, subject, seq);

-- 주간 시간표 (요일 1=월 ~ 5=금, 교시)
create table if not exists timetable_slots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  weekday int not null check (weekday between 1 and 7),
  period int not null check (period between 1 and 12),
  class_id uuid not null references classes on delete cascade,
  unique (user_id, weekday, period)
);

-- 날짜별 시간표 변경 (교체 · 보강 · 결강). class_id 가 비어 있으면 그 교시 수업 없음
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

-- 수업 기록 (진도)
create table if not exists lessons (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  class_id uuid not null references classes on delete cascade,
  date date not null,
  period int,
  curriculum_item_id uuid references curriculum_items on delete set null,
  memo text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists lessons_class_idx on lessons (class_id, date);
create index if not exists lessons_date_idx on lessons (user_id, date);

-- 수업 자료 (파일 또는 링크)
create table if not exists materials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null,
  kind text not null default 'file' check (kind in ('file', 'link')),
  storage_path text,
  url text,
  size bigint,
  mime text,
  subject text,
  created_at timestamptz not null default now()
);

-- 차시 <-> 자료 연결: 차시에 붙인 자료는 그 차시를 수업하는 모든 반에 보인다
create table if not exists item_materials (
  item_id uuid not null references curriculum_items on delete cascade,
  material_id uuid not null references materials on delete cascade,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  primary key (item_id, material_id)
);

-- 수업 기록 <-> 자료 연결: 특정 반 수업에만 붙인 자료
create table if not exists lesson_materials (
  lesson_id uuid not null references lessons on delete cascade,
  material_id uuid not null references materials on delete cascade,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  primary key (lesson_id, material_id)
);

-- 휴업일 / 수업 없는 날
create table if not exists days_off (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  date date not null,
  note text not null default '',
  unique (user_id, date)
);

-- 사용자 설정 (하루 교시 수 등)
create table if not exists settings (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  periods int not null default 7,
  weekdays int not null default 5
);

-- 행 단위 보안: 본인 데이터만 읽고 쓸 수 있음
do $$
declare t text;
begin
  foreach t in array array['classes','curriculum_items','timetable_slots','timetable_changes','lessons','materials','item_materials','lesson_materials','days_off','settings']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "own rows" on %I', t);
    execute format('create policy "own rows" on %I for all using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
  end loop;
end $$;

-- 여러 기기 실시간 동기화
do $$
declare t text;
begin
  foreach t in array array['classes','curriculum_items','timetable_slots','timetable_changes','lessons','materials','item_materials','lesson_materials','days_off','settings']
  loop
    begin
      execute format('alter publication supabase_realtime add table %I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- 파일 저장소: 비공개 버킷, 본인 폴더(사용자 id)만 접근
insert into storage.buckets (id, name, public)
values ('materials', 'materials', false)
on conflict (id) do nothing;

drop policy if exists "materials own folder" on storage.objects;
create policy "materials own folder" on storage.objects for all
  using (bucket_id = 'materials' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'materials' and (storage.foldername(name))[1] = auth.uid()::text);
