# Remember

Remember는 자주 다시 찾는 웹페이지를 저장하고, 메모를 붙이고, 폴더와 태그로 정리한 뒤 웹앱과 크롬 확장프로그램에서 같은 방식으로 관리할 수 있게 만든 개인용 사이트 보관함입니다. 별도 서버 없이 동작하며, 필요할 때 Google Drive `appDataFolder`를 이용해 데이터를 동기화합니다.

## 무엇을 해결하나

기본 브라우저 북마크만으로는 아래 요구를 만족시키기 어렵습니다.

- 링크마다 메모를 남기고 싶다.
- 폴더와 태그를 함께 써서 다시 찾기 쉽게 만들고 싶다.
- 웹앱과 브라우저 확장프로그램에서 같은 컬렉션을 쓰고 싶다.
- 개인 데이터는 직접 들고 있으면서도 백업과 동기화는 하고 싶다.

Remember는 이 문제를 정적 웹앱 + 크롬 확장프로그램 + Google Drive 동기화 조합으로 해결합니다.

## 핵심 기능

- 폴더, 태그, 검색, 스마트 뷰 기반으로 사이트 정리
- `grid`, `list`, `magazine` 보기 모드 지원
- URL 입력 시 Open Graph 메타데이터 자동 추출
- 메모, 썸네일, 파비콘, 방문 수, 최근 방문 정보 저장
- 다중 선택 후 폴더 이동, 태그 추가/제거, 일괄 삭제
- 백업 내보내기와 복구
- 죽은 링크 검사 및 일괄 삭제
- 읽기 모드 추출과 원문 바로 열기
- 북마클릿, 확장프로그램 팝업, 단축키, 우클릭 메뉴로 빠른 저장
- Google Drive `appDataFolder` 기반 양방향 동기화
- 삭제 충돌 복원을 막기 위한 tombstone 기반 병합
- 웹앱 서비스 워커 기반 오프라인 앱 셸 캐시

## 대상 사용자

- 링크를 "저장"하는 것보다 "나중에 다시 찾는 것"이 더 중요한 사람
- 브라우저 북마크보다 메모와 태그가 중요한 사람
- 별도 서버를 운영하지 않고 개인용 보관함을 쓰고 싶은 사람

## 프로젝트 구조

```text
remember/
  README.md
  site_storage/
    index.html
    app.js
    app-style.css
    manifest.json
    service-worker.js
    extension/
      popup.html
      background.js
    icons/
    LICENSE
```

- `site_storage/`: 실제 웹앱과 확장프로그램이 들어 있는 배포 폴더
- `site_storage/index.html`: 웹앱 진입점
- `site_storage/manifest.json`: 크롬 확장프로그램 매니페스트
- `site_storage/extension/background.js`: 백그라운드 저장, 알람, 컨텍스트 메뉴, 동기화 처리

## 요구사항

- 최신 Chromium 계열 브라우저
- 웹앱용 정적 파일 서버 또는 정적 호스팅
- Google Drive 동기화 사용 시 Google Cloud OAuth Client ID
- 로컬 실행만 할 경우 별도 빌드 도구는 필요 없음

## 빠른 시작

### 1. 웹앱 실행

이 프로젝트는 빌드 단계가 없는 정적 앱입니다. `site_storage` 폴더를 그대로 서빙하면 됩니다.

```powershell
cd site_storage
python -m http.server 5500
```

브라우저에서 `http://localhost:5500`을 열면 됩니다.

중요:
- `file://`로 `index.html`만 직접 열어도 기본 저장 기능은 일부 동작할 수 있지만, Google OAuth와 Drive 연동은 실패합니다.
- Drive 동기화를 쓰려면 `localhost` 또는 `https` 환경에서 실행해야 합니다.

### 2. 크롬 확장프로그램 설치

1. 크롬에서 `chrome://extensions`를 엽니다.
2. 우측 상단 `개발자 모드`를 켭니다.
3. `압축해제된 확장 프로그램을 로드`를 클릭합니다.
4. 프로젝트 루트가 아니라 `site_storage` 폴더를 선택합니다.

설치 후 아래 빠른 저장 기능을 사용할 수 있습니다.

- 팝업에서 `현재 탭 추가`
- 단축키 `Ctrl+Shift+S` / macOS `Command+Shift+S`
- 우클릭 메뉴 `Remember에 이 페이지 저장`
- 우클릭 메뉴 `이 링크를 Remember에 저장`

## Google Drive 동기화 설정

웹앱과 확장프로그램에서 같은 Client ID를 쓰면 같은 Drive 파일을 공유합니다.

### 1. Google Cloud Console에서 OAuth Client ID 생성

- 유형: `Web application`
- Scope: `https://www.googleapis.com/auth/drive.appdata`

### 2. Redirect URI 등록

웹앱:
- 로컬 예시: `http://localhost:5500/?oauth_callback=1`
- 배포 예시: `https://your-domain.example/?oauth_callback=1`

