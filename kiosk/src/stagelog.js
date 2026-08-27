// 인쇄 CLI(DalsuPrint.exe)가 stdout 으로 흘리는 진행 단계를 뽑아낸다. (순수 JS — 테스트 대상)
//
// stdout 은 임의의 크기로 잘려 들어오므로 '##STAGE:print' 가 두 청크에 걸쳐 도착할 수 있다.
// 마지막 줄 조각을 남겨 다음 청크와 이어 붙여야 단계를 놓치지 않는다.
'use strict';

const MARK = /^##STAGE:([A-Za-z0-9_]+)/;

// chunk 를 pending 에 이어 붙여 '완결된 줄'에서만 단계를 뽑는다.
// 반환: { stages: [키...], pending: 아직 끝나지 않은 마지막 줄 }
function feedStages(pending, chunk) {
  const buf = (pending || '') + String(chunk == null ? '' : chunk);
  const parts = buf.split(/\r?\n/);
  const rest = parts.pop();
  const stages = [];
  for (const line of parts) {
    const m = MARK.exec(line.trim());
    if (m) stages.push(m[1]);
  }
  return { stages, pending: rest };
}

{ const __exports = { MARK, feedStages };
if (typeof module !== 'undefined' && module.exports) module.exports = __exports;
  else if (typeof window !== 'undefined') Object.assign(window, __exports); }
