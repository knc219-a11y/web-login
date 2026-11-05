# Claude Code 스킬 (mattpocock/skills)

이 폴더의 스킬은 [mattpocock/skills](https://github.com/mattpocock/skills)
(MIT 라이선스, 커밋 `4ae2317`, 2026-10-31)에서 이 프로젝트에 맞는 것만 골라 복사한 것입니다.
라이선스 전문은 [`LICENSE-mattpocock-skills`](./LICENSE-mattpocock-skills)에 있습니다.
Codex 전용 설정(`agents/openai.yaml`)은 빼고 넣었습니다.

## 스킬이 뭔가요?

스킬은 Claude에게 주는 "작업 매뉴얼"입니다. `.claude/skills/<이름>/SKILL.md` 에 있으면
이 저장소에서 Claude Code를 실행할 때 자동으로 인식됩니다. 설치나 설정은 따로 필요 없습니다.

쓰는 방법은 두 가지입니다.

1. **직접 호출**: 채팅창에 `/스킬이름` 을 입력합니다. 예: `/grill-me 로그인 실패 횟수 제한 기능을 넣고 싶어`
2. **자동 호출**: 요청 내용이 스킬 설명과 맞으면 Claude가 알아서 불러옵니다.
   예: "로그인 후 리다이렉트가 안 돼, 디버깅해줘" 라고 하면 `diagnosing-bugs` 가 쓰입니다.
   아래 표에서 "수동 전용"인 스킬은 자동으로 불리지 않고 `/이름` 으로만 실행됩니다.

## 들어 있는 스킬

| 스킬 | 호출 | 하는 일 | 이 프로젝트에서 써볼 만한 상황 |
| --- | --- | --- | --- |
| `grill-me` | 수동 전용 | 계획을 놓고 Claude가 질문을 퍼부어 빈틈을 찾습니다. | 새 기능(계정 잠금, 세션 만료 등)을 만들기 전에 |
| `grill-with-docs` | 수동 전용 | `grill-me` + 용어집(`GLOSSARY.md`)과 결정 기록(ADR)을 같이 만듭니다. | 내부망 DB/Kibana 연동 방식을 정할 때 |
| `grilling` | 자동 | 위 두 스킬이 내부적으로 쓰는 질문 방식. "grill" 이라고 말해도 실행됩니다. | |
| `domain-modeling` | 자동 | 프로젝트 용어와 설계 결정을 문서로 정리합니다. | "세션", "리다이렉트 대상" 같은 용어 정리 |
| `tdd` | 자동 | 실패하는 테스트를 먼저 쓰고 고치는(red-green-refactor) 방식으로 개발합니다. | `test/app.test.js` 에 테스트를 늘리며 기능 추가 |
| `diagnosing-bugs` | 자동 | 버그를 재현 → 가설 → 확인 단계로 차근차근 추적합니다. | 로그인 루프, 프록시 404 같은 문제 |
| `codebase-design` | 자동 | 모듈 경계·인터페이스를 더 단순하고 테스트하기 좋게 다듬습니다. | `src/db` 를 실제 DB로 바꿀 때 구조 잡기 |
| `code-review` | 자동 | 기준 브랜치 대비 변경점을 "코딩 규칙"과 "요구사항" 두 관점으로 리뷰합니다. | PR 올리기 전 `/code-review main` |
| `handoff` | 수동 전용 | 지금까지의 대화를 다른 세션이 이어받을 수 있게 문서로 요약합니다. | 내부망으로 옮겨 작업을 이어갈 때 |
| `setup-matt-pocock-skills` | 수동 전용 | 위 스킬들이 쓸 이슈 트래커·문서 위치를 저장소에 설정합니다. | **처음 한 번** 실행 |

## 처음 써본다면 이 순서로

1. 저장소 폴더에서 `claude` 실행 후 `/setup-matt-pocock-skills` 를 한 번 실행합니다.
   이슈 트래커(GitHub 이슈 또는 로컬 파일)와 문서 위치를 물어보면 추천값을 받아도 됩니다.
2. 다음에 만들 기능 하나를 정해 `/grill-me <기능 설명>` 으로 질문에 답해 봅니다.
3. 정리가 되면 "tdd로 구현해줘" 라고 요청해 테스트부터 작성하게 해봅니다.
4. 끝나면 `/code-review main` 으로 변경점을 리뷰받습니다.

## 참고

- Claude Code에 기본으로 들어 있는 `/code-review` 와 이름이 같습니다. `/code-review` 를 쳤을 때 어느 쪽이
  실행되는지 헷갈리면 이 폴더의 `code-review` 이름을 바꾸면 됩니다(폴더 이름과 SKILL.md 의 `name:` 둘 다, 예: `mp-code-review`).
- 스킬은 그냥 Markdown 파일이라 마음대로 고쳐 써도 됩니다. 원본을 업데이트하려면 위 저장소에서 다시 복사하면 됩니다.
- 원본 저장소의 다른 스킬(`to-spec`, `to-tickets`, `triage`, `prototype` 등)이 필요해지면 같은 방식으로 추가하면 됩니다.