주의:
- 웹앱을 하위 경로에 배포한다면 실제 경로에 맞춰 URI를 등록해야 합니다.
- 예를 들어 `/remember/` 경로에 배포했다면 `https://your-domain.example/remember/?oauth_callback=1` 형태가 됩니다.

확장프로그램:
- `https://<EXTENSION_ID>.chromiumapp.org/`

`<EXTENSION_ID>`는 확장프로그램을 로드한 뒤 `chrome://extensions`에서 확인할 수 있습니다.

### 3. 앱에서 Client ID 저장

1. 설정 패널을 엽니다.
2. `Google Drive 동기화` > `OAuth 설정`으로 이동합니다.
3. `Google OAuth Client ID`를 입력하고 저장합니다.
4. `Google 연결`을 눌러 로그인합니다.
5. 필요에 따라 `양방향 동기화`, `Drive 저장`, `Drive 불러오기`를 사용합니다.

## 사용 흐름 예시

### 새 사이트 저장

다음 중 하나로 링크를 수집합니다.

- 웹앱에서 `새 사이트 추가하기`
- 확장프로그램에서 `현재 탭 추가`
- 북마클릿 코드 복사 후 브라우저 북마크바에 등록
- 웹페이지 우클릭 메뉴 사용

저장 과정에서 이름, 폴더, 태그, 메모, 썸네일을 정리할 수 있고, URL만 넣어도 메타데이터를 자동으로 채워줍니다.

### 나중에 다시 찾기

- 검색창으로 제목, 메모, 태그, 읽기 모드 본문까지 검색
- 폴더/태그 필터로 범위 축소
- 매거진 보기로 시각적으로 탐색
- 읽기 모드에서 본문을 추출해 빠르게 훑어보기

### 데이터 보호

- 수동 백업 다운로드
- JSON 백업 복구
- Google Drive 동기화
- 삭제 동기화를 위한 tombstone 기록 유지

## 동기화 방식

Drive 파일명은 `remember-sync-v2.json`입니다.

- `양방향 동기화`: 로컬 데이터와 Drive 데이터를 병합한 뒤 둘 다 최신 상태로 맞춤
- `Drive 저장`: 로컬 데이터를 Drive 기준으로 덮어씀
- `Drive 불러오기`: Drive 데이터를 로컬로 가져옴

병합 시에는 북마크와 tombstone을 함께 비교합니다. 그래서 한 기기에서 삭제한 항목이 다른 기기에서 되살아나는 문제를 줄일 수 있습니다.

## 제한 사항과 주의점

- 읽기 모드와 메타데이터 추출은 사이트별 CORS 정책에 영향을 받습니다.
- 웹앱에서는 HTML 가져오기에 실패할 경우 `allorigins.win`, `r.jina.ai` 같은 외부 경유 경로를 사용합니다.
- 죽은 링크 검사는 `HEAD` 또는 `GET` 요청 결과에 의존하므로 일부 사이트에서는 정확하지 않을 수 있습니다.
- Google Drive 동기화는 인증 토큰이 만료되면 다시 로그인해야 합니다.
- 백그라운드 자동 동기화에는 대량 삭제 감지 안전모드가 있어, 위험한 상황에서는 자동 동기화를 중단합니다.

## 문제 해결

### OAuth 로그인 창이 열려도 동기화가 안 됨

- `file://`로 실행 중인지 확인합니다.
- 등록한 Redirect URI와 실제 접근 URL이 완전히 같은지 확인합니다.
- 웹앱과 확장프로그램에서 같은 Client ID를 쓰고 있는지 확인합니다.

### 메타데이터나 읽기 모드가 비어 있음

- 대상 사이트가 CORS 또는 봇 차단 정책을 적용할 수 있습니다.
- Open Graph 태그가 없는 페이지일 수 있습니다.
- 원문 열기는 계속 사용할 수 있으므로, 읽기 모드는 보조 기능으로 보는 편이 안전합니다.

### 확장프로그램이 현재 탭을 저장하지 못함

- 내부 브라우저 페이지(`chrome://`, 웹스토어 등)는 URL 접근 제한으로 저장되지 않습니다.
- `site_storage` 폴더를 로드했는지 다시 확인합니다.

## 문서

- [배포 폴더 설명](site_storage/README.md)
- [MIT 라이선스](site_storage/LICENSE)

## 지원

현재 이 저장소에는 별도 공개 지원 채널이 문서화되어 있지 않습니다. 사용 중 문제나 변경 요청은 저장소 소유자 또는 유지보수 담당자에게 직접 전달하는 것을 전제로 합니다.

## 최근 변경

- `2026-03-17`: 루트 `README.md` 추가
- `2026-03-17`: 설치 경로, 실행 방식, Drive OAuth 설정 절차 정리
- `2026-03-17`: `site_storage/README.md`를 하위 폴더 안내 문서로 축약

## 라이선스

이 프로젝트는 MIT License를 따릅니다. 전문은 [site_storage/LICENSE](site_storage/LICENSE)에서 확인할 수 있습니다.
