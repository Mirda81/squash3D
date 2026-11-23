# Squash 3D

Pohybová 3D squashová hra pro 2 hráče na jednom mobilu. Kamera mobilu sleduje obě postavy (MediaPipe Pose), na kurtu se hýbeš tak, jak se hýbeš ve skutečnosti, a odpaluješ máchnutím ruky.

**Stažení APK:** [Releases → nejnovější build](../../releases/latest), soubor `Squash3D.apk`.

## Jak hrát
1. Mobil postav na stojan nebo ho opři naležato, 2–3 m od vás. Obraz můžeš zrcadlit na TV (Chromecast / Smart View).
2. Před každou hrou proběhne kalibrace těla: výchozí pozice, krok dopředu, krok dozadu, zkušební úder.
3. Krok do strany = pohyb do strany, krok ke kameře = dopředu ke stěně, krok od kamery = dozadu.
4. Rychlé máchnutí pravou rukou = úder. Máchnutí nahoru = lob, do strany = směr. Při silném máchnutí přijde tvrdý úder se zpomalením.
5. Pravidla: hraje se na 11 bodů, každá výměna je bod a musíš vyhrát o 2. Míček musí trefit přední stěnu nad plechem a smí odskočit od země jen jednou.

## Vývoj
- `./build.sh` sestaví web do `www/` (Three.js + MediaPipe).
- `android/` obsahuje WebView obal. APK sestavuje GitHub Actions při každém pushi do `main`.
- Model postavy: Xbot (Mixamo) z ukázek Three.js.
