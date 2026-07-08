# pklove-pray

릴레이 금식기도 날짜 신청 페이지입니다.

## 기능

- GitHub Pages에 올릴 수 있는 정적 웹앱
- Firebase Realtime Database 연동 지원
- Firebase 설정 전에는 브라우저 localStorage로 미리보기 가능
- 관리자 기본 비밀번호: `0000`
- 관리자 페이지에서 기간, 제외 요일, 기본 모집 인원, 날짜별 모집 인원, 전체 명단, 관리자 비밀번호 변경 가능
- 사용자 화면에서는 관리자 명단에 있는 이름만 검색/선택 가능
- 날짜별 `신청인원/모집인원` 표시, 마감 날짜 딤드 처리
- 전체 일정표에서 날짜별 신청자와 미신청자 표시

## 로컬 확인

```bash
npm run serve
```

브라우저에서 `http://localhost:4173`을 엽니다.

## Firebase 연결

`app.js` 상단의 `firebaseConfig`를 본인 Firebase 웹앱 설정값으로 교체합니다.

```js
const firebaseConfig = {
  apiKey: "...",
  authDomain: "...",
  databaseURL: "...",
  projectId: "...",
  storageBucket: "...",
  messagingSenderId: "...",
  appId: "...",
};
```

Realtime Database는 테스트/내부용으로 아래처럼 열어두면 바로 동작합니다.
보안이 중요한 서비스에는 권장하지 않습니다.

```json
{
  "rules": {
    ".read": true,
    ".write": true
  }
}
```

## GitHub Pages 배포

1. GitHub repo의 `Settings`로 이동
2. `Pages` 메뉴 선택
3. `Build and deployment`에서 `Deploy from a branch` 선택
4. Branch는 `main`, folder는 `/root` 선택
5. 저장 후 표시되는 Pages URL로 접속

## 테스트

```bash
npm test
```
