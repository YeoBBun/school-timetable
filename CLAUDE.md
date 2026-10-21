# CLAUDE.md — 인수인계 노트 (앱 이름: 수업관리, 예전 진도관리)

이 저장소에서 작업하는 Claude 에게 남기는 메모입니다. 사람용 사용 설명은 [README.md](README.md) 에 있습니다.

## 사용자
- 교사 1명(혼자 사용). PC 위주, 학교와 집에서 씁니다. 국어 101~105반을 가르칩니다.
- **한국어로 대화**하고, 전문 용어보다 **쉬운 말과 단계별 안내**를 좋아합니다. "뭘 하라는 거야?"라는 반응이 나오면 더 쉽게 다시 설명하세요.
- 사용자가 직접 해야 하는 일(구글 로그인, 콘솔 설정 등)은 누를 버튼 이름까지 짧게 알려 주세요.

## 프로젝트 한 줄 요약
반별 수업 관리(한 줄 진도 기록 · 반 메모 · 자료) + 교사 시간표를 다루는 **정적 웹앱**입니다(빌드 없음, 순수 HTML/CSS/ES 모듈).
**구글 로그인 + 구글 드라이브**에만 저장하고, 서버나 DB는 없습니다(예전에 쓰던 Supabase 는 제거했습니다).

## 구조
```
index.html, css/style.css
js/config.js        GOOGLE_CLIENT_ID (공개 값, 이미 입력됨)
js/google.js        Google Identity Services 토큰 로그인 + Drive v3 API (drive.file 권한만)
js/store.js         메모리 DB + 드라이브 저장/동기화 + 조회 도우미
js/app.js           로그인 화면, 메뉴, 화면 전환(hash 라우팅), 동기화 배지
js/ui.js            h() DOM 도우미, modal, toast, 날짜 함수
js/views/home.js    첫 화면: 오늘 시간표 + 담당 반 칸(단원 고르기, 한 줄 기록, 반 메모, 최근 기록)
js/views/records.js 기록 수정 · 반 메모 창 (공용)
js/views/classpage.js  #/class/<반id>/<탭> 반 화면 탭: records · students · assess · groups · stickers · seteuk
js/views/seteuk.js  과세특: 학생 한 명의 메모 · 수행평가 · 스티커 · 조 활동 · 이 반 수업을 모아 보고 초안 쓰기(seteuk 테이블), 초안 엑셀
js/views/seteukAI.js  과세특 'AI로 반 전체 초안' 화면 (항목마다 프롬프트 복사 → 결과 붙여넣기 → 검사)
js/seteukAI.js      과세특 AI 프롬프트 만들기 · 결과 읽기 · 겹침 검사 · 항목 문장 조립 (화면 없음)
js/standards.js     2022 개정 중학교 국어 성취기준 원문 45개(사용자가 준 원문). 다른 과목은 원문을 사용자에게 받아서 추가
js/views/students.js  학생 명단(직접 · 붙여넣기 · 나이스 엑셀), 학생 메모
js/views/assess.js  수행평가 메뉴 + 반 탭, 점수 표(Enter 로 다음 학생), 엑셀 내려받기
js/views/groups.js  조 편성: 무작위(섞어서 돌아가며 나눔) 또는 직접 짜기(빈 조 + '조 없는 학생', 눌러 고르고 조 누르기 · 끌어다 놓기)
js/views/stickers.js  칭찬 스티커 탭 + TV 보드(ui.tvOverlay)
js/views/schedule.js  일정 메뉴, 구글 캘린더 연결 카드
js/calendar.js      앱 → 구글 '수업관리' 캘린더 한 방향 동기화(gcal_map 테이블, 이 기기에서 바꾼 것만)
js/xlsx.js          SheetJS(cdnjs xlsx 0.18.5)를 필요할 때만 불러 엑셀 읽기 · 쓰기 (loadXLSX 는 hwpx 압축 풀기에도 씀). saveWorkbook(…, patchSheet) 는 시트 XML 을 고쳐 목록 고르기 · 틀 고정을 넣음(무료판이 못 써서)
js/gradebook.js     구글 시트 채점표: gradeSheetId · createGradeSheet · readGradeSheet(→ 바뀔 내용) · describeChange · hasResult
js/hwpx.js          한글 hwpx 의 표 → 칸 격자(rowAddr/colAddr · span, 메모(hp:ctrl) 글은 뺌)
js/evalplan.js      평가계획서 해석(parsePlan), 채점 계산(rubricResult · maxScore), '~함' 문장 바꾸기(toNoun), 확인 창용 한 줄 형식
js/views/planEditor.js  평가계획 확인 · 고치기 창(올린 직후 · 저장된 계획 고치기 둘 다)
js/views/search.js  찾기(기록 · 자료 · 메모 검색, 단원별 보기)
js/views/materials.js  자료 화면 + 업로드/첨부 공용 함수
js/views/timetable.js  설정의 '시간표 · 반' 탭 (보는 학기의 시간표 · 그 학년도 반, 다른 학기 시간표 가져오기)
js/views/terms.js   설정의 '학년도 · 학기 · 단원' 탭 (학기 목록, 2학기 시작일, 단원 여러 개 · 순서 · 다른 학기에서 복사)
js/views/settings.js  설정 화면 탭 묶음 + 기본 설정
serve.py            캐시 끈 로컬 서버 → http://localhost:5500
manifest.webmanifest, sw.js, icons/  휴대폰 '앱으로 설치'(PWA). sw.js 는 네트워크 먼저(업데이트 바로 반영), 안 될 때만 저장본 → 오프라인에서도 열림. 구글 요청은 건드리지 않음
```

