# MINIME 25초 소개 영상 (Remotion)

```bash
npm i
npm run dev                                  # 스튜디오에서 미리보기 (MinimeIntro, Scenes 폴더에 장면별)
npx remotion render MinimeIntro out/minime-intro-silhouette.mp4    # 실루엣 버전
npx remotion render MinimeIntroPhoto out/minime-intro-photo.mp4    # 팀원 사진 버전
```

- 자막·대사: `src/data.ts`, 장면 길이: `src/MinimeVideo.tsx`
- 장면: `src/scenes` (인트로 → 01 준비 → 02 대신 말하기 → 03 침묵 → 04 보류·확인 → 엔딩), 캐릭터(실루엣·미니미·말풍선)·탁자: `src/components`
- 색·폰트: `src/theme.ts` (앱 `app/static/app.css` 라이트 테마와 같은 값)
- 폰트는 `@fontsource/ibm-plex-sans-kr`로 번들에 넣어서 오프라인에서도 렌더된다
- 효과음: `public/sfx` (Kenney Interface Sounds, CC0 + 직접 합성한 soft-pop·soft-out·sparkle·chime). 위치는 각 장면 아래쪽 `<Sfx at={...} />`
