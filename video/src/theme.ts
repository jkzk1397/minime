// 실제 앱(app/static/app.css)의 라이트 테마 토큰
export const C = {
  bg: "#eef0f6",
  panel: "#ffffff",
  panel2: "#f6f7fb",
  sunken: "#eff1f7",
  line: "#dfe2ed",
  line2: "#d2d6e3",
  ink: "#161a2b",
  ink2: "#3f4559",
  muted: "#666c85",
  faint: "#9aa0b6",
  accent: "#4338ca",
  accentSoft: "#e6e5fb",
  ok: "#11845e",
  okSoft: "#e2f4ec",
  warn: "#a96407",
  warnSoft: "#fcf1dc",
  bad: "#d13a4a",
  badSoft: "#fde8ea",
  info: "#4a5fe0",
  infoSoft: "#e9ecff",
};

export const FONT =
  "'IBM Plex Sans KR', 'Noto Sans CJK KR', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif";

export const SHADOW_PANEL =
  "0 0 0 1px rgba(40,30,80,.04), 0 2px 4px rgba(40,30,80,.04), 0 24px 60px -24px rgba(40,30,80,.28)";
export const SHADOW_SOFT =
  "0 1px 2px rgba(40,30,80,.05), 0 8px 20px -10px rgba(40,30,80,.16)";

/** 사람 색 → 파스텔(14% 섞음) */
export const tint = (hex: string, pct = 14) =>
  `color-mix(in srgb, ${hex} ${pct}%, #ffffff)`;