### 데이터 저장 방식 (store.js)
- **앱 이름**(2026-10-20): '진도관리' → **'수업관리'**. 드라이브 폴더 · 데이터 파일 이름도 바뀜(2026-10-21 드라이브에서 확인 후 이름 바꾸기 코드 삭제). 저장소 이름 · 사이트 주소 · localStorage 키(jindo.*) · 구글 클라우드 프로젝트 이름은 그대로. 이미 만든 구글 캘린더 이름은 안 바꿈(새로 만들 때만 '수업관리').
- 모든 테이블을 드라이브 `수업관리/수업관리-데이터.json` **한 파일**에 저장합니다. 수업 자료 파일은 `진도관리/수업 자료/` 폴더에 둡니다.
- 테이블: classes, timetable_slots, timetable_changes, lessons, materials, lesson_materials, days_off, settings, units, class_notes, folders,
  students, student_notes, assessments, scores, groupings, stickers, events, gcal_map, seteuk, eval_plans
  (2026-10-21 뺀 표: curriculum_items · item_materials(예전 차시 목록), group_rules(짝 규칙). TABLES 에 없는 표는 다음 저장 때 드라이브 파일에서 빠짐. 예전 차시 제목은 `keepOldItemTitles()` 가 기록 memo 로 옮김)
