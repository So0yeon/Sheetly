# AI 활동지 메이커

주제(차시 제목)만 넣으면 초등 수업에 어울리는 활동 3~5가지가 담긴 A4 활동지가 자동으로 만들어지는 웹앱입니다.

- 활동 형태 자동 구성: 글쓰기 · 그리기 · 표 채우기 · 생각 그물 · 체크리스트 · 짝 토의
- 학생용 / 교사용(지도 팁 + 예시 답안) 탭
- 정확한 A4(210×297mm) 페이지 자동 분할, PDF 저장 · 인쇄
- BYOK: 각 사용자가 자신의 Gemini API 키를 입력해 사용 (키는 브라우저에만 저장, 서버 없음)

## 로컬 실행

```bash
npm install
npm run dev
```

## 배포 (Vercel)

1. 이 저장소를 GitHub에 올립니다.
2. https://vercel.com 에서 GitHub로 로그인 → Add New → Project → 이 저장소 Import
3. Framework가 Vite로 자동 감지됩니다. Deploy 클릭 → 끝!

이후 GitHub에 push할 때마다 자동으로 재배포됩니다.

## 사용법

1. 첫 실행 시 [Google AI Studio](https://aistudio.google.com/app/apikey)에서 무료 Gemini API 키를 발급받아 입력합니다.
2. 학년·과목을 고르고 주제(차시 제목)를 입력한 뒤 **활동지 생성**을 누릅니다.
3. 학생용/교사용을 확인하고 **PDF 저장** 또는 **인쇄**로 출력합니다.
