# DERMACELLEX i18n — Phase 2 다국어 지원

## 지원 언어 (15개)

| # | 코드 | 언어 | 방향 | 비고 |
|---|------|------|------|------|
| 1 | `ko` | 한국어 | LTR | 기본 언어 |
| 2 | `en` | English | LTR | |
| 3 | `zh-CN` | 简体中文 | LTR | |
| 4 | `ja` | 日本語 | LTR | |
| 5 | `vi` | Tiếng Việt | LTR | |
| 6 | `th` | ไทย | LTR | |
| 7 | `es` | Español | LTR | |
| 8 | `fr` | Français | LTR | |
| 9 | `de` | Deutsch | LTR | |
| 10 | `pt-BR` | Português | LTR | |
| 11 | `id` | Bahasa Indonesia | LTR | |
| 12 | `ar` | العربية | **RTL** | |
| 13 | `ru` | Русский | LTR | |
| 14 | `ms` | Bahasa Melayu | LTR | |
| 15 | `hi` | हिन्दी | LTR | |


## 파일 구조

```
src/
  i18n/
    index.js              ← 코어 엔진 (zero-dependency)
    locales/
      ko.json             ← 한국어 (기본)
      en.json             ← English
      zh-CN.json          ← 简体中文
      ja.json             ← 日本語
      vi.json             ← Tiếng Việt
      th.json             ← ไทย
      es.json             ← Español
      fr.json             ← Français
      de.json             ← Deutsch
      pt-BR.json          ← Português
      id.json             ← Bahasa Indonesia
      ar.json             ← العربية
      ru.json             ← Русский
      ms.json             ← Bahasa Melayu
      hi.json             ← हिन्दी
  hooks/
    useI18n.js            ← React Hook
  components/
    LanguageSelector.jsx  ← 언어 선택 UI
    LanguageSelector.css  ← 스타일
```


## 설치 & 초기화

### 1. 앱 진입점 (App.jsx 또는 _app.jsx)

```jsx
import { init } from './i18n';
import './components/LanguageSelector.css';

// 앱 시작 시 1회 호출 — 브라우저 언어 자동 감지
init();

// 또는 특정 언어로 강제 시작
// init('ja');
```

### 2. 컴포넌트에서 사용

```jsx
import { useI18n } from './hooks/useI18n';

function IntroPage() {
  const { t } = useI18n();

  return (
    <div>
      <span className="badge">{t('intro.badge')}</span>
      <h1>{t('intro.title')}</h1>
      <p>{t('intro.subtitle')}</p>
      <button>{t('intro.cta')}</button>
      <p>{t('intro.trust', { count: '1,200' })}</p>
    </div>
  );
}
```

### 3. 언어 선택기 배치

```jsx
import LanguageSelector from './components/LanguageSelector';

// 헤더 — 컴팩트 버튼
<LanguageSelector />

// 설정 페이지 — 그리드 레이아웃
<LanguageSelector mode="inline" />
```


## 번역 키 구조

| 섹션 | 프리픽스 | 커버 범위 |
|------|----------|-----------|
| 공통 UI | `common.*` | 버튼, 라벨, 네비게이션 |
| 인트로 | `intro.*` | 랜딩 페이지 |
| 서비스 설명 | `services.*` | OEM/ODM/OCM/OBM |
| 진단 20문항 | `diagnosis.*` | 5섹션 × 4문항 |
| 결과 | `result.*` | 추천 · 비교 |
| 고객 정보 | `customerInfo.*` | 폼 필드 |
| 미팅 예약 | `meeting.*` | 일정 선택 |
| 접수 완료 | `submission.*` | 확인 · 의뢰서 CTA |
| 기획개발의뢰서 | `devForm.*` | 7섹션 헤더 |
| 푸터 | `footer.*` | 링크 |


## RTL (아랍어) 대응

`ar` 선택 시 자동으로 `<html dir="rtl">` 설정됨.
CSS에 `[dir="rtl"]` 셀렉터로 레이아웃 미러링 처리 필요.


## 키 추가 규칙

1. `ko.json`에 먼저 추가
2. 나머지 14개 locale에 동일 키 추가
3. 키 네이밍: `섹션.키` 형식 (예: `diagnosis.q21`)
4. 변수 보간: `{{변수명}}` (예: `{{count}}건`)


## Notion 연동 참고

Notion에 제출 시 현재 locale 코드를 함께 전송:

```js
// 기존 payload에 추가
payload.locale = getLocale();  // 'ja', 'vi' 등
```

이를 통해 담당자가 어느 언어 사용자인지 즉시 파악 가능.