- **학생**: year · grade · room · number · name · gender('M'|'F'|'') · sample(예전 시험용 예시 학생: 2026-10-21 `dropSampleStudents()` 가 드라이브를 읽은 뒤 지움 — 만들던 이름 그대로인 것만 지우고, 이름을 바꿔 쓴 학생은 표시만 뗌. 모든 기기에서 한 번씩 돈 뒤엔 이 함수도 지워도 됨). 반-과목이 아니라 학년도+학년+반 단위라 국어 · 독서 반이 같은 명단을 씀(`studentsOf(cls)`). 나이스 엑셀은 `parseRoster()` 가 '번호' 또는 '반/번호'(예: '1/12') + '성명/이름' 칸이 있는 줄을 제목 줄로 보고 읽음(학년 · 반 칸이 있으면 그 반만). **실제 나이스 과세특 일괄입력 양식으로 확인함(2026-10-20, 25명).** 학생개인번호는 저장하지 않음.
- **수행평가**: assessments(year · semester · subject · grade · title · max_score · dates{반id: 날짜} · note · period · area · standards[] · points · weight · **kind** · **rubric**), scores(assessment_id+student_id · score · grade · checks{기준 번호: true|점수} · special · **note(관찰 메모)**). kind: plain(점수 입력) · count(요소 개수 → 점수 표) · criteria(기준별 수준 점수 합) · grade(등급 A~E + 등급별 성취수준 기술, 세부 기준 합으로 등급 자동). 결과 계산은 `rubricResult()`.
- **평가계획서(hwpx)**(2026-10-20 사용자 학교 양식으로 확인): 수행평가 메뉴 '📄 평가계획서 올리기' → `readHwpxTables` → `parsePlan` → 확인 · 고치기 창 → '앱에 반영'. 표 머리글로 찾음: '학기 단위 성취수준'(→ eval_plans.levels A~E), '평가방법 및 내용'+'성취기준'(연간 계획: 수행 · 과정평가만), '세부평가기준'+'배점'(점수형: ①… 요소면 count, 아니면 criteria, 결시 · 표절은 specials), '등급'+'성취수준기술'(등급형). 다시 올리면 이름 → 학기 · 시기 · 방식이 같은 기존 평가를 고침(앱에서 고친 이름 유지, 결과 유지). 이번 학기(1학년 2학기)는 자유학기 과정평가라 점수보다 **등급 · 관찰 메모** 중심(사용자 요청). 학교 양식은 해마다 거의 같다고 함.
- **eval_plans**: year · semester · subject · grade · levels{A~E: 학기 단위 성취수준}. `S.planOf(term, subject, grade)`.
- **조 편성**: groupings(class_id · name · date · groups[[학생id]]). 조 수/인원을 정하고 **무작위로 짜기 / 직접 짜기** 두 가지만(2026-10-21 사용자 요청으로 짝 규칙 · 지난 조 겹침 · 조장 · 성별 고르게 · 빠지는 학생 삭제, 예전 행의 leaders 는 무시). 조 없는 학생은 저장할 때 빠짐. 저장 전 결과는 groups.js 의 states(메모리)에만 있음.
- **나이스 과세특 일괄입력 양식**(2026-10-20 사용자 파일로 확인): 시트 하나(이름 = 과목명), 1행 제목 `학년도 | 학기 | 학년 | 반/번호 | 학생개인번호 | 성명 | 과목명 | 세부능력 및 특기사항`, 한 반씩, 모든 칸 텍스트 서식('@'). 과세특 탭 '나이스 양식에 채우기'(`fillNeisForm`)가 올린 양식의 세특 칸에만 초안을 넣어 `원래이름_초안채움.xlsx` 로 내려줌(학년도 · 학년 · 반 · 번호로 찾고 이름이 같을 때만). 실제 파일 · 학생 이름은 저장소에 두지 말 것.
- 수행평가 나이스 양식: 사용자가 이번 학기는 1학년 자유학기라 **내년에** 하기로 함.
- **채점표 형식**(구글 시트로 바꿔 올리는 xlsx. 2026-10-21 사용자 요청으로 엑셀 파일 내려받기 · 올리기는 삭제, 구글 시트만): 평가 화면 · 반 표의 '📊 구글 시트로 채점'. 첫 시트 '채점 기준'(원문 · 등급표 · 쓰는 법) + 반마다 시트(이름 = classLabel). 1행 제목(맨 오른쪽 **숨긴 칸**에 `jindo:평가id:반id`), 2행 안내, 3행 머리글, 4행부터 학생, 아래 평균 · 등급별 인원. 기준 칸은 ①② 로 시작(올릴 때 이걸로 칸을 찾음), 목록 고르기(dataValidation)와 칸 설명(prompt), 점수 · 합계 · 최종 등급은 엑셀 수식(열 때 다시 계산). 앱 값을 미리 채움(등급은 직접 고른 것만). 가져오기: 번호+이름이 둘 다 맞는 학생만, **빈칸은 앱 값 유지**(요소 개수형은 그 줄에 하나라도 적혀 있으면 요소를 새로 정함), 목록 밖 값은 넣지 않고 미리보기 창에 표시, 다른 평가 파일이면 막음. 점수 · 등급은 rubricResult 로 다시 계산. 문서 속성(Custprops)은 SheetJS 가 한글을 깨뜨리고 다른 프로그램이 지워서 쓰지 않음.
- **구글 시트 채점표**(2026-10-20 사용자 요청: 엑셀 파일 유실 걱정): 평가 화면 '📊 구글 시트로 채점' → 같은 채점표 xlsx 를 드라이브 `수업관리/채점표/{year}학년도 {n}학기/` 에 **구글 시트로 바꿔 업로드**(google.js createSheetFromXlsx, mimeType google-apps.spreadsheet) → assessments.**sheet_id**, 새 탭으로 열기(팝업 차단 피하려고 클릭 순간 빈 탭을 먼저 연다). 다시 누르면 같은 시트(휴지통 · 404 면 새로 만듦). '📥 시트에서 가져오기' = exportXlsx(files.export → xlsx) → readGradebook → 같은 미리보기. '시트 새로 만들기' 는 예전 시트를 휴지통으로. drive.file 권한만으로 됨(앱이 만든 파일). 자동 동기화는 안 함(사용자 동의: 다 채점한 뒤 가져오기 한 번). **실제 구글에서 목록 고르기 · 수식이 바뀐 시트에 그대로 남는지 아직 확인 못 함.**
- **과세특 AI 초안**(2026-10-21 사용자 요청, school-gwasetuk '과세특 작업대'(사용자의 다른 저장소)에서 실제로 돌려 보고 다듬은 방식을 가져옴):
  - **학기마다 하나**(사용자: 과세특은 학기마다 씀). 보는 학기(왼쪽 위)를 따름. **자유학기는 모든 학생, 일반 학기는 학급마다 20% 이상** 써야 함(사용자 학교 기준) → settings.free_terms ['2026-2-1'(학년도-학기-학년)], `S.isFreeTerm` · `S.seteukRequired`, 과세특 화면 위 '자유학기' 체크와 '작성 n/m명' 배지.
  - 항목 = 수행평가(중심) → 정기시험(덧붙임, eval_plans.exams [{title, standards}], 평가계획서 연간 표의 지필 줄에서 읽거나 '평가계획 확인 · 고치기'에서 입력) → '종합 · 성장'(이 학기 수행평가 결과를 시간 순으로 + 학기 단위 성취수준 + 학생 메모). 길이 몫 비율 수행평가 3 : 종합 2 : 정기시험 1(사용자: 수행평가 위주, 시험은 추가 정도). 성취기준은 **수행평가 · 정기시험에 쓰인 것만**(사용자 결정).
  - 항목 하나 = 프롬프트 하나, 학생은 학번(학년+반 2자리+번호 2자리)|성취도|관찰. **이름은 안 보냄**, 메모 속 그 학년도 학생 이름은 ○○로 가림. 정기시험의 성취도는 학생별 학기 단위 성취수준(seteuk.level)을 씀.
  - 출력 '학번|문장' 을 붙여넣으면 parseResult → seteuk.parts{항목 key: 문장}. 초안 = 항목 순서대로 이어 붙임(assemble). 초안이 비었거나 이어 붙인 그대로일 때만 새로 조립하고, 선생님이 고친 초안(seteuk.edited=true)이나 직접 쓴 글은 덮어쓰지 않음, '고친 것 되돌리기'로 다시 조립.
  - 길이: 나이스 칸은 바이트(UTF-8, 한글 3 · 공백 · 부호 1, 줄바꿈은 2로 넉넉히). 항목당 몫 = (전체 1500 − 직접 쓸 몫 300) ÷ 항목 수, 프롬프트에는 자 수(÷3)로 상한과 하한(95%)을 함께 줌(상한만 주면 훨씬 짧게 씀).
  - 프롬프트 규칙은 gwasetuk 에서 겪은 것: 명사형 종결을 (X)/(O) 예로(존댓말로 씀), 소재 지어내기 금지를 어긴 예로(축구 · 급식), 첫 어절 겹침 금지 + 앱에서 **앞 두 어절**로 겹침 검사, 한 번에 몇 명씩(기본 25) 설정.
  - 설정은 settings.seteuk_ai{bytes, reserve, chunk, growth}.
