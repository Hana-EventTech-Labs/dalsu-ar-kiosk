// 현장 설정 오버레이 — 콘텐츠(메뉴·문구·색·연출)는 앱에 든 config.json 이 기준이고,
// 현장 파일(문서\DalsuARKiosk\config.json)은 **그 위에 덧씌우는 현장값만** 담는다.
//
// 왜: 예전엔 현장 파일이 config 전체의 복사본이었고 업데이트가 건드리지 않았다. 그래서 프린터 모드 같은
// 현장값은 살았지만, 메뉴 3개·Return 2단계·삼성 색처럼 config 에 든 콘텐츠 변경이 자동 업데이트로 내려가지
// 않았다(2026-09-03 v0.7.4 배포에서 실제로 그랬다 — 앱은 올라갔는데 화면은 예전 4개 메뉴).
//
// 규칙:
//   · 현장 파일에 적힌 키만 번들 config 를 덮는다(객체는 재귀 병합, 배열·원시값은 통째로 교체).
//   · 현장 파일이 예전 방식(전체 복사본)이면 현장값(SITE_PATHS)만 뽑아 새 오버레이로 바꾸고, 원본은 백업으로 남긴다.
//   · 현장에서 콘텐츠 키(goals·screen …)를 굳이 오버레이에 적으면 그것도 덮는다 — 급한 현장 수정 통로는 열어 둔다.
//     단 그러면 그 키는 이후 업데이트로 바뀌지 않으니, 끝나면 지워야 한다.
'use strict';

// 업데이트가 바꾸면 안 되는 현장값 — 이 경로들만 예전 전체 복사본에서 건져 온다
const SITE_PATHS = Object.freeze([
  'printer',          // mode(smart/dry-run)·deviceDesc·sdk·timeoutMs·retry — 현장 프린터에 맞춘 값
  'camera',           // deviceId·해상도·mirror
  'card.backRotate',  // 플리퍼 축에 따른 뒷면 회전
  'update',           // 자동 업데이트 on/off·주기
  'output',           // 보관 일수·폴더
  'sound',
  'river.quality',    // 현장 PC 성능에 맞춘 고정 품질
]);

// 콘텐츠 키 — 이 중 3개 이상이 현장 파일에 들어 있으면 예전 '전체 복사본'으로 본다(isLegacyFull)
const CONTENT_KEYS = Object.freeze(['goals', 'screen', 'timing', 'swim', 'scene', 'event']);

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function deepMerge(base, over) {
  if (!isObj(base) || !isObj(over)) return over === undefined ? base : clone(over);
  const out = clone(base);
  for (const k of Object.keys(over)) {
    if (k.startsWith('_')) continue;                       // _readme 같은 주석 키는 병합하지 않는다
    out[k] = (isObj(base[k]) && isObj(over[k])) ? deepMerge(base[k], over[k]) : clone(over[k]);
  }
  return out;
}
function clone(v) { return v === undefined ? v : JSON.parse(JSON.stringify(v)); }

function getPath(obj, dotted) {
  return dotted.split('.').reduce((o, k) => (isObj(o) ? o[k] : undefined), obj);
}
function setPath(obj, dotted, value) {
  const ks = dotted.split('.'); let o = obj;
  ks.slice(0, -1).forEach((k) => { if (!isObj(o[k])) o[k] = {}; o = o[k]; });
  o[ks[ks.length - 1]] = clone(value);
}

// '전체 복사본' 판정: _readme 표식이 없고 콘텐츠 키가 3개 이상. 긴급 수정으로 콘텐츠 키 하나(screen.guideText 등)만 적은
// 오버레이는 전체 복사본이 아니다 — 그걸 legacy 로 보면 방금 적은 수정을 지워 버린다(테스트가 잡았다).
function isLegacyFull(site) {
  if (!isObj(site) || '_readme' in site) return false;
  return CONTENT_KEYS.filter((k) => k in site).length >= 3;
}

// 예전 전체 복사본 → 현장값만 담은 오버레이. 번들과 같은 값이라도 남긴다(현장에서 '여기서 고친다'가 보이도록).
function extractSite(full) {
  const out = {};
  for (const p of SITE_PATHS) {
    const v = getPath(full, p);
    if (v !== undefined) setPath(out, p, v);
  }
  return out;
}

const README = [
  '이 파일은 현장값 오버레이입니다. 여기 적힌 키만 앱에 든 기본 config 를 덮어씁니다.',
  '메뉴·문구·색·연출은 앱 업데이트로 자동 반영되므로 여기 적지 마세요(적으면 그 키는 업데이트로 바뀌지 않습니다).',
  '보통 고칠 것: printer.mode(smart|dry-run) · printer.deviceDesc · camera.deviceId · card.backRotate',
].join(' ');

// 번들 config + 현장 오버레이 → 실제 config. 현장 파일이 예전 전체 복사본이면 마이그레이션 정보도 돌려준다.
//   반환 { config, overrides, migrated }  — migrated=true 면 호출자가 overrides 를 현장 파일로 다시 써야 한다.
function resolveConfig(bundled, site) {
  if (!isObj(bundled)) throw new Error('번들 config 가 없습니다');
  if (!isObj(site)) {
    const overrides = { _readme: README, ...extractSite(bundled) };
    return { config: clone(bundled), overrides, migrated: true, reason: 'created' };
  }
  if (isLegacyFull(site)) {
    const overrides = { _readme: README, ...extractSite(site) };
    return { config: deepMerge(bundled, overrides), overrides, migrated: true, reason: 'legacy' };
  }
  return { config: deepMerge(bundled, site), overrides: site, migrated: false, reason: 'overlay' };
}

// 오버레이가 번들에서 실제로 바꾼 최상위 경로 목록 (시작 로그용)
function diffPaths(bundled, merged, prefix = '') {
  const out = [];
  const keys = new Set([...Object.keys(bundled || {}), ...Object.keys(merged || {})]);
  for (const k of keys) {
    const a = bundled ? bundled[k] : undefined, b = merged ? merged[k] : undefined;
    if (isObj(a) && isObj(b)) out.push(...diffPaths(a, b, prefix + k + '.'));
    else if (JSON.stringify(a) !== JSON.stringify(b)) out.push(prefix + k);
  }
  return out;
}

{ const __exports = { SITE_PATHS, CONTENT_KEYS, deepMerge, isLegacyFull, extractSite, resolveConfig, diffPaths, README };
if (typeof module !== 'undefined' && module.exports) module.exports = __exports;
  else if (typeof window !== 'undefined') Object.assign(window, __exports); }
