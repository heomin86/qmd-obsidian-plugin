# 🔍 QMD Search - Obsidian 하이브리드 검색 플러그인

> Obsidian 노트를 더 똑똑하게 검색하세요! BM25 + 벡터 검색 + LLM을 결합한 강력한 하이브리드 검색 엔진입니다.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## ✨ 주요 기능

| 기능 | 설명 |
|------|------|
| 🔤 **BM25 검색** | 키워드 기반 빠른 전문 검색 |
| 🧠 **벡터 검색** | 의미 기반 시맨틱 검색 (Ollama 임베딩) |
| 🤖 **LLM 통합** | AI 기반 검색 결과 개선 |
| 📁 **컬렉션** | 노트를 그룹으로 묶어서 관리 |
| ⚡ **자동 인덱싱** | 파일 수정 시 자동으로 인덱스 업데이트 |

---

## 📦 설치 방법

### 방법 1: GitHub Releases에서 다운로드 (추천)

1. [Releases 페이지](https://github.com/heomin86/qmd-obsidian-plugin/releases)에서 최신 버전 다운로드

2. 다운로드한 파일들을 Obsidian 볼트의 플러그인 폴더에 복사:
   ```
   당신의볼트/.obsidian/plugins/qmd-search/
   ```

3. **⚠️ 중요!** 아래 4개 파일이 모두 있어야 합니다:
   - `main.js` - 플러그인 코드
   - `manifest.json` - 플러그인 정보
   - `styles.css` - 스타일
   - `sql-wasm.wasm` - 데이터베이스 엔진 (**없으면 작동 안 함!**)

4. Obsidian 재시작 또는 `Ctrl/Cmd + R`로 새로고침

5. `설정` → `커뮤니티 플러그인` → `QMD Search` 활성화

### 방법 2: 소스에서 빌드

개발자이거나 최신 코드를 사용하고 싶다면:

```bash
# 1. 레포지토리 클론
git clone https://github.com/heomin86/qmd-obsidian-plugin.git
cd qmd-obsidian-plugin

# 2. 의존성 설치
npm install

# 3. 빌드
npm run build

# 4. 볼트에 복사 (macOS/Linux)
./install-to-vault.sh /path/to/your/vault
```

---

## 🚀 사용 방법

### 검색 열기

- **단축키**: `Cmd/Ctrl + Shift + F`
- **명령어 팔레트**: `QMD: Open Search`

### 기본 워크플로우

```
1. 플러그인 설정에서 Ollama 연결 확인
2. "Reindex Vault" 명령으로 전체 볼트 인덱싱
3. Cmd+Shift+F로 검색 모달 열기
4. 검색어 입력하면 하이브리드 결과 표시!
```

### 우클릭 메뉴

- **파일에서 우클릭**: "Reindex this file" - 해당 파일만 다시 인덱싱
- **에디터에서 우클릭**: "Search selection" - 선택한 텍스트로 검색

---

## ⚙️ 설정

`설정` → `QMD Search`에서 다음을 설정할 수 있습니다:

| 설정 | 설명 | 기본값 |
|------|------|--------|
| Ollama URL | Ollama 서버 주소 | `http://localhost:11434` |
| 임베딩 모델 | 벡터 검색에 사용할 모델 | `nomic-embed-text` |
| 자동 인덱싱 | 파일 변경 시 자동 인덱스 | 활성화 |

### Ollama 설치 (벡터 검색에 필요)

1. [Ollama 공식 사이트](https://ollama.ai)에서 다운로드
2. 설치 후 터미널에서:
   ```bash
   ollama pull nomic-embed-text
   ```
3. Ollama가 실행 중인지 확인 (`http://localhost:11434` 접속)

---

## 🛠️ 개발

```bash
# 개발 모드 (파일 변경 감지)
npm run dev

# 프로덕션 빌드
npm run build
```

### 프로젝트 구조

```
qmd-obsidian-plugin/
├── main.ts              # 플러그인 진입점
├── src/
│   ├── collections/     # 컬렉션 관리
│   ├── commands/        # 명령어 정의
│   ├── database/        # SQLite 데이터베이스
│   ├── embeddings/      # Ollama 임베딩
│   ├── search/          # 하이브리드 검색 로직
│   └── ui/              # 모달, 설정 UI
├── sql-wasm.wasm        # SQLite WASM 바이너리
└── styles.css           # 스타일
```

---

## ❓ FAQ

### Q: 플러그인이 로드되지 않아요
**A:** `sql-wasm.wasm` 파일이 플러그인 폴더에 있는지 확인하세요. 이 파일 없이는 작동하지 않습니다.

### Q: 벡터 검색이 안 돼요
**A:** Ollama가 설치되어 있고 실행 중인지 확인하세요. 터미널에서 `ollama list`로 모델 목록을 확인할 수 있습니다.

### Q: 모바일에서 사용할 수 있나요?
**A:** 아니요, 이 플러그인은 **데스크톱 전용**입니다. SQLite WASM은 모바일에서 지원되지 않습니다.

### Q: 인덱싱이 느려요
**A:** 대용량 볼트의 경우 첫 인덱싱에 시간이 걸릴 수 있습니다. 이후에는 변경된 파일만 업데이트됩니다.

---

## 📋 요구사항

- Obsidian 1.0.0 이상
- 데스크톱 앱 (macOS, Windows, Linux)
- [Ollama](https://ollama.ai) (벡터 검색 사용 시)

---

## 📄 라이선스

MIT License - 자유롭게 사용, 수정, 배포할 수 있습니다.

---

## 🤝 기여

버그 리포트, 기능 제안, PR 모두 환영합니다!

1. 이 레포지토리 Fork
2. 기능 브랜치 생성 (`git checkout -b feature/amazing-feature`)
3. 커밋 (`git commit -m 'Add amazing feature'`)
4. Push (`git push origin feature/amazing-feature`)
5. Pull Request 열기

---

<p align="center">
  Made with ❤️ for the Obsidian community
</p>