- **과세특 초안**: seteuk(student_id · year · **semester** · subject · text · level(학기 단위 성취수준 A~E) · parts · edited), 기본키 student_id+year+semester+subject, `S.seteukOf(학생id, term, 과목)` · `S.saveSeteuk`. 예전 학년도 단위 행(semester 없음)은 `splitSeteukBySemester()` 가 드라이브를 읽은 뒤 학기 행으로 나눔(글 · 항목 문장은 그 학년도 지금 학기로, levels{학기}는 그 학기 행의 level 로). 나이스 양식 채우기는 양식의 '학기' 칸을 따름. '✨ 초안 재료 넣기'(`draftMaterial`): 평가마다 "'평가 이름'에서 (등급의 성취수준 기술 또는 충족한 기준을 '~함' 체로). (관찰 메모)." + 그 해 이 과목 학생 메모. AI 가 쓰는 게 아니라 규칙으로 조립(사용자 동의). 칸을 벗어날 때(change) 저장, 저장 전 글은 seteuk.js 의 drafts. 글자 수와 나이스 방식 바이트(한글 3, 영문 · 숫자 · 공백 1, 줄바꿈 2)를 보여 줌(한도는 강제하지 않음).
- **반 메모 vs 학생 메모**(사용자 설명): 반 메모 = 그 반 전체에 대한 것(숙제, 걷을 활동지 등), 학생 메모 = 그 학생의 특이 행동 · 관찰.
- **반 메모 · 학생 메모 날짜**: class_notes.date · student_notes.date ('YYYY-MM-DD', 기본 오늘). 예전 반 메모는 `noteDate()` 가 created_at 을 로컬 날짜로 바꿔 씀. 학생 표의 메모 칸에 '📝 메모 쓰기' 버튼 + 최근 메모(날짜).
- **칭찬 스티커**: stickers(class_id · student_id · date · reason · n). 학기마다 셈. 이유 버튼은 settings.sticker_reasons.
- **기능 켜고 끄기**(2026-10-21 사용자 요청): settings.features{schedule · search · stickers}, `S.feature(key)`(기본: 일정 · 찾기 꺼짐, 스티커 켜짐). 끄면 화면에서만 숨김(데이터 유지). 일정 · 찾기는 메뉴에서 빠지고 주소로 와도 홈(app.js ROUTES 의 feature), 일정을 끄면 홈의 '다가오는 일정' 줄도 숨기고 반 칸에는 수행평가만. 스티커를 끄면 홈 버튼 · 반 탭 · 학생 표 칸 · 과세특 카드 숨김.
- **일정**: events(date · title · class_id · note) + 수행평가 날짜 → `S.agenda(from, to)`. 구글 캘린더는 scope `calendar.app.created`(앱이 만든 캘린더만), settings.gcal_id. 사용자가 콘솔에서 Calendar API 사용 + 범위 추가를 해야 함(아직 안 함).
- **학년도 · 학기**: `termOf(날짜)` — 3월 시작, 1~2월은 앞 학년도 2학기, 2학기 시작일은 settings.sem2_start('MM-DD', 기본 '08-01'). 반은 `year` 를 가지며(없으면 created_at 으로 계산) 첫 화면에는 그 학년도 반만 나옵니다. 단원(units)은 year+semester 마다.
- **반(classes)**: grade · room · subject · year. 화면 이름은 `S.classLabel(c)` = '1학년 1반' (그 학년도 과목이 2개 이상이면 '1학년 1반 독서'). `name` 은 같은 글을 저장해 두는 예비값. (예전 '101반' 이름을 나누던 migrate() 는 2026-10-21 삭제) 같은 반이라도 과목이 다르면 반을 따로 만듭니다(국어 · 독서). 정렬은 과목 → 학년 → 반.
- **단원(units)**: year · semester · subject 마다. `unitsOf(term, subject)`.
- **기록(lessons)**: memo = 한 줄 내용, unit_id = 단원. 교시는 그날 시간표에서 아직 기록 없는 첫 교시를 자동으로(`freePeriod`).
- **자료 폴더**: `materialFolder()` 가 `수업 자료/{year}학년도/{n}학기/{과목}/{단원}/{수업|평가}` 를 만들고 id 를 folders 테이블(key: 'y:2026', 's:2026:2', 'j:2026:2:국어', 'u:단원id', 'p:단원id:lesson|eval')에 저장해 기기끼리 공유합니다. 처음 쓸 때 휴지통 여부를 확인하고, 지워졌으면 다시 만듭니다. 단원 이름을 바꾸면 폴더 이름도, 자료의 단원/구분을 바꾸면 파일도 옮깁니다(google.js renameFile/moveFile).
- 화면 코드는 `S.db.from(table).insert/update/upsert/delete().eq/in/match` 같은 **supabase-js 비슷한 체인**을 씁니다. 메모리에서 바로 실행되고, 저장은 0.7초 디바운스로 묶여 드라이브에 씁니다.
- **기기 간 병합**: 행마다 `_u`(마지막 수정 ms)를 두고, 지운 행은 `tomb[table][key] = 지운 시각`으로 기억합니다(90일 보관). 저장 직전 드라이브 파일 version 이 바뀌어 있으면 먼저 합치고 씁니다. 30초 폴링과 창 포커스 때도 확인합니다.
- 기본키가 id 가 아닌 테이블: item_materials(item_id, material_id), lesson_materials(lesson_id, material_id), settings(user_id), folders(key), scores(assessment_id, student_id), gcal_map(key). user_id 는 항상 `'me'` 입니다.
- **화면 다시 그리기**: 데이터가 바뀌면 app.js 가 setTimeout 0 으로 모아서 그립니다. `data-fk` 가 붙은 입력칸에 커서가 있으면 다시 그린 뒤 같은 칸에 커서를 돌려놓습니다(표에서 Tab · Enter 로 이어 입력).
- 삭제 연쇄(cascadeDelete): 반 → 시간표·변경·수업기록·반 메모·스티커·조·일정, 학생 → 메모·점수·스티커·과세특, 수행평가 → 점수, 수업기록 → lesson_materials, 자료 → 연결들, 단원 → 기록·자료의 unit_id 를 null 로.
- **브라우저 사본(빠른 시작)**: 마지막 데이터와 드라이브 파일 id 를 localStorage `jindo.cache` 에 둡니다. 켜면 사본으로 화면부터 그리고(배지 "연결 중…"), `loadAll()` 이 드라이브 파일을 읽어 `applyRemote` 로 합칩니다. 아는 파일 id 가 있으면 요청 2번(fileMeta → readJson), 없으면 폴더 찾기부터 합니다. 사본의 `dirty` 가 true 면 합친 뒤 저장합니다. 60일 넘은 사본은 버립니다(지운 기록 90일보다 짧게). 로그아웃하면 지웁니다. 토큰이 만료돼도 사본이 있으면 로그인 화면 대신 앱을 보여 주고 배지에 **다시 연결**을 띄웁니다.
- 로그인 토큰은 약 1시간 동안 localStorage 에 둡니다. 만료되면 AuthError → 배지에 **다시 연결** 버튼이 뜨고, 누르면 `S.resume()` 으로 밀린 저장을 이어서 합니다.

### 주요 기능 규칙
- **보는 학기(엑셀 시트처럼)**: 왼쪽 위 학기 고르기 → `S.setViewTerm(t)` 가 `S.view.date`(홈 날짜)를 그 학기 안(오늘 또는 첫 평일)으로 옮김. `S.viewTerm()` = termOf(view.date). 홈 · 수업 자료 · 수행평가 · 시간표 · 반 화면 탭(수행평가 · 스티커)이 이 학기를 따름. 지금 학기가 아니면 화면 위에 띠. 학기 목록은 `S.allTerms()`(데이터 있는 학기 + 지난 · 이번 · 다음 학기). 새로 고치면 오늘로 돌아감.
- **학기별 시간표**: timetable_slots 에 year · semester (`S.slotsOf(term)`, 학기 없는 아주 예전 칸은 모든 학기에 보임). 학년도가 다른 학기에서 가져오면 학년 · 반 · 과목이 같은 반으로 옮겨 칠함.
- **메뉴**(2026-10-17 사용자 요청): 홈(#/today) · 수업 자료 · 수행평가 · 일정 · 찾기 · 설정 (일정 · 찾기는 설정에서 켤 때만). 시간표 · 반은 설정 안의 탭(#/settings/timetable, 예전 #/timetable 도 열림). 홈의 반 칸 맨 위 큰 '반 이름 + 반 관리 ›' 이 반 화면으로 가는 입구.
- **첫 화면**(#/today): 위에 그날 시간표(`S.effectiveSlots` = 주간 시간표 + timetable_changes, class_id null 이면 결강), 아래에 담당 반 칸. 칸마다 단원 선택(기본: 그 반이 이번 학기 마지막으로 쓴 단원), 한 줄 입력(Enter, 한글 조합 중 Enter 는 무시), 반 메모. 기록은 **고른 날짜의 것만** 입력칸 바로 아래에 보이고, 그 전 수업은 입력칸 위에 '지난 수업 10/16 · …' 한 줄만(2026-10-20 사용자 요청: 누적 목록은 길어져서 싫다고 함). 전체 기록은 반 관리 → 수업 기록. 기록에 파일을 끌어다 놓으면 `attachDialog(lesson, files)`.
- **자료는 기록에 붙입니다**(lesson_materials). 같은 자료를 여러 반에 쓰면 연결만 여러 개.
- **시간표**: 위에서 반(붓)을 고르고 칸을 클릭하거나 드래그해서 칠합니다(pointer 이벤트).
- **휴대폰**(2026-10-20 사용자: 안드로이드, 인터넷 앱 탭으로 여는 게 거슬림): 앱으로 설치(PWA, display standalone). 700px 이하에서 메뉴는 아래 탭, 위에는 앱 이름 · 학기 · 저장 상태(다시 연결 버튼), 창은 아래에서 올라옴. 토큰 1시간 만료는 서버가 없어 그대로(다시 연결 한 번).
- 화면 갱신: 다른 기기에서 온 변경(remote)은 사용자가 입력 중이거나 모달이 열려 있으면 미뤘다가 반영합니다.

## 현재 상태 (2026-10-16 기준)
- main 브랜치에 모든 작업이 합쳐져 있고(GitHub PR 로 병합), 로컬 PC 에서 실제 구글 로그인 · 드라이브 저장 · 파일 업로드까지 확인했습니다.
- 사용자 드라이브에 101~105반(국어)과 주간 시간표 20칸이 이미 저장되어 있습니다.
- OAuth 앱은 **테스트 모드**이고, 테스트 사용자는 사용자 본인 Gmail 하나입니다. 승인된 JavaScript 원본: `http://localhost:5500`, `https://yeobbun.github.io`.
- 노션에도 비슷한 구조의 비공개 페이지 "진도관리 (노션 버전)"를 만들어 두었습니다(비교용, 이 저장소와 연결 안 됨).

## 남은 일 / 사용자에게 제안해 둔 것
1. **보안 보강** — 끝남
   - 링크 주소 검사: linkDialog · editDialog 둘 다 `normalizeUrl()` 로 `http(s)://` 가 아니면 `https://` 를 붙입니다.
   - 공용 PC 모드: 사용자가 학교 PC도 혼자 쓴다고 해서 **만들지 않기로** 했습니다.
2. **GitHub Pages 배포** — 사용자가 켰습니다(main, `/ (root)`). 주소: `https://yeobbun.github.io/school-timetable/`. main 에 합치면 몇 분 뒤 반영됩니다.
3. **반별 수업관리 앱으로 개편** (사용자 요청, 2026-10-17)
   - 1단계 끝: 첫 화면(오늘 시간표 + 담당 반), 한 줄 기록, 반 메모, 찾기, 자료 자동 폴더 정리, 학년도·학기.
   - 2단계 대부분 끝(2026-10-17, 예시 학생으로 시험): 학생 명단 · 학생 메모 · 수행평가 · 조 편성 · 칭찬 스티커 · 일정/캘린더 코드.
     남은 것: 실제 나이스 명렬표로 parseRoster 확인, 나이스 수행평가 일괄 입력 양식 채우기, 사용자의 캘린더 콘솔 설정 후 실제 연결 확인.
   - 2단계 원래 계획(나이스 파일 견본 필요, 사용자가 월요일에 올려 주기로 함): 학급 명렬표 엑셀을 올리면 학생 목록 생성, 학생 메모, 수행평가 점수 입력 → **나이스에서 받은 양식에 점수를 채워** 일괄 입력용 엑셀 내려받기, 조 편성, 칭찬 스티커(가칭).
     - 학생은 반-과목이 아니라 **학년도 + 학년 + 반** 단위로 두어 국어 · 독서 반이 같은 명단을 쓰게 할 것.
     - 조 편성: "경우의 수를 다 반영" — 무작위, 특정 학생끼리 붙이기 / 떼어 놓기, 조 수 또는 조 인원, 성별 · 수준 고르게, 조장 지정, 손으로 옮기기(끌어다 놓기), 지난 조와 겹치지 않게, 결과 저장 · 다시 불러오기. → 2026-10-21 간소화 때 붙이기 · 떼어 놓기, 조장, 지난 조 겹침은 뺌.
     - 2026-10-17 사용자 요청: **수준별 나누기는 빼기**(학생 수준 칸도 없앰), 칭찬 스티커는 되돌리기 대신 카드를 누르면 TV 화면 안에서 '부여하기 / 삭제하기'를 묻기(전체 화면이라 일반 modal 은 안 보이므로 .tv-ask 를 오버레이 안에 붙임), 첫 화면 반 칸에 조 편성 · 칭찬 스티커 · 반 메모 버튼을 입력칸 아래 크게.
     - 칭찬 스티커: 수업 중 **TV 화면에 띄워** 보여 줌 → 큰 글씨 전체 화면 모드, 학생(또는 조) 누르면 +1, 되돌리기. 개인정보는 사용자가 학교에 확인해 괜찮다고 함. 견본 파일은 공개 저장소에 절대 올리지 말고 드라이브로 받기.
   - 3단계: 구글 캘린더 연동('수업관리' 캘린더를 따로 만들어 반별 수행평가 날짜 · 중요 일정). 콘솔에서 Calendar API 사용 설정 + 권한 추가가 필요.

## 작업할 때
- 코드 스타일: 2칸 들여쓰기, 작은따옴표, 주석은 한국어로 짧게, `h()` 로 DOM 을 만듭니다. 사용자에게 보이는 문구는 모두 한국어입니다.
- **문법 검사**: `node --check 파일.js` 는 import 가 있는 .js 를 검사하지 않고 그냥 통과시킵니다. `.mjs` 로 복사해서 검사하세요.
- **테스트**: 실제 구글 로그인은 사용자만 할 수 있습니다(비밀번호를 대신 입력하면 안 됨). UI 를 확인할 때는 `js/google.js` 를 가짜(localStorage 를 드라이브처럼 쓰는 버전)로 바꾼 **복사본을 임시 폴더에** 만들어 띄웠습니다. 탭 두 개를 열면 기기 두 대처럼 병합을 시험할 수 있습니다. 저장소 안의 google.js 는 바꾸지 마세요.
- 커밋과 푸시는 사용자가 요청할 때만 합니다. 커밋 메시지는 한국어로 쓰고, 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` 를 붙입니다.
- 학생 개인정보: 사용자가 학교에 확인해 저장해도 된다고 함(2026-10-17). 그래도 공개 저장소 · 로그 · 대화에 학생 실명을 옮겨 적지 마세요.
